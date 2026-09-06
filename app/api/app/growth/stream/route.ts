import { ensureSchema } from '@/db/bootstrap';
import { finishGrowthAsk, prepareGrowthAsk } from '@/lib/growth-service';
import {
  hasEvidence,
  rankFindings,
  readLane,
  skipReason,
  SPECIALISTS,
  specialistPrompt,
  summariseRun,
  type Finding,
} from '@/lib/growth-specialists';
import { createSseParser, modelName, streamError, textDelta } from '@/lib/sse';
import { requireCustomerPermission } from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';

/**
 * The growth manager's answer, streamed as it is written.
 *
 * The non-streaming `ask` action stays: it is what a caller without an event
 * stream uses, and it is the fallback this screen falls back to. Both build
 * their prompt with `prepareGrowthAsk` and store the turn with
 * `finishGrowthAsk`, so a streamed conversation and a waited-for one are the
 * same thread with the same grounding.
 *
 * Three things this must get right, because each was a way to lose an answer:
 *
 *  - The turn is written when the stream ends, not when it starts. A question
 *    stored against an answer that never arrived reads as if it was ignored.
 *  - A reader that goes away (the tab closes, Stop is pressed) still leaves
 *    what had been generated in the thread, rather than nothing.
 *  - A provider failure is sent *as an event* on an already-open stream. The
 *    status line is long gone by then, so a silent close would look like an
 *    empty answer.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    question?: string;
    chatId?: string | null;
    /** 'deep' runs the specialist lanes first and shows the work. */
    mode?: string;
  };
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  await ensureSchema();

  const question = String(body.question ?? '')
    .trim()
    .slice(0, 2000);
  if (!question)
    return new Response(JSON.stringify({ error: 'Ask something.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });

  const organizationId = auth.session.organizationId!;
  const deep = body.mode === 'deep';
  const preparedAt = Date.now();
  const plan = await prepareGrowthAsk({
    organizationId,
    userId: auth.session.userId,
    chatId: body.chatId ?? null,
    question,
  });

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: Record<string, unknown>,
  ) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = '';
      let model: string | null = null;
      send(controller, {
        type: 'start',
        chatId: plan.chatId,
        deep,
        groundedOn: {
          observations: plan.groundedOn.observations,
          scanRun: plan.groundedOn.scanRun,
          missingSources: plan.groundedOn.missingSources,
        },
      });

      let findings: Finding[] = [];
      if (deep) {
        // The reading of the evidence has already happened by the time this
        // stream opens — `prepareGrowthAsk` did it — so its cost is reported
        // rather than invented, and it is a step because it is the one the
        // reader most wants to see happened.
        send(controller, {
          type: 'step',
          id: 'recall',
          label: `Read this workspace — ${plan.groundedOn.observations} measured figures`,
          ms: Date.now() - preparedAt,
          status: 'done',
        });
        findings = await runSpecialists({
          organizationId,
          slice: plan.slice,
          send: (event) => send(controller, event),
        });
      }

      try {
        const { streamReasoning } = await import('@/lib/provider-adapters');
        const upstream = await streamReasoning({
          organizationId,
          system: deep ? withFindings(plan.system, findings) : plan.system,
          messages: plan.messages,
          maxTokens: deep ? 1200 : 900,
        });
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.push(
            decoder.decode(value, { stream: true }),
          )) {
            const failure = streamError(event);
            if (failure) throw new Error(failure);
            model = model ?? modelName(upstream.shape, event);
            const delta = textDelta(upstream.shape, event);
            if (delta) {
              answer += delta;
              send(controller, { type: 'delta', text: delta });
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The answer stopped early.';
        // Whatever was written before the failure is still the manager's
        // answer, so it is kept and the reader is told where it stopped.
        send(controller, { type: 'error', message });
      }
      if (answer.trim()) {
        try {
          await finishGrowthAsk({
            organizationId,
            plan,
            question,
            answer: answer.trim(),
            model,
          });
        } catch (error) {
          console.error('growth stream could not be stored', error);
        }
      }
      send(controller, {
        type: 'done',
        chatId: plan.chatId,
        stored: Boolean(answer.trim()),
        model,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

/**
 * Runs the specialist lanes and reports each one as it finishes.
 *
 * In parallel, because they read different evidence and nothing one finds
 * changes what another is looking at — four sequential model calls would put a
 * reader in front of a spinner for the sum of them rather than the longest.
 *
 * A lane with nothing to read is never sent to a model. It is reported as
 * skipped, with the reason, which is both cheaper and more honest than asking
 * a specialist to comment on an empty brief and printing what it says.
 */
async function runSpecialists(input: {
  organizationId: string;
  slice: Parameters<typeof specialistPrompt>[1];
  send: (event: Record<string, unknown>) => void;
}): Promise<Finding[]> {
  const { reasonWithTools } = await import('@/lib/provider-adapters');
  const ran: string[] = [];
  const skipped: string[] = [];

  const lanes = await Promise.all(
    SPECIALISTS.map(async (specialist) => {
      if (!hasEvidence(specialist, input.slice)) {
        skipped.push(specialist.id);
        input.send({
          type: 'lane',
          id: specialist.id,
          label: specialist.label,
          status: 'skipped',
          note: skipReason(specialist),
          findings: [],
        });
        return [] as Finding[];
      }
      const started = Date.now();
      try {
        const response = await reasonWithTools({
          organizationId: input.organizationId,
          system: specialistPrompt(specialist, input.slice),
          maxTokens: 700,
          messages: [
            { role: 'user' as const, content: 'Report your findings as JSON.' },
          ],
        });
        const text = ((response as { content?: unknown[] }).content ?? [])
          .filter(
            (block): block is { type: string; text: string } =>
              typeof block === 'object' &&
              block !== null &&
              (block as { type?: unknown }).type === 'text' &&
              typeof (block as { text?: unknown }).text === 'string',
          )
          .map((block) => block.text)
          .join('');
        const lane = readLane(specialist.id, text);
        // A lane whose answer could not be used has not been read, so it does
        // not count towards "4 of 4 lanes read" in the summary.
        if (lane.status === 'unusable') skipped.push(specialist.id);
        else ran.push(specialist.id);
        input.send({
          type: 'lane',
          id: specialist.id,
          label: specialist.label,
          status: lane.status === 'unusable' ? 'unusable' : 'done',
          note:
            lane.status === 'unusable'
              ? 'This specialist answered in a shape nothing could be taken from. Nothing from it is in the plan.'
              : lane.status === 'empty'
                ? 'Read it, found nothing it could evidence.'
                : undefined,
          ms: Date.now() - started,
          findings: lane.findings,
        });
        return lane.findings;
      } catch (error) {
        // One lane failing is not the run failing. It is reported as failed so
        // the summary below cannot count it as read and clear.
        skipped.push(specialist.id);
        input.send({
          type: 'lane',
          id: specialist.id,
          label: specialist.label,
          status: 'failed',
          ms: Date.now() - started,
          note: error instanceof Error ? error.message : 'This lane failed.',
          findings: [],
        });
        return [] as Finding[];
      }
    }),
  );

  const findings = rankFindings(lanes.flat());
  input.send({
    type: 'lanes_done',
    summary: summariseRun({
      findings,
      ran: ran as never[],
      skipped: skipped as never[],
    }),
    findings,
  });
  return findings;
}

/**
 * Hands the specialists' findings to the writer of the final answer.
 *
 * They go in as evidence with the same standing as a measured figure, and with
 * the same rule attached: a plan may only cite what is in front of it.
 */
function withFindings(system: string, findings: Finding[]): string {
  if (findings.length === 0)
    return `${system}\n<specialists>Your specialists read this workspace and found nothing they could evidence. Say so plainly and name what would have to be connected or measured for them to find something.</specialists>`;
  return `${system}\n<specialists>These are your own specialists' findings, already ranked. Write the answer as a prioritised plan built from them — keep their order unless a dependency forces otherwise, cite the evidence each rests on, and add nothing they did not find.
${findings
  .map(
    (finding) =>
      `<finding lane="${finding.specialist}" severity="${finding.severity}" evidence="${finding.evidence}">${finding.title} — ${finding.doThis}</finding>`,
  )
  .join('\n')}</specialists>`;
}

import { ensureSchema } from '@/db/bootstrap';
import { finishGrowthAsk, prepareGrowthAsk } from '@/lib/growth-service';
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
        groundedOn: {
          observations: plan.groundedOn.observations,
          scanRun: plan.groundedOn.scanRun,
          missingSources: plan.groundedOn.missingSources,
        },
      });
      try {
        const { streamReasoning } = await import('@/lib/provider-adapters');
        const upstream = await streamReasoning({
          organizationId,
          system: plan.system,
          messages: plan.messages,
          maxTokens: 900,
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

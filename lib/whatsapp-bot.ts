/**
 * Answering WhatsApp with a workflow.
 *
 * The inbox has been able to show what customers write and let a person reply
 * since it was built, and the graph builder has been able to run a call for
 * just as long — but the two never met. A message arrived and waited for a
 * human, always.
 *
 * A `whatsapp_message` workflow now answers it. The engine already knew how to
 * park a run and pick it up later, which is what an Ask over WhatsApp needs:
 * the question goes out, the run stops, and the customer's reply resumes it
 * whenever it arrives.
 *
 * Three things this refuses to do, in the order they are checked:
 *
 * A bot must not talk over a colleague. If somebody has claimed the
 * conversation in the inbox, the message is theirs and nothing is sent.
 *
 * A bot must not answer the same message twice. Meta retries a webhook it did
 * not get a 200 from, so the caller says whether the row was new, and only a
 * new row is dispatched.
 *
 * A bot must not pretend to read what it cannot. A photo or a voice note is
 * not a sentence for a graph to branch on, so those are left for a person.
 */

import { getRawDb } from '@/db/index';
import { enqueueJob } from '@/lib/job-queue';
import { resumeAfterWhatsAppReply } from '@/lib/workflow-engine';
import {
  botSkipReason,
  normalisePhone,
  type BotSkip,
  type InboundMessage,
} from './whatsapp-bot-rules.ts';

export { botSkipReason };
export type { BotSkip, InboundMessage };

export type BotVerdict =
  | { acted: 'resumed'; runId: string }
  | { acted: 'started'; runId: string; workflowId: string }
  | { acted: 'none'; reason: BotSkip };

/**
 * Hands an inbound message to a workflow, if one should have it.
 *
 * A parked run wins over a new one: the customer answering the question they
 * were just asked is the conversation continuing, not a new one starting.
 */
export async function dispatchInboundMessage(input: {
  organizationId: string;
  phone: string;
  message: InboundMessage;
}): Promise<BotVerdict> {
  const skip = botSkipReason(input.message);
  if (skip) return { acted: 'none', reason: skip };
  const text = (input.message.body ?? '').trim();
  const phone = normalisePhone(input.phone);

  const resumed = await resumeAfterWhatsAppReply({
    organizationId: input.organizationId,
    phone,
    text,
  });
  if (resumed) return { acted: 'resumed', runId: resumed.runId };

  const db = getRawDb();
  // Only a published one. A draft is a graph somebody is still editing, and
  // running it would put half-written sentences in front of a customer.
  const workflow = await db
    .prepare(`SELECT id FROM workflows
      WHERE organization_id = ? AND trigger_type = 'whatsapp_message'
        AND status = 'active' AND graph_json IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`)
    .bind(input.organizationId)
    .first<{ id: string }>();
  if (!workflow) return { acted: 'none', reason: 'no_workflow' };

  const runId = `wfr_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO workflow_runs
      (id, organization_id, workflow_id, trigger_type, status, input_json, variables_json)
      VALUES (?, ?, ?, 'whatsapp_message', 'queued', ?, ?)`)
    .bind(
      runId,
      input.organizationId,
      workflow.id,
      JSON.stringify({ phone, message: text }),
      // The first message is a variable like any other, so a graph can branch
      // on what they actually wrote without asking them to repeat it.
      JSON.stringify({ phone, message: text, customer_phone: phone }),
    )
    .run();
  await enqueueJob({
    type: 'workflow.execute',
    organizationId: input.organizationId,
    // One job per run, so a retried webhook that somehow got past the
    // duplicate check still cannot start the same conversation twice.
    idempotencyKey: `workflow_run_${runId}`,
    payload: { runId, channel: 'whatsapp', phone },
  });
  return { acted: 'started', runId, workflowId: workflow.id };
}

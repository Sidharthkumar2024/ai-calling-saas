import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  askGrowthManager,
  executeRecommendation,
  executionContext,
  getChat,
  getRun,
  growthBoard,
  listChats,
  listGrowthActions,
  listRuns,
  runSiteScan,
  saveDiscovery,
  updateGrowthAction,
} from '@/lib/growth-service';
import {
  alreadyDone,
  EXECUTION_STATUSES,
  offersFor,
  type ExecutionKind,
  type ExecutionStatus,
} from '@/lib/growth-execution';
import { composeGoalPrompt, workspaceChips } from '@/lib/growth-chat';
import { businessStepError } from '@/lib/business-onboarding';
import { DISCOVERY_QUESTIONS } from '@/lib/growth-manager';

export const dynamic = 'force-dynamic';

/**
 * The AI Business Manager board (§6).
 *
 * Read is `analytics.view`: the observations are the workspace's own numbers.
 * Writing discovery answers is `workspace.manage`, because those answers steer
 * what the agent says and what the growth plan recommends.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const params = new URL(request.url).searchParams;
  const chatId = params.get('chat');
  if (chatId)
    return NextResponse.json({
      chatId,
      messages: await getChat(organizationId, chatId),
    });
  const runId = params.get('run');
  if (runId) {
    const run = await getRun(organizationId, runId);
    if (!run)
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    return NextResponse.json({ run });
  }
  const [board, runs, chats, actions, context] = await Promise.all([
    growthBoard(organizationId),
    listRuns(organizationId),
    listChats(organizationId),
    listGrowthActions(organizationId),
    executionContext(organizationId),
  ]);
  // §6's Execution row. Each offer names what it will do in this workspace's
  // own numbers, and carries the reason when it cannot be done — a hidden
  // button never answers "why can't I do this?".
  const offers = board.recommendations.flatMap((recommendation) =>
    offersFor(recommendation, context),
  );
  return NextResponse.json({
    ...board,
    canManage: auth.access.permissions.includes('workspace.manage'),
    runs,
    chats,
    actions,
    offers,
    done: [...alreadyDone(offers, actions)],
    // Composed from what the workspace already told us, so nobody retypes
    // their own business into an empty box every time.
    chips: workspaceChips(board.discovery.answers),
    suggestedGoal: composeGoalPrompt({ answers: board.discovery.answers }),
  });
}

export async function POST(request: Request) {
  // Asking a question reads the workspace's own numbers back, so it needs the
  // same permission as reading the board. Saving discovery answers steers what
  // the agent says on live calls, and scanning makes the server fetch a URL —
  // both are workspace changes and are gated as such.
  const body = (await request.json().catch(() => null)) as {
    step?: number;
    action?: string;
    answers?: Record<string, string>;
    siteUrl?: string;
    question?: string;
    chatId?: string;
    recommendationId?: string;
    kind?: string;
    actionId?: string;
    status?: string;
  };
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json(
      { error: 'A JSON object is required.' },
      { status: 400 },
    );
  const auth = await requireCustomerPermission(
    request,
    body.action === 'ask' ? 'analytics.view' : 'workspace.manage',
  );
  if (auth.response) return auth.response;
  await ensureSchema();
  if (body.action === 'ask') {
    const question = String(body.question ?? '').trim();
    if (!question)
      return NextResponse.json({ error: 'Ask something.' }, { status: 400 });
    return NextResponse.json(
      await askGrowthManager({
        organizationId: auth.session.organizationId!,
        userId: auth.session.userId,
        chatId: body.chatId ?? null,
        question: question.slice(0, 2000),
      }),
    );
  }
  if (body.action === 'scan_site') {
    const site = String(body.siteUrl ?? '').trim();
    if (!site)
      return NextResponse.json(
        { error: 'Enter your website address.' },
        { status: 400 },
      );
    const result = await runSiteScan({
      organizationId: auth.session.organizationId!,
      userId: auth.session.userId,
      siteUrl: site,
    });
    // A refused or unreachable site is a 200 carrying the reason, not a 500:
    // the run happened, it is stored, and the reason is the useful part.
    return NextResponse.json(result);
  }
  if (body.action === 'execute') {
    const kind = String(body.kind ?? '');
    if (!['campaign', 'task', 'workflow'].includes(kind))
      return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 });
    const result = await executeRecommendation({
      organizationId: auth.session.organizationId!,
      userId: auth.session.userId,
      recommendationId: String(body.recommendationId ?? ''),
      kind: kind as ExecutionKind,
    });
    // A refusal is a 200 carrying the reason, not a 500: the check ran, and
    // the reason is the useful part of the answer.
    return NextResponse.json(result);
  }

  if (body.action === 'update_action') {
    const status = String(body.status ?? '');
    if (!(EXECUTION_STATUSES as readonly string[]).includes(status))
      return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
    return NextResponse.json(
      await updateGrowthAction({
        organizationId: auth.session.organizationId!,
        actionId: String(body.actionId ?? ''),
        status: status as ExecutionStatus,
      }),
    );
  }

  if (body.action !== 'save_discovery')
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (
    !body.answers ||
    typeof body.answers !== 'object' ||
    Array.isArray(body.answers) ||
    Object.entries(body.answers).some(
      ([key, value]) =>
        !DISCOVERY_QUESTIONS.some((question) => question.id === key) ||
        typeof value !== 'string' ||
        value.length > 2000,
    )
  )
    return NextResponse.json(
      {
        error:
          'Provide supported business answers, each up to 2000 characters.',
      },
      { status: 400 },
    );
  if (body.step !== undefined) {
    if (![0, 1, 2].includes(body.step))
      return NextResponse.json(
        { error: 'Invalid setup step.' },
        { status: 400 },
      );
    for (let step = 0; step <= body.step; step++) {
      const error = businessStepError(step, body.answers);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
  }
  const state = await saveDiscovery({
    organizationId: auth.session.organizationId!,
    answers: body.answers ?? {},
  });
  return NextResponse.json({ ok: true, discovery: state });
}

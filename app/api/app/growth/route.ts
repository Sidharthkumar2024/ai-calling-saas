import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  askGrowthManager,
  getChat,
  getRun,
  growthBoard,
  listChats,
  listRuns,
  runSiteScan,
  saveDiscovery,
} from '@/lib/growth-service';
import { composeGoalPrompt, workspaceChips } from '@/lib/growth-chat';

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
  const [board, runs, chats] = await Promise.all([
    growthBoard(organizationId),
    listRuns(organizationId),
    listChats(organizationId),
  ]);
  return NextResponse.json({
    ...board,
    runs,
    chats,
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
  const body = (await request.json()) as {
    action?: string;
    answers?: Record<string, string>;
    siteUrl?: string;
    question?: string;
    chatId?: string;
  };
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
  if (body.action !== 'save_discovery')
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const state = await saveDiscovery({
    organizationId: auth.session.organizationId!,
    answers: body.answers ?? {},
  });
  return NextResponse.json({ ok: true, discovery: state });
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  branchesOf,
  layoutGraph,
  NODE_SPECS,
  CHAT_TRIGGERS,
  SILENT_TRIGGERS,
  validateWorkflow,
  type NodeKind,
  type NodeSpec,
  type TriggerEvent,
  type WorkflowGraph,
  type WorkflowNode,
} from '@/lib/workflow-nodes';

/**
 * The visual workflow builder (§7).
 *
 * The canvas lays itself out. Nodes sit in columns by distance from the
 * trigger and the connectors are drawn from the wiring, so the picture is
 * always the graph — there is no separate set of coordinates to drift out of
 * step with what actually runs, and no way to drag a box somewhere that
 * misrepresents the flow.
 *
 * Validation runs as you edit, and every issue is a button that selects the
 * step it is about. Publishing is gated on it. That gate is the point of the
 * screen: the executor this replaces marked every step complete without
 * running it, so a broken workflow and a working one looked the same.
 */

type Summary = {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  status: string;
  steps: number;
  runCount: number;
  failureCount: number;
  lastRunAt: string | null;
  needsRebuild: boolean;
  ready: boolean;
};

type Template = {
  key: string;
  name: string;
  flow: string;
  industry: string;
  steps: number;
};

type CallPlan = {
  steps: Array<{
    nodeId: string;
    label: string;
    instruction: string;
    tool: string | null;
  }>;
  collect: string[];
  notes: string[];
};

type RunTrace = {
  runId: string;
  status: string;
  steps: number;
  error?: string;
  trace: Array<{ nodeId: string; kind: string; status: string; note: string }>;
};

type Catalogue = {
  workflows: Summary[];
  templates: Template[];
  objects: Array<{ key: string; name: string }>;
  queues: Array<{ id: string; name: string }>;
};

const NODE_WIDTH = 196;
const NODE_HEIGHT = 76;
const COLUMN_GAP = 76;
const ROW_GAP = 22;

/** The step types offered on the palette. Trigger is not among them: a graph has exactly one. */
const PALETTE: NodeKind[] = [
  'say',
  'ask',
  'ai_decision',
  'crm_lookup',
  'object_search',
  'condition',
  'document_request',
  'booking',
  'payment',
  'approval',
  'message',
  'human_transfer',
  'end',
];

export function CustomerWorkflowBuilder() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [legacySteps, setLegacySteps] = useState<string[] | null>(null);
  const [callPlan, setCallPlan] = useState<CallPlan | null>(null);
  const [run, setRun] = useState<RunTrace | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const loadCatalogue = useCallback(async () => {
    try {
      const response = await fetch('/api/app/workflow-builder');
      if (!response.ok) throw new Error('Workflows could not be loaded.');
      setCatalogue((await response.json()) as Catalogue);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Workflows could not be loaded.',
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalogue(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalogue]);

  const openWorkflow = useCallback(async (id: string) => {
    setBusy('open');
    setRun(null);
    try {
      const response = await fetch(
        `/api/app/workflow-builder?workflow=${encodeURIComponent(id)}`,
      );
      const payload = (await response.json()) as {
        workflow?: Summary;
        graph?: WorkflowGraph | null;
        callPlan?: CallPlan | null;
        legacySteps?: string[] | null;
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? 'That workflow could not be opened.');
      setOpenId(id);
      setName(payload.workflow?.name ?? '');
      setDescription(payload.workflow?.description ?? '');
      setGraph(payload.graph ?? emptyGraph());
      setLegacySteps(payload.legacySteps ?? null);
      setCallPlan(payload.callPlan ?? null);
      setSelected(payload.graph?.nodes[0]?.id ?? null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'That workflow could not be opened.',
      );
    } finally {
      setBusy('');
    }
  }, []);

  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/app/workflow-builder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      payload: (await response.json()) as Record<string, unknown>,
    };
  }

  const validation = useMemo(
    () => (graph ? validateWorkflow(graph, { mode: 'publish' }) : null),
    [graph],
  );

  if (error)
    return (
      <p role="alert" className="text-[11px] text-danger-text">
        {error}
      </p>
    );
  if (!catalogue) return null;

  /* ---------------- the list ---------------- */

  if (!openId && !graph)
    return (
      <div className="space-y-6">
        <section className="portal-panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Workflows</h2>
              <p className="mt-1 text-[11px] text-ink-muted">
                A workflow is a graph the agent follows: ask, look up, decide,
                book, charge, transfer, close. It goes live only once every path
                reaches an End step.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpenId(null);
                setGraph(emptyGraph());
                setName('');
                setDescription('');
                setSelected('trigger');
                setLegacySteps(null);
                setRun(null);
              }}
              className="portal-primary rounded-lg px-4 py-2 text-[11px]"
            >
              New workflow
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {catalogue.workflows.length === 0 ? (
              <p className="text-[11px] text-ink-muted">
                Nothing here yet. Start from a template below, or build one from
                scratch.
              </p>
            ) : null}
            {catalogue.workflows.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => void openWorkflow(workflow.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-hairline bg-surface px-3 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium">
                    {workflow.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-muted">
                    {workflow.trigger.replace(/_/g, ' ')} · {workflow.steps}{' '}
                    steps · {workflow.runCount} runs
                    {workflow.failureCount > 0
                      ? ` · ${workflow.failureCount} failed`
                      : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[11px]">
                  {workflow.needsRebuild ? (
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-warning-text">
                      needs rebuilding
                    </span>
                  ) : (
                    <StatusChip
                      status={workflow.status}
                      ready={workflow.ready}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="portal-panel p-5">
          <h2 className="text-sm font-semibold">Start from a template</h2>
          <p className="mt-1 text-[11px] text-ink-muted">
            Each one installs as a draft, because the objects, queues and
            amounts in it belong to your workspace and not to the template.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {catalogue.templates.map((template) => (
              <div
                key={template.key}
                className="rounded-lg border border-hairline bg-surface p-3"
              >
                <p className="text-[11px] font-medium">{template.name}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-muted">
                  {template.industry} · {template.steps} steps
                </p>
                <p className="mt-1.5 text-[11px] text-ink-muted">
                  {template.flow}
                </p>
                <button
                  type="button"
                  disabled={busy === template.key}
                  onClick={async () => {
                    setBusy(template.key);
                    const { ok, payload } = await post({
                      action: 'install_template',
                      templateKey: template.key,
                    });
                    setBusy('');
                    if (ok && typeof payload.workflowId === 'string') {
                      await loadCatalogue();
                      await openWorkflow(payload.workflowId);
                    }
                  }}
                  className="mt-2 rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-60"
                >
                  {busy === template.key ? 'Installing…' : 'Use this'}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    );

  /* ---------------- the canvas ---------------- */

  const current = graph!;
  const node = current.nodes.find((entry) => entry.id === selected) ?? null;
  const positions = layoutGraph(current);
  const placed = new Map(positions.map((entry) => [entry.id, entry]));
  const columns = Math.max(1, ...positions.map((entry) => entry.column + 1));
  const rows = Math.max(1, ...positions.map((entry) => entry.row + 1));
  const canvasWidth = columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP + 32;
  const canvasHeight = rows * NODE_HEIGHT + (rows - 1) * ROW_GAP + 32;

  const at = (id: string) => {
    const spot = placed.get(id);
    if (!spot) return null;
    return {
      x: 16 + spot.column * (NODE_WIDTH + COLUMN_GAP),
      y: 16 + spot.row * (NODE_HEIGHT + ROW_GAP),
    };
  };

  const update = (next: WorkflowGraph) => {
    setGraph(next);
    setNotice(null);
  };

  const patchNode = (id: string, patch: Partial<WorkflowNode>) =>
    update({
      nodes: current.nodes.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    });

  const addNode = (kind: NodeKind) => {
    const id = `${kind}_${crypto.randomUUID().slice(0, 5)}`;
    const fresh: WorkflowNode = {
      id,
      kind,
      name: NODE_SPECS[kind].label,
      config: {},
      next: {},
    };
    update({ nodes: [...current.nodes, fresh] });
    setSelected(id);
  };

  const removeNode = (id: string) => {
    update({
      nodes: current.nodes
        .filter((entry) => entry.id !== id)
        .map((entry) => ({
          ...entry,
          // Anything wired into the deleted step becomes an unwired exit, which
          // the validator then reports. Silently re-pointing it somewhere else
          // would move the workflow without saying so.
          next: Object.fromEntries(
            Object.entries(entry.next ?? {}).map(([branch, target]) => [
              branch,
              target === id ? null : target,
            ]),
          ),
        })),
    });
    setSelected(null);
  };

  const triggerEvent = (current.nodes.find((entry) => entry.kind === 'trigger')
    ?.config.event ?? '') as TriggerEvent | '';
  const silent = triggerEvent !== '' && SILENT_TRIGGERS.includes(triggerEvent);
  const onChat = triggerEvent !== '' && CHAT_TRIGGERS.includes(triggerEvent);

  return (
    <div className="space-y-4">
      <section className="portal-panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setOpenId(null);
              setGraph(null);
              setRun(null);
              void loadCatalogue();
            }}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[11px]"
          >
            ← All workflows
          </button>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this workflow"
            aria-label="Workflow name"
            className="min-w-[180px] flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[11px]"
          />
          <button
            type="button"
            disabled={busy === 'save'}
            onClick={async () => {
              setBusy('save');
              const { ok, payload } = await post({
                action: 'save',
                workflowId: openId,
                name,
                description,
                graph: current,
              });
              setBusy('');
              if (!ok) {
                setNotice(
                  messageFrom(
                    payload.error,
                    'This workflow could not be saved.',
                  ),
                );
                return;
              }
              if (typeof payload.workflowId === 'string')
                setOpenId(payload.workflowId);
              setNotice(
                payload.droppedToDraft === true
                  ? 'Saved. It went back to draft — a live workflow is not swapped under calls already running on it.'
                  : 'Saved.',
              );
              void loadCatalogue();
            }}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-60"
          >
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            disabled={!openId || busy === 'publish' || !validation?.ok}
            title={
              validation?.ok
                ? 'Go live'
                : 'Every path has to reach an End step before this can go live.'
            }
            onClick={async () => {
              setBusy('publish');
              const { ok, payload } = await post({
                action: 'publish',
                workflowId: openId,
              });
              setBusy('');
              setNotice(
                ok
                  ? 'Live. New calls on this trigger follow it.'
                  : messageFrom(
                      payload.error,
                      'This workflow is not ready to go live.',
                    ),
              );
              void loadCatalogue();
            }}
            className="portal-primary rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-50"
          >
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
          <button
            type="button"
            disabled={!openId || busy === 'test'}
            title="This runs for real: it books, messages and creates links."
            onClick={async () => {
              setBusy('test');
              const { payload } = await post({
                action: 'test_run',
                workflowId: openId,
              });
              setBusy('');
              setRun((payload.run as RunTrace) ?? null);
              if (payload.error)
                setNotice(messageFrom(payload.error, 'The test run failed.'));
            }}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-60"
          >
            {busy === 'test' ? 'Running…' : 'Test run'}
          </button>
        </div>
        {notice ? (
          <p className="mt-2 text-[11px] text-ink-muted">{notice}</p>
        ) : null}
        {legacySteps && legacySteps.length > 0 ? (
          <p className="mt-2 rounded-lg border border-hairline bg-surface-muted p-2.5 text-[11px] text-ink-muted">
            This workflow was written before the canvas existed, as a list of
            step names:{' '}
            <span className="font-medium">{legacySteps.join(' → ')}</span>.
            Nothing was converted automatically — rebuild it here so what runs
            matches what you see.
          </p>
        ) : null}
      </section>

      {/* Say and Ask mean something different here, and somebody building this
          graph should read that before they build it rather than after the
          first customer waits an hour for an answer. */}
      {onChat ? (
        <p className="rounded-xl border border-hairline bg-surface-muted px-4 py-3 text-[11px] text-ink-body">
          This workflow answers WhatsApp. <strong>Say</strong> sends a message
          rather than speaking, and <strong>Ask</strong> sends the question and
          then stops — the run picks up again whenever the customer writes back,
          which may be minutes or a day. Nothing is sent to a conversation
          somebody on your team has claimed in the inbox.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="portal-panel overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline p-3">
            <span className="mr-1 text-[11px] uppercase tracking-wide text-ink-muted">
              Add
            </span>
            {PALETTE.map((kind) => {
              const spec = NODE_SPECS[kind];
              const blocked = spec.needsConversation && silent;
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={blocked}
                  title={
                    blocked
                      ? `${spec.label} speaks to the caller, and a ${String(triggerEvent).replace('_', ' ')} workflow has no call.`
                      : spec.purpose
                  }
                  onClick={() => addNode(kind)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[11px] disabled:opacity-40"
                >
                  {spec.label}
                </button>
              );
            })}
          </div>

          <div className="overflow-auto p-1">
            <div
              className="relative"
              style={{
                width: canvasWidth,
                height: canvasHeight,
                minWidth: '100%',
              }}
            >
              <svg
                width={canvasWidth}
                height={canvasHeight}
                className="pointer-events-none absolute inset-0"
                aria-hidden="true"
              >
                {current.nodes.flatMap((entry) =>
                  branchesOf(entry).map((branch) => {
                    const target = entry.next?.[branch];
                    const from = at(entry.id);
                    const to = target ? at(target) : null;
                    if (!from || !to) return null;
                    const x1 = from.x + NODE_WIDTH;
                    const y1 = from.y + NODE_HEIGHT / 2;
                    const x2 = to.x;
                    const y2 = to.y + NODE_HEIGHT / 2;
                    const mid = x1 + (x2 - x1) / 2;
                    return (
                      <g key={`${entry.id}:${branch}`}>
                        <path
                          d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.25}
                          className="text-ink-muted/40"
                        />
                        {branchesOf(entry).length > 1 ? (
                          <text
                            x={x1 + 8}
                            y={y1 - 4}
                            className="fill-current text-ink-muted"
                            style={{ fontSize: 8 }}
                          >
                            {branch}
                          </text>
                        ) : null}
                      </g>
                    );
                  }),
                )}
              </svg>

              {current.nodes.map((entry) => {
                const spot = at(entry.id);
                if (!spot) return null;
                const spec = NODE_SPECS[entry.kind];
                const issues = (validation?.errors ?? []).filter(
                  (issue) => issue.nodeId === entry.id,
                );
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelected(entry.id)}
                    style={{
                      left: spot.x,
                      top: spot.y,
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                    }}
                    className={`absolute rounded-lg border p-2.5 text-left transition-colors ${
                      selected === entry.id
                        ? 'border-primary bg-surface-muted'
                        : issues.length > 0
                          ? 'border-danger-text/50 bg-surface'
                          : 'border-hairline bg-surface'
                    }`}
                  >
                    <span className="block text-[11px] uppercase tracking-wide text-ink-muted">
                      {spec?.label ?? entry.kind}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium">
                      {entry.name?.trim() || spec?.label || entry.kind}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                      {summaryOf(entry)}
                    </span>
                    {issues.length > 0 ? (
                      <span className="mt-0.5 block text-[11px] text-danger-text">
                        {issues.length} problem{issues.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <ValidationPanel validation={validation} onSelect={setSelected} />
          {node ? (
            <NodeEditor
              node={node}
              graph={current}
              objects={catalogue.objects}
              queues={catalogue.queues}
              onChange={(patch) => patchNode(node.id, patch)}
              onDelete={() => removeNode(node.id)}
            />
          ) : (
            <section className="portal-panel p-4">
              <p className="text-[11px] text-ink-muted">
                Pick a step on the canvas to edit it, or add one from the
                palette.
              </p>
            </section>
          )}
          {callPlan && !silent ? <CallPlanPanel plan={callPlan} /> : null}
          {run ? <RunPanel run={run} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ValidationPanel({
  validation,
  onSelect,
}: {
  validation: ReturnType<typeof validateWorkflow> | null;
  onSelect: (id: string) => void;
}) {
  if (!validation) return null;
  const issues = [
    ...validation.errors.map((issue) => ({
      ...issue,
      level: 'error' as const,
    })),
    ...validation.warnings.map((issue) => ({
      ...issue,
      level: 'warning' as const,
    })),
  ];
  return (
    <section className="portal-panel p-4">
      <h3 className="text-[11px] font-semibold">
        {validation.ok
          ? 'Ready to publish'
          : `${validation.errors.length} to fix before going live`}
      </h3>
      {issues.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-muted">
          Every path reaches an End step and every exit is wired.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {issues.map((issue, index) => (
            <li key={`${issue.nodeId ?? 'graph'}-${index}`}>
              <button
                type="button"
                disabled={!issue.nodeId}
                onClick={() => issue.nodeId && onSelect(issue.nodeId)}
                className={`w-full text-left text-[11px] ${
                  issue.level === 'error'
                    ? 'text-danger-text'
                    : 'text-ink-muted'
                } ${issue.nodeId ? 'underline decoration-dotted underline-offset-2' : ''}`}
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CallPlanPanel({ plan }: { plan: CallPlan }) {
  return (
    <section className="portal-panel p-4">
      <h3 className="text-[11px] font-semibold">On a live call</h3>
      <p className="mt-1 text-[11px] text-ink-muted">
        On a phone call the agent drives the conversation and calls the tools,
        so this workflow becomes its plan rather than a script that seizes the
        audio. Webhook and scheduled workflows are the opposite — there the
        engine runs every step itself.
      </p>
      {plan.collect.length > 0 ? (
        <p className="mt-2 text-[11px]">
          <span className="text-ink-muted">Collects: </span>
          {plan.collect.join(', ')}
        </p>
      ) : null}
      <ol className="mt-2 space-y-1">
        {plan.steps.slice(0, 12).map((step, index) => (
          <li key={step.nodeId} className="text-[11px] text-ink-muted">
            <span className="font-medium text-ink">
              {index + 1}. {step.label}
            </span>
            {step.tool ? (
              <span className="ml-1 text-[11px]">({step.tool})</span>
            ) : null}
          </li>
        ))}
      </ol>
      {plan.notes.map((note) => (
        <p key={note} className="mt-1.5 text-[11px] text-warning-text">
          {note}
        </p>
      ))}
    </section>
  );
}

function RunPanel({ run }: { run: RunTrace }) {
  const skipped = run.trace.filter((step) => step.status === 'skipped').length;
  return (
    <section className="portal-panel p-4">
      <h3 className="text-[11px] font-semibold">Test run — {run.status}</h3>
      <p className="mt-1 text-[11px] text-ink-muted">
        {run.steps} steps
        {skipped > 0 ? `, ${skipped} of them skipped` : ''}. A skipped step says
        why; it is not counted as done.
      </p>
      {run.error ? (
        <p className="mt-1 text-[11px] text-danger-text">{run.error}</p>
      ) : null}
      <ol className="mt-2 space-y-1">
        {run.trace.map((step, index) => (
          <li key={`${step.nodeId}-${index}`} className="text-[11px]">
            <span
              className={
                step.status === 'failed'
                  ? 'text-danger-text'
                  : step.status === 'skipped'
                    ? 'text-warning-text'
                    : 'text-ink-muted'
              }
            >
              {step.status}
            </span>{' '}
            <span className="font-medium">{step.nodeId}</span>
            {step.note ? (
              <span className="text-ink-muted"> — {step.note}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function NodeEditor({
  node,
  graph,
  objects,
  queues,
  onChange,
  onDelete,
}: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  objects: Array<{ key: string; name: string }>;
  queues: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<WorkflowNode>) => void;
  onDelete: () => void;
}) {
  const spec: NodeSpec = NODE_SPECS[node.kind];
  const setConfig = (key: string, value: unknown) =>
    onChange({ config: { ...node.config, [key]: value } });

  const optionsFor = (key: string, fixed?: string[]) => {
    if (fixed && fixed.length > 0)
      return fixed.map((entry) => ({ value: entry, label: entry }));
    if (key === 'object')
      return objects.map((entry) => ({ value: entry.key, label: entry.name }));
    if (key === 'queue')
      return queues.map((entry) => ({ value: entry.id, label: entry.name }));
    return [];
  };

  return (
    <section className="portal-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold">{spec.label}</h3>
          <p className="mt-0.5 text-[11px] text-ink-muted">{spec.purpose}</p>
        </div>
        {node.kind === 'trigger' ? null : (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 rounded-lg border border-hairline px-2 py-1 text-[11px]"
          >
            Delete
          </button>
        )}
      </div>

      <label className="mt-3 block">
        <span className="text-[11px] font-medium">Step name</span>
        <input
          value={node.name ?? ''}
          onChange={(event) => onChange({ name: event.target.value })}
          className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
        />
      </label>

      {spec.fields.map((field) => {
        const value = node.config?.[field.key];
        const text =
          typeof value === 'string'
            ? value
            : Array.isArray(value)
              ? value.join('\n')
              : '';
        return (
          <label key={field.key} className="mt-2.5 block">
            <span className="text-[11px] font-medium">
              {field.label}
              {field.required ? null : (
                <span className="ml-1 text-[11px] text-ink-muted">
                  optional
                </span>
              )}
            </span>
            {field.help ? (
              <span className="mt-0.5 block text-[11px] text-ink-muted">
                {field.help}
              </span>
            ) : null}
            {field.type === 'select' ? (
              <select
                value={text}
                onChange={(event) => setConfig(field.key, event.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
              >
                <option value="">Choose…</option>
                {optionsFor(field.key, field.options).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' || field.type === 'list' ? (
              <textarea
                rows={field.type === 'list' ? 3 : 2}
                value={text}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setConfig(
                    field.key,
                    field.type === 'list'
                      ? event.target.value
                          .split('\n')
                          .filter((entry) => entry.trim())
                      : event.target.value,
                  )
                }
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
              />
            ) : (
              <input
                value={text}
                placeholder={field.placeholder}
                onChange={(event) => setConfig(field.key, event.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
              />
            )}
          </label>
        );
      })}

      {branchesOf(node).length > 0 ? (
        <div className="mt-3.5 border-t border-hairline pt-3">
          <p className="text-[11px] font-medium">Where each exit goes</p>
          {branchesOf(node).map((branch) => (
            <label key={branch} className="mt-1.5 flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[11px] text-ink-muted">
                {branch}
              </span>
              <select
                value={node.next?.[branch] ?? ''}
                aria-label={`Where the ${branch} exit goes`}
                onChange={(event) =>
                  onChange({
                    next: {
                      ...node.next,
                      [branch]: event.target.value || null,
                    },
                  })
                }
                className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
              >
                <option value="">Not wired</option>
                {graph.nodes
                  .filter(
                    (entry) => entry.id !== node.id && entry.kind !== 'trigger',
                  )
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name?.trim() ||
                        NODE_SPECS[entry.kind]?.label ||
                        entry.id}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function StatusChip({ status, ready }: { status: string; ready: boolean }) {
  if (status === 'active')
    return (
      <span className="rounded-full border border-hairline px-2 py-0.5">
        live
      </span>
    );
  return (
    <span className="rounded-full border border-hairline px-2 py-0.5 text-ink-muted">
      {status}
      {status === 'draft' && ready ? ' · ready' : ''}
    </span>
  );
}

/** API errors are JSON, so only a string in the `error` field is a message. */
function messageFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function emptyGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'trigger',
        kind: 'trigger',
        name: 'Trigger',
        config: { event: 'inbound_call' },
        next: {},
      },
    ],
  };
}

function summaryOf(node: WorkflowNode): string {
  const config = node.config ?? {};
  const first = (key: string) =>
    typeof config[key] === 'string' ? (config[key] as string) : '';
  if (node.kind === 'trigger') return first('event').replace(/_/g, ' ');
  if (node.kind === 'ask') return first('question');
  if (node.kind === 'say') return first('text');
  if (node.kind === 'condition') return first('expression');
  if (node.kind === 'ai_decision') return first('instruction');
  if (node.kind === 'object_search') return first('object');
  if (node.kind === 'crm_lookup')
    return `${first('entity')} by ${first('match')}`;
  if (node.kind === 'end') return first('disposition');
  if (node.kind === 'message') return first('body');
  if (node.kind === 'payment') return first('purpose');
  if (node.kind === 'booking') return first('service');
  if (node.kind === 'approval') return first('action');
  if (node.kind === 'document_request') return first('document');
  if (node.kind === 'human_transfer') return first('skill') || first('reason');
  return '';
}

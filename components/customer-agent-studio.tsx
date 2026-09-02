'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Languages,
  Loader2,
  MessageCircleMore,
  Mic2,
  PhoneCall,
  PhoneOff,
  Play,
  Plus,
  Save,
  Send,
  Settings2,
  Sparkles,
  SquareFunction,
  WandSparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_PRESETS } from '@/lib/agent-presets';
import { VAANI_VOICES } from '@/lib/voice-catalog';

export type VoiceAgentRow = {
  id: string;
  name: string;
  use_case: string;
  status: string;
  welcome_message: string;
  system_prompt: string;
  primary_language: string;
  voice_name: string;
  intelligence_profile: string;
  temperature: number;
  max_tokens: number;
  endpointing_ms: number;
  interrupt_words: number;
  tools_json: string;
  extractions_json: string;
  calling_config_json: string;
  cost_per_minute: number;
  updated_at: string;
};

export type AgentsData = {
  agents?: VoiceAgentRow[];
  onboarding?: {
    stage?: string;
    use_case?: string;
    primary_language?: string;
    trial_granted_at?: string;
  };
  wallet?: { balance?: number; low_balance_threshold?: number };
  testSessions?: Array<{
    id: string;
    agent_id: string;
    mode: string;
    credits_used: number;
    message_count: number;
  }>;
};

type AgentDraft = {
  id: string;
  name: string;
  useCase: string;
  welcomeMessage: string;
  systemPrompt: string;
  primaryLanguage: string;
  voiceName: string;
  intelligenceProfile: string;
  temperature: number;
  maxTokens: number;
  endpointingMs: number;
  interruptWords: number;
  tools: string[];
  extractions: string[];
  callingConfig: Record<string, unknown>;
};

type TranscriptMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  latencyMs?: number;
  actions?: Array<{ type: string; label: string; status: string }>;
};

const studioTabs = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'intelligence', label: 'Intelligence', icon: BrainCircuit },
  { id: 'languages', label: 'Languages', icon: Languages },
  { id: 'engine', label: 'Engine', icon: Settings2 },
  { id: 'tools', label: 'Actions', icon: SquareFunction },
  { id: 'extractions', label: 'Extractions', icon: Code2 },
  { id: 'calling', label: 'Calling', icon: PhoneCall },
] as const;

export function CustomerAgentStudio({
  data,
  businessName,
  onChanged,
}: {
  data: AgentsData;
  businessName: string;
  onChanged: () => Promise<void>;
}) {
  const agents = data.agents ?? [];
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? '');
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const [tab, setTab] = useState<(typeof studioTabs)[number]['id']>('agent');
  const [draft, setDraft] = useState<AgentDraft | null>(
    selected ? toDraft(selected) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selected) setDraft(toDraft(selected));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selected]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/app/agents', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? 'Unable to save agent.');
      setNotice('Agent settings saved. No external provider was called.');
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to save agent.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function createAgent() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/app/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `Agent ${agents.length + 1}`,
          useCase: 'sales',
          language: 'hi-IN',
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        error?: string;
      };
      if (!response.ok || !payload.id)
        throw new Error(payload.error ?? 'Unable to create agent.');
      setSelectedId(payload.id);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to create agent.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!draft || !selected) {
    return (
      <div className="rounded-2xl border border-white/8 bg-[#0e1119] p-8 text-center">
        <Bot className="mx-auto size-6 text-white/30" />
        <p className="mt-3 text-sm">No agent is configured.</p>
        <Button
          onClick={createAgent}
          className="mt-5 bg-amber-300 text-black hover:bg-amber-200"
        >
          <Plus /> Create first agent
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">
            Build · Test · Publish
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Agent Studio
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">
            Configure the conversation, intelligence, voice and actions, then
            test without making a phone call.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="h-9 gap-2 rounded-lg border-amber-300/15 bg-amber-300/5 px-3 text-amber-100"
          >
            <CircleDollarSign className="size-3.5" />{' '}
            {Number(data.wallet?.balance ?? 0).toLocaleString('en-IN')} credits
          </Badge>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-amber-300 text-[#17120a] hover:bg-amber-200"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
            agent
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-100">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[230px_minmax(0,1fr)_430px]">
        <aside className="rounded-2xl border border-white/8 bg-[#0e1119] p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
              Your agents
            </p>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={createAgent}
              aria-label="Create agent"
            >
              <Plus />
            </Button>
          </div>
          <div className="mt-2 space-y-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setSelectedId(agent.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${selected.id === agent.id ? 'border-amber-300/20 bg-amber-300/[0.045]' : 'border-white/6 bg-white/[0.015] hover:bg-white/[0.035]'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-300/10">
                    <Bot className="size-4 text-violet-200" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{agent.name}</p>
                    <p className="mt-1 truncate text-[9px] capitalize text-white/30">
                      {agent.use_case.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <ChevronRight className="mt-2 size-3 text-white/20" />
                </div>
                <div className="mt-3 flex items-center justify-between text-[9px]">
                  <span className="rounded-full border border-emerald-400/12 bg-emerald-400/6 px-2 py-1 capitalize text-emerald-300">
                    {agent.status}
                  </span>
                  <span className="text-white/28">
                    ₹{(agent.cost_per_minute / 100).toFixed(2)}/min
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3">
            <p className="text-[10px] font-medium text-cyan-100">
              Trial safety
            </p>
            <p className="mt-2 text-[9px] leading-4 text-white/34">
              Text and browser voice work immediately. Phone calls stay locked
              until number verification and KYC.
            </p>
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-white/8 bg-[#0e1119]">
          <div className="flex flex-col gap-4 border-b border-white/8 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                className="h-9 max-w-sm border-transparent bg-transparent px-0 text-lg font-semibold focus-visible:border-white/10"
              />
              <p className="mt-1 text-[10px] text-white/28">
                Vaani Voice · India routing · customer-safe provider abstraction
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-right">
              <p className="text-[9px] text-white/28">Estimated live cost</p>
              <p className="mt-1 text-xs font-medium">
                ₹{(selected.cost_per_minute / 100).toFixed(2)} / minute
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border-b border-white/8 p-2">
            <div className="flex min-w-max gap-1">
              {studioTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] ${tab === item.id ? 'bg-white/8 text-white' : 'text-white/35 hover:bg-white/[0.035] hover:text-white/60'}`}
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-5 sm:p-6">
            <SettingsPanel tab={tab} draft={draft} setDraft={setDraft} />
          </div>
        </section>

        <TestConsole
          key={selected.id}
          agent={selected}
          businessName={businessName}
          initialCredits={Number(data.wallet?.balance ?? 0)}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

function SettingsPanel({
  tab,
  draft,
  setDraft,
}: {
  tab: (typeof studioTabs)[number]['id'];
  draft: AgentDraft;
  setDraft: (draft: AgentDraft) => void;
}) {
  const [voiceCountry, setVoiceCountry] = useState('all');
  const [voiceStyle, setVoiceStyle] = useState('all');
  const filteredVoices = VAANI_VOICES.filter(
    (voice) =>
      (voiceCountry === 'all' || voice.country === voiceCountry) &&
      (voiceStyle === 'all' || voice.style === voiceStyle),
  );
  if (tab === 'agent')
    return (
      <div className="space-y-6">
        <SettingSection
          title="Pre-trained industry playbooks"
          note="Start from a focused sales or support flow, then add your approved business knowledge"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {AGENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    name: preset.name,
                    useCase: preset.useCase,
                    welcomeMessage: preset.welcomeMessage,
                    systemPrompt: preset.systemPrompt,
                    primaryLanguage: preset.primaryLanguage,
                    voiceName: preset.voiceName,
                    tools: preset.tools,
                    extractions: preset.extractions,
                    callingConfig: {
                      ...draft.callingConfig,
                      presetId: preset.id,
                      conversationStages: preset.conversationStages,
                    },
                  })
                }
                className={`rounded-xl border p-4 text-left transition ${draft.useCase === preset.useCase ? 'border-cyan-300/20 bg-cyan-300/[0.04]' : 'border-white/7 bg-white/[0.015] hover:bg-white/[0.035]'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-cyan-300/8">
                    <BriefcaseBusiness className="size-4 text-cyan-100" />
                  </span>
                  <Badge
                    variant="outline"
                    className="border-white/8 text-[8px] text-white/38"
                  >
                    {preset.industry}
                  </Badge>
                </div>
                <p className="mt-3 text-xs font-medium">{preset.name}</p>
                <p className="mt-2 text-[9px] leading-4 text-white/34">
                  {preset.description}
                </p>
              </button>
            ))}
          </div>
        </SettingSection>
        <SettingSection
          title="Welcome message"
          note="The first sentence the customer hears"
        >
          <Field label="Opening line">
            <Input
              value={draft.welcomeMessage}
              onChange={(event) =>
                setDraft({ ...draft, welcomeMessage: event.target.value })
              }
            />
          </Field>
        </SettingSection>
        <SettingSection
          title="Conversation canvas"
          note="Goal, tone, guardrails and tool policy"
        >
          <Field label="System instructions">
            <Textarea
              value={draft.systemPrompt}
              onChange={(event) =>
                setDraft({ ...draft, systemPrompt: event.target.value })
              }
              className="min-h-44"
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              '{{customer_name}}',
              '{{product}}',
              '{{amount}}',
              '@create_payment_link',
            ].map((token) => (
              <code
                key={token}
                className="rounded-lg bg-white/5 px-2 py-1 text-[9px] text-cyan-100/65"
              >
                {token}
              </code>
            ))}
          </div>
        </SettingSection>
      </div>
    );
  if (tab === 'intelligence')
    return (
      <div className="space-y-6">
        <SettingSection
          title="Vaani Sense"
          note="Provider routing remains private"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intelligence profile">
              <select
                value={draft.intelligenceProfile}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    intelligenceProfile: event.target.value,
                  })
                }
                className="input-select"
              >
                <option>Vaani Sense Fast</option>
                <option>Vaani Sense Balanced</option>
                <option>Vaani Sense Deep</option>
              </select>
            </Field>
            <Field label={`Creativity · ${draft.temperature / 100}`}>
              <input
                type="range"
                min="0"
                max="100"
                value={draft.temperature}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    temperature: Number(event.target.value),
                  })
                }
                className="mt-3 w-full accent-amber-300"
              />
            </Field>
            <Field label="Maximum reply tokens">
              <Input
                type="number"
                value={draft.maxTokens}
                onChange={(event) =>
                  setDraft({ ...draft, maxTokens: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Knowledge grounding">
              <div className="input-static">
                <CheckCircle2 className="size-4 text-emerald-300" /> Approved
                workspace sources only
              </div>
            </Field>
          </div>
        </SettingSection>
      </div>
    );
  if (tab === 'languages')
    return (
      <div className="space-y-6">
        <SettingSection
          title="Language and voice"
          note="Regional catalog with private provider routing and language-specific voice selection"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary language">
              <select
                value={draft.primaryLanguage}
                onChange={(event) =>
                  setDraft({ ...draft, primaryLanguage: event.target.value })
                }
                className="input-select"
              >
                <option value="hinglish">Hinglish</option>
                <option value="haryanvi">Haryanvi</option>
                <option value="hi-IN">Hindi</option>
                <option value="en-IN">Indian English</option>
                <option value="bn-IN">Bengali</option>
                <option value="ta-IN">Tamil</option>
                <option value="te-IN">Telugu</option>
                <option value="mr-IN">Marathi</option>
              </select>
            </Field>
            <Field label="Voice country / region">
              <select
                value={voiceCountry}
                onChange={(event) => setVoiceCountry(event.target.value)}
                className="input-select"
              >
                <option value="all">All regions</option>
                {Array.from(
                  new Map(
                    VAANI_VOICES.map((voice) => [
                      voice.country,
                      voice.countryLabel,
                    ]),
                  ).entries(),
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Voice style">
              <select
                value={voiceStyle}
                onChange={(event) => setVoiceStyle(event.target.value)}
                className="input-select"
              >
                <option value="all">All styles</option>
                {Array.from(
                  new Set(VAANI_VOICES.map((voice) => voice.style)),
                ).map((style) => (
                  <option key={style} value={style}>
                    {style[0].toUpperCase() + style.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vaani voice">
              <select
                value={draft.voiceName}
                onChange={(event) => {
                  const voice = VAANI_VOICES.find(
                    (item) => item.publicName === event.target.value,
                  );
                  setDraft({
                    ...draft,
                    voiceName: event.target.value,
                    ...(voice ? { primaryLanguage: voice.language } : {}),
                  });
                }}
                className="input-select"
              >
                {!filteredVoices.some(
                  (voice) => voice.publicName === draft.voiceName,
                ) ? (
                  <option>{draft.voiceName}</option>
                ) : null}
                {filteredVoices.map((voice) => (
                  <option key={voice.id} value={voice.publicName}>
                    {voice.publicName} · {voice.languageLabel}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {filteredVoices.slice(0, 4).map((voice) => (
              <button
                key={voice.id}
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    voiceName: voice.publicName,
                    primaryLanguage: voice.language,
                  })
                }
                className={`rounded-xl border p-3 text-left ${draft.voiceName === voice.publicName ? 'border-violet-300/20 bg-violet-300/[0.04]' : 'border-white/7 bg-white/[0.015]'}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">{voice.publicName}</p>
                  <span className="text-[8px] capitalize text-white/32">
                    {voice.style}
                  </span>
                </div>
                <p className="mt-2 text-[9px] text-white/34">
                  {voice.bestFor.join(' · ')}
                </p>
              </button>
            ))}
          </div>
          <Button
            type="button"
            onClick={() => {
              const voice = VAANI_VOICES.find(
                (item) => item.publicName === draft.voiceName,
              );
              previewInBrowser(
                voice?.previewText || draft.welcomeMessage,
                draft.primaryLanguage,
              );
            }}
            variant="outline"
            className="mt-4 border-white/10 bg-transparent"
          >
            <Play /> Preview selected voice
          </Button>
        </SettingSection>
      </div>
    );
  if (tab === 'engine')
    return (
      <div className="space-y-6">
        <SettingSection
          title="Response latency"
          note="Tune natural pauses and interruption handling"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Endpointing delay (ms)">
              <Input
                type="number"
                value={draft.endpointingMs}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    endpointingMs: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Words before interruption">
              <Input
                type="number"
                value={draft.interruptWords}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    interruptWords: Number(event.target.value),
                  })
                }
              />
            </Field>
          </div>
          <div className="mt-5 rounded-xl border border-emerald-400/12 bg-emerald-400/[0.025] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs">Estimated turn latency</span>
              <span className="font-mono text-sm text-emerald-300">
                0.42–0.78s
              </span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/6">
              <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-emerald-400 to-amber-300" />
            </div>
          </div>
        </SettingSection>
      </div>
    );
  if (tab === 'tools')
    return (
      <div className="space-y-6">
        <SettingSection
          title="Revenue actions"
          note="The model requests an action; Vaani validates and executes it"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [
                'send_whatsapp',
                'Send WhatsApp',
                'Approved product details and templates',
              ],
              [
                'send_email',
                'Send email',
                'Fallback when the calling number is not on WhatsApp',
              ],
              [
                'create_payment_link',
                'Create payment link',
                'Razorpay amount, expiry and customer mapping',
              ],
              [
                'schedule_follow_up',
                'Schedule follow-up',
                'Remember “send it at 8 PM” safely',
              ],
              [
                'book_appointment',
                'Book appointment',
                'Check availability and reserve a slot',
              ],
              [
                'transfer_human',
                'Transfer to human',
                'Warm transfer with conversation summary',
              ],
              [
                'create_ticket',
                'Create support ticket',
                'Priority, category and full conversation context',
              ],
            ].map(([id, title, note]) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    tools: draft.tools.includes(id)
                      ? draft.tools.filter((item) => item !== id)
                      : [...draft.tools, id],
                  })
                }
                className={`rounded-xl border p-4 text-left ${draft.tools.includes(id) ? 'border-amber-300/18 bg-amber-300/[0.035]' : 'border-white/7 bg-white/[0.015]'}`}
              >
                <div className="flex items-center justify-between">
                  <SquareFunction className="size-4 text-amber-200" />
                  <span
                    className={`size-2 rounded-full ${draft.tools.includes(id) ? 'bg-emerald-300' : 'bg-white/15'}`}
                  />
                </div>
                <p className="mt-4 text-xs font-medium">{title}</p>
                <p className="mt-2 text-[9px] leading-4 text-white/34">
                  {note}
                </p>
              </button>
            ))}
          </div>
        </SettingSection>
      </div>
    );
  if (tab === 'extractions')
    return (
      <div className="space-y-6">
        <SettingSection
          title="Structured call outcomes"
          note="Fields written into CRM after each conversation"
        >
          <div className="space-y-2">
            {draft.extractions.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-xl border border-white/7 bg-white/[0.015] p-3"
              >
                <Code2 className="size-4 text-cyan-200" />
                <span className="flex-1 font-mono text-[10px]">{item}</span>
                <Badge
                  variant="outline"
                  className="border-white/8 text-[8px] text-white/35"
                >
                  string / number
                </Badge>
              </div>
            ))}
          </div>
        </SettingSection>
      </div>
    );
  return (
    <div className="space-y-6">
      <SettingSection
        title="Calling safeguards"
        note="Phone mode remains locked until the workspace is verified"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Inbound agent', 'Assign an approved number'],
            ['Outbound calling', 'KYC + consent + calling window'],
            ['Voicemail detection', 'Avoid long automated recordings'],
            ['Auto reschedule', 'Use explicit customer-requested timing'],
          ].map(([title, note]) => (
            <div
              key={title}
              className="rounded-xl border border-white/7 bg-white/[0.015] p-4"
            >
              <p className="text-xs font-medium">{title}</p>
              <p className="mt-2 text-[9px] leading-4 text-white/34">{note}</p>
              <span className="mt-4 inline-flex rounded-full border border-amber-300/12 bg-amber-300/5 px-2 py-1 text-[8px] text-amber-200">
                Publish gate
              </span>
            </div>
          ))}
        </div>
      </SettingSection>
    </div>
  );
}

function TestConsole({
  agent,
  businessName,
  initialCredits,
  onChanged,
}: {
  agent: VoiceAgentRow;
  businessName: string;
  initialCredits: number;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'text' | 'browser_voice' | 'phone'>('text');
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<
    'idle' | 'listening' | 'thinking' | 'speaking'
  >('idle');
  const [voiceActive, setVoiceActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [credits, setCredits] = useState(initialCredits);
  const [error, setError] = useState('');
  const [pipelineMode, setPipelineMode] = useState<
    'checking' | 'realtime' | 'connected' | 'instant' | 'fallback'
  >('checking');
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<{ abort: () => void } | null>(null);
  const voiceActiveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeTranscriptRef = useRef('');
  const commitTimerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // 'auto' tries connected Sarvam STT; flips to 'browser' if no engine is set.
  const sttEngineRef = useRef<'auto' | 'connected' | 'browser'>('auto');

  useEffect(() => {
    const timer = window.setTimeout(() => setCredits(initialCredits), 0);
    return () => window.clearTimeout(timer);
  }, [initialCredits]);

  useEffect(() => {
    if (!voiceActive) return;
    const timer = window.setInterval(
      () => setElapsed((current) => current + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [voiceActive]);

  useEffect(
    () => () => {
      voiceActiveRef.current = false;
      if (commitTimerRef.current !== null)
        window.clearTimeout(commitTimerRef.current);
      recognitionRef.current?.abort();
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive')
          recorderRef.current.stop();
      } catch {
        /* recorder already stopped */
      }
      void audioCtxRef.current?.close().catch(() => undefined);
      audioRef.current?.pause();
      dataChannelRef.current?.close();
      peerRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      realtimeAudioRef.current?.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  function changeMode(nextMode: typeof mode) {
    stopVoice();
    setMode(nextMode);
    setSessionId('');
    setMessages([]);
    setError('');
  }

  async function startSession(testMode: 'text' | 'browser_voice') {
    const response = await fetch('/api/app/agents/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        agentId: agent.id,
        mode: testMode,
      }),
    });
    const payload = (await response.json()) as {
      sessionId?: string;
      message?: string;
      error?: string;
    };
    if (!response.ok || !payload.sessionId || !payload.message)
      throw new Error(payload.error ?? 'Unable to start test.');
    setSessionId(payload.sessionId);
    setMessages([
      { id: crypto.randomUUID(), role: 'assistant', content: payload.message },
    ]);
    return payload.sessionId;
  }

  async function sendMessage(value = input, continueVoice = false) {
    const message = value.trim();
    if (!message || mode === 'phone') return;
    if (
      mode === 'browser_voice' &&
      pipelineMode === 'realtime' &&
      dataChannelRef.current?.readyState === 'open'
    ) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'user', content: message },
      ]);
      setInput('');
      setVoiceState('thinking');
      dataChannelRef.current.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: message }],
          },
        }),
      );
      dataChannelRef.current.send(JSON.stringify({ type: 'response.create' }));
      return;
    }
    setLoading(true);
    if (mode === 'browser_voice') setVoiceState('thinking');
    setError('');
    try {
      const activeSession = sessionId || (await startSession(mode));
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'user', content: message },
      ]);
      setInput('');
      const response = await fetch('/api/app/agents/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          sessionId: activeSession,
          message,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        actions?: TranscriptMessage['actions'];
        latencyMs?: number;
        creditsRemaining?: number;
        pipelineMode?: 'connected' | 'instant' | 'fallback';
        voiceConnected?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.message)
        throw new Error(payload.error ?? 'Unable to test agent.');
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: payload.message!,
          actions: payload.actions,
          latencyMs: payload.latencyMs,
        },
      ]);
      setCredits(Number(payload.creditsRemaining ?? credits - 10));
      setPipelineMode(payload.pipelineMode ?? 'fallback');
      if (mode === 'browser_voice')
        await speakAgentMessage(
          payload.message,
          continueVoice,
          // Use the real server voice (ElevenLabs/Sarvam) whenever one is
          // connected; only fall back to instant local browser speech when no
          // voice provider is configured.
          !payload.voiceConnected,
        );
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to test agent.',
      );
      if (voiceActiveRef.current) setVoiceState('idle');
    } finally {
      setLoading(false);
    }
  }

  async function beginVoiceConversation() {
    voiceActiveRef.current = true;
    setVoiceActive(true);
    setError('');
    setPipelineMode('checking');
    try {
      try {
        await beginRealtimeConversation();
        return;
      } catch {
        cleanupRealtime();
        setPipelineMode('fallback');
      }
      if (!sessionId) {
        const activeSession = await startSession('browser_voice');
        // Greet with the real server voice when one is connected; speakAgentMessage
        // falls back to instant browser speech if no voice provider is configured.
        if (activeSession)
          await speakAgentMessage(agent.welcome_message, true, false);
      } else {
        startListening(false);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to start voice playground.',
      );
      stopVoice();
    }
  }

  async function speakAgentMessage(
    text: string,
    continueVoice: boolean,
    preferInstant = false,
  ) {
    setVoiceState('speaking');
    audioRef.current?.pause();
    if (preferInstant) {
      setPipelineMode('instant');
      await browserSpeak(text, agent.primary_language);
      if ((continueVoice || voiceActiveRef.current) && voiceActiveRef.current)
        startListening(true);
      else setVoiceState('idle');
      return;
    }
    try {
      const response = await fetch('/api/app/agents/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, text }),
      });
      if (!response.ok) throw new Error('Connected voice is not available.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPipelineMode('connected');
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Audio playback failed.'));
        };
        void audio.play().catch(reject);
      });
    } catch {
      setPipelineMode('fallback');
      await browserSpeak(text, agent.primary_language);
    }
    if ((continueVoice || voiceActiveRef.current) && voiceActiveRef.current)
      startListening(true);
    else setVoiceState('idle');
  }

  async function beginRealtimeConversation() {
    if (
      typeof RTCPeerConnection === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error('WebRTC audio is unavailable.');
    }
    cleanupRealtime();
    const peer = new RTCPeerConnection();
    peerRef.current = peer;
    const remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    realtimeAudioRef.current = remoteAudio;
    peer.ontrack = (event) => {
      remoteAudio.srcObject =
        event.streams[0] ?? new MediaStream([event.track]);
      void remoteAudio.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setPipelineMode('realtime');
        setVoiceState('listening');
      } else if (['failed', 'disconnected'].includes(peer.connectionState)) {
        setError(
          'Realtime audio connection dropped. Tap the orb to reconnect.',
        );
        stopVoice();
      }
    };
    const channel = peer.createDataChannel('oai-events');
    dataChannelRef.current = channel;
    channel.onopen = () => {
      setPipelineMode('realtime');
      setVoiceState('speaking');
      setMessages([
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: agent.welcome_message,
        },
      ]);
      channel.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            instructions: `Begin the conversation now. Greet the customer naturally using this approved opening: ${agent.welcome_message}`,
          },
        }),
      );
    };
    channel.onmessage = (event) => handleRealtimeEvent(event.data);
    channel.onerror = () =>
      setError('Realtime event channel reported an error.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    mediaStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch('/api/app/agents/realtime', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, sdp: offer.sdp }),
    });
    if (!response.ok) {
      const payload = (await response
        .json()
        .catch(() => ({ error: 'Realtime provider is unavailable.' }))) as {
        error?: string;
      };
      throw new Error(payload.error ?? 'Realtime provider is unavailable.');
    }
    const answerSdp = await response.text();
    await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    setSessionId(response.headers.get('x-vaani-session-id') ?? '');
    setCredits(
      Number(response.headers.get('x-vaani-credits-remaining') ?? credits - 10),
    );
    setPipelineMode('realtime');
    void onChanged();
  }

  function handleRealtimeEvent(rawEvent: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawEvent) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'input_audio_buffer.speech_started') {
      setVoiceState('listening');
      setInterimTranscript('Listening…');
      return;
    }
    if (
      type === 'input_audio_buffer.speech_stopped' ||
      type === 'response.created'
    ) {
      setVoiceState('thinking');
      setInterimTranscript('');
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript =
        typeof event.transcript === 'string' ? event.transcript.trim() : '';
      if (transcript)
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: 'user', content: transcript },
        ]);
      return;
    }
    if (type === 'response.output_audio_transcript.delta') {
      const delta = typeof event.delta === 'string' ? event.delta : '';
      realtimeTranscriptRef.current += delta;
      setInterimTranscript(realtimeTranscriptRef.current);
      setVoiceState('speaking');
      return;
    }
    if (type === 'response.output_audio_transcript.done') {
      const transcript = (
        typeof event.transcript === 'string'
          ? event.transcript
          : realtimeTranscriptRef.current
      ).trim();
      if (transcript && transcript !== agent.welcome_message) {
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: 'assistant', content: transcript },
        ]);
      }
      realtimeTranscriptRef.current = '';
      setInterimTranscript('');
      return;
    }
    if (type === 'response.output_audio.delta') {
      setVoiceState('speaking');
      return;
    }
    if (type === 'response.done') {
      setVoiceState('listening');
      setInterimTranscript('');
      return;
    }
    if (type === 'error') {
      const error =
        event.error && typeof event.error === 'object'
          ? (event.error as { message?: unknown })
          : null;
      setError(
        typeof error?.message === 'string'
          ? error.message
          : 'Realtime conversation reported an error.',
      );
    }
  }

  function cleanupRealtime() {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    realtimeAudioRef.current?.pause();
    if (realtimeAudioRef.current) realtimeAudioRef.current.srcObject = null;
    realtimeAudioRef.current = null;
    realtimeTranscriptRef.current = '';
  }

  // Dispatcher: prefer connected Sarvam STT (accurate for Indian languages);
  // fall back to the browser's Web Speech API when no engine is connected.
  function startListening(automatic = false) {
    if (sttEngineRef.current === 'browser') {
      startBrowserListening(automatic);
      return;
    }
    void startConnectedListening();
  }

  function stopRecorder() {
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive')
        recorderRef.current.stop();
    } catch {
      /* recorder already stopped */
    }
    recorderRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
  }

  // Record one utterance, auto-stop on ~0.9s of silence, then transcribe with
  // Sarvam. On success we send the accurate transcript; if no transcription
  // engine is connected we permanently fall back to browser recognition.
  async function startConnectedListening() {
    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      sttEngineRef.current = 'browser';
      startBrowserListening(true);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      sttEngineRef.current = 'browser';
      startBrowserListening(true);
      return;
    }
    mediaStreamRef.current = stream;
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1400) {
        // Too little audio — quietly listen again.
        if (voiceActiveRef.current) void startConnectedListening();
        return;
      }
      setVoiceState('thinking');
      const form = new FormData();
      form.append('audio', blob, 'turn.webm');
      form.append('agentId', agent.id);
      try {
        const response = await fetch('/api/app/agents/stt', {
          method: 'POST',
          body: form,
        });
        if (response.status === 409) {
          // No transcription engine configured — use the browser from now on.
          sttEngineRef.current = 'browser';
          if (voiceActiveRef.current) startBrowserListening(true);
          return;
        }
        const data = (await response.json()) as {
          transcript?: string;
          error?: string;
        };
        if (!response.ok || !data.transcript)
          throw new Error(data.error ?? 'Could not understand the audio.');
        sttEngineRef.current = 'connected';
        setInterimTranscript('');
        await sendMessage(data.transcript, true);
      } catch {
        setError('Could not understand that clearly. Please try again.');
        if (voiceActiveRef.current) setVoiceState('idle');
      }
    };

    // Silence detection via Web Audio RMS.
    const context = new AudioContext();
    audioCtxRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let spoke = false;
    let silenceSince = 0;
    const startedAt = nowMs();
    recorder.start();
    voiceActiveRef.current = true;
    setVoiceActive(true);
    setVoiceState('listening');
    setInterimTranscript('Listening…');

    const monitor = () => {
      if (!voiceActiveRef.current || recorder.state === 'inactive') return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = nowMs();
      if (rms > 0.045) {
        spoke = true;
        silenceSince = 0;
      } else if (spoke) {
        if (!silenceSince) silenceSince = now;
        else if (now - silenceSince > 900) {
          recorder.stop();
          return;
        }
      }
      // Hard stop after 15s so a stuck stream never records forever.
      if (now - startedAt > 15_000) {
        recorder.stop();
        return;
      }
      window.setTimeout(monitor, 120);
    };
    monitor();
  }

  function startBrowserListening(automatic = false) {
    type RecognitionEvent = {
      results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>;
    };
    type RecognitionInstance = {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: (event: RecognitionEvent) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      abort: () => void;
    };
    const constructor = (
      window as unknown as {
        webkitSpeechRecognition?: new () => RecognitionInstance;
      }
    ).webkitSpeechRecognition;
    if (!constructor) {
      setError(
        'Browser speech recognition is unavailable here. Text test still works.',
      );
      return;
    }
    if (!automatic && 'speechSynthesis' in window)
      window.speechSynthesis.cancel();
    recognitionRef.current?.abort();
    const recognition = new constructor();
    recognitionRef.current = recognition;
    recognition.lang = agent.primary_language === 'en-IN' ? 'en-IN' : 'hi-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    let handled = false;
    const clearCommitTimer = () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
    const commit = (text: string) => {
      const value = text.trim();
      if (handled || !value) return;
      handled = true;
      clearCommitTimer();
      setInterimTranscript('');
      try {
        recognition.abort();
      } catch {
        /* recognition already stopped */
      }
      void sendMessage(value, true);
    };
    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) final += transcript;
        else interim += transcript;
      }
      setInterimTranscript(interim);
      setInput(final || interim);
      if (final.trim()) {
        commit(final);
        return;
      }
      // Fast turn-taking: if the caller pauses for ~0.8s, commit the interim
      // transcript immediately instead of waiting for the browser's slower
      // end-of-speech detection. This is what makes replies feel instant.
      clearCommitTimer();
      if (interim.trim())
        commitTimerRef.current = window.setTimeout(() => commit(interim), 800);
    };
    recognition.onerror = () => {
      clearCommitTimer();
      // We aborted recognition ourselves right after committing a transcript —
      // that is expected, not a failure, so don't surface an error.
      if (handled) return;
      setError(
        'Microphone transcription did not complete. You can type instead.',
      );
      if (voiceActiveRef.current) setVoiceState('idle');
    };
    recognition.onend = () => {
      clearCommitTimer();
      recognitionRef.current = null;
      if (!handled && voiceActiveRef.current) setVoiceState('idle');
    };
    voiceActiveRef.current = true;
    setVoiceActive(true);
    setVoiceState('listening');
    try {
      recognition.start();
    } catch {
      setError('Microphone is already starting. Please try again.');
    }
  }

  function stopVoice() {
    voiceActiveRef.current = false;
    setVoiceActive(false);
    setElapsed(0);
    setVoiceState('idle');
    setInterimTranscript('');
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopRecorder();
    audioRef.current?.pause();
    audioRef.current = null;
    cleanupRealtime();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window)
      window.speechSynthesis.cancel();
  }

  const suggested = useMemo(
    () => [
      'हाँ, शुरू करें',
      'Product details WhatsApp कर दो',
      '₹550 का payment link WhatsApp पर 8 बजे भेजना',
    ],
    [],
  );

  return (
    <aside className="flex min-h-[720px] flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#0e1119]">
      <div className="border-b border-white/8 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Test playground</p>
            <p className="mt-1 text-[9px] text-white/30">
              No phone call required
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/12 bg-emerald-400/6 px-2 py-1 text-[8px] text-emerald-300">
            {credits} credits
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 rounded-xl border border-white/7 bg-black/20 p-1">
          {[
            ['text', MessageCircleMore, 'Text'],
            ['browser_voice', Mic2, 'Browser'],
            ['phone', PhoneCall, 'Phone'],
          ].map(([id, Icon, label]) => {
            const ModeIcon = Icon as typeof Mic2;
            return (
              <button
                key={id as string}
                type="button"
                onClick={() => changeMode(id as typeof mode)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[9px] ${mode === id ? 'bg-white/9 text-white' : 'text-white/32'}`}
              >
                <ModeIcon className="size-3" />
                {label as string}
              </button>
            );
          })}
        </div>
      </div>

      {mode === 'phone' ? (
        <div className="grid flex-1 place-items-center p-6">
          <div className="max-w-xs text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-amber-300/12 bg-amber-300/5">
              <PhoneCall className="size-5 text-amber-200" />
            </span>
            <h3 className="mt-5 text-base font-semibold">
              Phone test is publish-gated
            </h3>
            <p className="mt-3 text-xs leading-5 text-white/38">
              Verify your number, complete KYC and approve the calling use case.
              Until then, use browser voice for the same conversational response
              without placing a call.
            </p>
            <Button
              type="button"
              onClick={() => changeMode('browser_voice')}
              className="mt-5 bg-amber-300 text-black hover:bg-amber-200"
            >
              <Mic2 /> Use browser voice
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {mode === 'browser_voice' ? (
              <VoiceOrb
                agentName={agent.name}
                state={voiceState}
                active={voiceActive}
                elapsed={elapsed}
                pipelineMode={pipelineMode}
                interimTranscript={interimTranscript}
                onStart={() => void beginVoiceConversation()}
                onStop={stopVoice}
              />
            ) : null}
            {messages.length === 0 && mode === 'text' ? (
              <div className="grid min-h-[420px] place-items-center">
                <div className="max-w-xs text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300/15 to-violet-300/15">
                    <AudioLines className="size-6 text-cyan-100" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold">
                    Meet {agent.name}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-white/38">
                    Start a text test for {businessName}. Each turn uses 10
                    trial credits and never calls a phone number.
                  </p>
                  <Button
                    type="button"
                    onClick={() => void startSession(mode)}
                    className="mt-5 bg-white text-black hover:bg-white/90"
                  >
                    <WandSparkles /> Start test
                  </Button>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] ${message.role === 'user' ? 'rounded-2xl rounded-tr-md bg-amber-300 p-3 text-[#21190a]' : 'space-y-2'}`}
                  >
                    {message.role === 'assistant' ? (
                      <div className="rounded-2xl rounded-tl-md bg-white/[0.055] p-3 text-xs leading-5 text-white/72">
                        <div className="mb-2 flex items-center gap-2 text-[9px] text-violet-200">
                          <Sparkles className="size-3" /> {agent.name}
                          {message.latencyMs ? (
                            <span className="ml-auto font-mono text-white/25">
                              {message.latencyMs}ms
                            </span>
                          ) : null}
                        </div>
                        {message.content}
                      </div>
                    ) : (
                      <p className="text-xs leading-5">{message.content}</p>
                    )}
                    {message.actions?.length ? (
                      <div className="space-y-1.5">
                        {message.actions.map((action) => (
                          <div
                            key={`${message.id}-${action.type}`}
                            className="flex items-center gap-2 rounded-xl border border-emerald-400/12 bg-emerald-400/[0.035] p-2.5 text-[9px] text-emerald-100"
                          >
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-300" />
                            <span className="flex-1">{action.label}</span>
                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] text-white/35">
                              preview
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {loading ? (
              <div className="flex items-center gap-2 text-[10px] text-white/30">
                <Loader2 className="size-3.5 animate-spin" /> Vaani is
                understanding the request…
              </div>
            ) : null}
          </div>
          <div className="border-t border-white/8 p-4">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {suggested.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => void sendMessage(item)}
                  disabled={loading}
                  className="shrink-0 rounded-full border border-white/8 bg-white/[0.025] px-3 py-1.5 text-[8px] text-white/42 hover:bg-white/5"
                >
                  {item}
                </button>
              ))}
            </div>
            {error ? (
              <p className="mb-3 rounded-lg bg-red-400/7 p-2 text-[9px] text-red-100">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey)
                    void sendMessage();
                }}
                placeholder={`Reply to ${agent.name}…`}
                className="h-10 border-white/8 bg-white/[0.025] text-xs"
              />
              {mode === 'browser_voice' ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() =>
                    voiceActive ? stopVoice() : startListening(false)
                  }
                  disabled={loading && !voiceActive}
                  className={`border-white/10 bg-transparent ${voiceActive ? 'text-red-300' : ''}`}
                  aria-label={
                    voiceActive ? 'End voice conversation' : 'Speak to agent'
                  }
                >
                  {voiceActive ? <PhoneOff /> : <Mic2 />}
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon"
                onClick={() => void sendMessage()}
                disabled={loading || !input.trim()}
                className="bg-amber-300 text-black hover:bg-amber-200"
                aria-label="Send test message"
              >
                <Send />
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[8px] text-white/24">
              <span>10 credits / turn</span>
              <span className="flex items-center gap-1">
                <Clock3 className="size-2.5" /> Sandbox actions only
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function VoiceOrb({
  agentName,
  state,
  active,
  elapsed,
  pipelineMode,
  interimTranscript,
  onStart,
  onStop,
}: {
  agentName: string;
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  active: boolean;
  elapsed: number;
  pipelineMode: 'checking' | 'realtime' | 'connected' | 'instant' | 'fallback';
  interimTranscript: string;
  onStart: () => void;
  onStop: () => void;
}) {
  const stateLabel =
    state === 'listening'
      ? 'Listening to you…'
      : state === 'thinking'
        ? 'Understanding…'
        : state === 'speaking'
          ? `${agentName} is speaking…`
          : 'Tap the orb to talk';
  const bars = [18, 34, 25, 46, 30, 54, 38, 48, 26, 40, 22];
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_50%_10%,rgba(129,140,248,0.13),transparent_38%),linear-gradient(180deg,#101522_0%,#090c12_100%)] px-5 py-8 text-center">
      <div
        aria-hidden="true"
        className="absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-full bg-cyan-300/[0.045] blur-3xl"
      />
      <div className="relative mx-auto size-64 sm:size-72">
        <div
          aria-hidden="true"
          className={`absolute -inset-4 rounded-full bg-[radial-gradient(circle,rgba(139,140,248,0.4),transparent_70%)] blur-2xl transition-opacity duration-700 ${active ? 'opacity-80' : 'opacity-40'}`}
        />
        <button
          type="button"
          onClick={active ? onStop : onStart}
          aria-label={
            active
              ? 'End browser voice conversation'
              : `Start talking to ${agentName}`
          }
          className={`vaani-orb group relative grid size-full place-items-center transition-transform duration-500 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0b0f17] ${
            state === 'speaking'
              ? 'vaani-orb--speaking'
              : state === 'listening'
                ? 'vaani-orb--listening'
                : ''
          }`}
        >
          <span aria-hidden="true" className="vaani-orb__blob vaani-orb__blob--a" />
          <span aria-hidden="true" className="vaani-orb__blob vaani-orb__blob--b" />
          <span aria-hidden="true" className="vaani-orb__blob vaani-orb__blob--c" />
          <span aria-hidden="true" className="vaani-orb__blob vaani-orb__blob--d" />
          <span aria-hidden="true" className="vaani-orb__sheen" />
          {active ? (
            <span
              className="relative z-10 flex h-16 items-center gap-1"
              aria-hidden="true"
            >
              {bars.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className={`w-1 rounded-full bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.5)] ${state === 'listening' || state === 'speaking' ? 'animate-pulse' : ''}`}
                  style={{ height, animationDelay: `${index * 55}ms` }}
                />
              ))}
            </span>
          ) : (
            <span className="relative z-10 grid size-16 place-items-center rounded-full bg-white/15 text-white shadow-lg ring-1 ring-white/30 backdrop-blur-md transition group-hover:bg-white/20">
              <Mic2 className="size-7" />
            </span>
          )}
        </button>
      </div>
      <div className="relative mt-3">
        <div className="flex items-center justify-center gap-2">
          <h3 className="text-base font-semibold">
            {agentName} · Voice playground
          </h3>
          <span
            className={`rounded-full border px-2 py-1 text-[8px] ${pipelineMode === 'realtime' || pipelineMode === 'connected' || pipelineMode === 'instant' ? 'border-emerald-300/15 bg-emerald-300/7 text-emerald-200' : 'border-amber-300/15 bg-amber-300/7 text-amber-100'}`}
          >
            {pipelineMode === 'realtime'
              ? 'Realtime WebRTC'
              : pipelineMode === 'connected'
                ? 'Connected voice'
                : pipelineMode === 'instant'
                  ? 'Instant reply'
                  : pipelineMode === 'checking'
                    ? 'Connecting realtime'
                    : 'Browser fallback'}
          </span>
        </div>
        <p aria-live="polite" className="mt-2 text-xs text-white/48">
          {interimTranscript || stateLabel}
        </p>
        {active ? (
          <p className="mt-2 font-mono text-[10px] text-cyan-100/55">
            {formatElapsed(elapsed)} ·{' '}
            {pipelineMode === 'realtime'
              ? 'full-duplex audio'
              : pipelineMode === 'connected'
                ? 'server voice'
                : pipelineMode === 'instant'
                  ? 'local fast-path'
                  : 'browser voice'}{' '}
            · interruption ready
          </p>
        ) : (
          <p className="mt-2 text-[9px] text-white/28">
            Realtime mode streams microphone audio directly and supports natural
            interruption. No phone number is dialled.
          </p>
        )}
      </div>
    </section>
  );
}

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function previewInBrowser(text: string, language: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'en-IN' ? 'en-IN' : 'hi-IN';
  const matching = window.speechSynthesis
    .getVoices()
    .find((voice) =>
      voice.lang
        .toLowerCase()
        .startsWith(utterance.lang.toLowerCase().slice(0, 2)),
    );
  if (matching) utterance.voice = matching;
  window.speechSynthesis.speak(utterance);
}

// Module-level so the wall-clock read stays outside component render purity.
function nowMs() {
  return Date.now();
}

function browserSpeak(text: string, language: string) {
  return new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === 'en-IN' ? 'en-IN' : 'hi-IN';
    utterance.rate = 1.02;
    const matching = window.speechSynthesis
      .getVoices()
      .find((voice) =>
        voice.lang
          .toLowerCase()
          .startsWith(utterance.lang.toLowerCase().slice(0, 2)),
      );
    if (matching) utterance.voice = matching;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

function SettingSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-[10px] text-white/30">{note}</p>
      </div>
      {children}
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs text-white/48">
      {label}
      <div className="mt-2 [&_.input-select]:h-10 [&_.input-select]:w-full [&_.input-select]:rounded-lg [&_.input-select]:border [&_.input-select]:border-white/8 [&_.input-select]:bg-[#121620] [&_.input-select]:px-3 [&_.input-select]:text-xs [&_.input-static]:flex [&_.input-static]:h-10 [&_.input-static]:items-center [&_.input-static]:gap-2 [&_.input-static]:rounded-lg [&_.input-static]:border [&_.input-static]:border-white/8 [&_.input-static]:bg-white/[0.025] [&_.input-static]:px-3 [&_.input-static]:text-[10px] [&_.input-static]:text-white/45 [&_input]:border-white/8 [&_input]:bg-white/[0.025] [&_textarea]:border-white/8 [&_textarea]:bg-white/[0.025]">
        {children}
      </div>
    </label>
  );
}
function safeList(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
function safeObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function toDraft(agent: VoiceAgentRow): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    useCase: agent.use_case,
    welcomeMessage: agent.welcome_message,
    systemPrompt: agent.system_prompt,
    primaryLanguage: agent.primary_language,
    voiceName: agent.voice_name,
    intelligenceProfile: agent.intelligence_profile,
    temperature: Number(agent.temperature),
    maxTokens: Number(agent.max_tokens),
    endpointingMs: Number(agent.endpointing_ms),
    interruptWords: Number(agent.interrupt_words),
    tools: safeList(agent.tools_json),
    extractions: safeList(agent.extractions_json),
    callingConfig: safeObject(agent.calling_config_json),
  };
}

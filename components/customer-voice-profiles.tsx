'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock, LockOpen, Mic2, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Profile = {
  id: string;
  name: string;
  presentation: string;
  provider: string;
  hasVoiceId: boolean;
  /** Set when the provider scheduled this voice for removal. */
  removalNoticeAt: string | null;
  removalReason: string | null;
  modelId: string | null;
  defaultLanguage: string;
  allowedLanguages: string[];
  autoLanguageSwitch: boolean;
  accentProfile: string;
  speakingRate: string;
  style: string;
  providerPolicy: string;
  voiceLock: boolean;
  fallbackProfileId: string | null;
  status: string;
};

type AgentRow = { id: string; name: string; voice_profile_id: string | null };

const LANGUAGES = [
  ['hi-IN', 'Hindi'],
  ['en-IN', 'English'],
  ['hinglish', 'Hinglish'],
  ['pa-IN', 'Punjabi'],
  ['haryanvi', 'Haryanvi'],
  ['mr-IN', 'Marathi'],
  ['gu-IN', 'Gujarati'],
  ['bn-IN', 'Bengali'],
  ['ta-IN', 'Tamil'],
  ['te-IN', 'Telugu'],
] as const;

export function CustomerVoiceProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [presentation, setPresentation] = useState('female');
  const [provider, setProvider] = useState('elevenlabs');
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('eleven_flash_v2_5');
  const [rate, setRate] = useState('normal');
  const [style, setStyle] = useState('warm');
  const [voiceLock, setVoiceLock] = useState(false);
  const [languages, setLanguages] = useState<string[]>([
    'hi-IN',
    'en-IN',
    'hinglish',
  ]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  }

  async function load() {
    try {
      const response = await fetch('/api/app/voice-profiles', {
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        profiles?: Profile[];
        agents?: AgentRow[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load.');
      setProfiles(payload.profiles ?? []);
      setAgents(payload.agents ?? []);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function call(
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>,
    key: string,
  ) {
    setBusy(key);
    setError('');
    try {
      const response = await fetch('/api/app/voice-profiles', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
      return false;
    } finally {
      setBusy('');
    }
  }

  async function create() {
    if (!name.trim()) {
      setError('Give the voice a name.');
      return;
    }
    const ok = await call(
      'POST',
      {
        name,
        presentation,
        provider,
        providerVoiceId: voiceId,
        modelId,
        allowedLanguages: languages,
        speakingRate: rate,
        style,
        voiceLock,
      },
      'create',
    );
    if (ok) {
      flash('Voice profile created ✓');
      setShowForm(false);
      setName('');
      setVoiceId('');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Voice profile engine
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Male and female personas, language policy and voice lock
        </h2>
        <p className="mt-2 max-w-2xl text-xs text-ink-muted">
          A profile decides which voice speaks, which languages it is allowed to
          speak, and whether the voice may change mid-call. Locking a voice
          keeps the same identity even when the caller switches language.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-danger-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-[11px] font-medium text-success-text">{notice}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          {loading ? 'Loading…' : `${profiles.length} voice profile(s)`}
        </p>
        <Button
          onClick={() => setShowForm((value) => !value)}
          className="h-9 bg-primary text-[11px] text-primary-foreground hover:bg-[#1d4ed8]"
        >
          <Plus /> New voice profile
        </Button>
      </div>

      {showForm ? (
        <div className="portal-panel p-4">
          <p className="text-sm font-medium">New voice profile</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Arjun — Global (male)"
                className="h-9 border-hairline bg-surface-muted text-xs"
              />
            </Field>
            <Field label="Presentation">
              <select
                value={presentation}
                onChange={(event) => setPresentation(event.target.value)}
                className="h-9 w-full rounded-md border border-hairline bg-surface-muted px-2 text-xs"
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
            <Field label="Provider">
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="h-9 w-full rounded-md border border-hairline bg-surface-muted px-2 text-xs"
              >
                <option value="elevenlabs">ElevenLabs</option>
                <option value="sarvam">Sarvam (Indian languages)</option>
              </select>
            </Field>
            <Field
              label={
                provider === 'sarvam' ? 'Sarvam speaker' : 'ElevenLabs voice ID'
              }
            >
              <Input
                value={voiceId}
                onChange={(event) => setVoiceId(event.target.value)}
                placeholder={
                  provider === 'sarvam'
                    ? 'e.g. shubh'
                    : 'e.g. MF4J4IDTRo0AxOO4dpFR'
                }
                className="h-9 border-hairline bg-surface-muted font-mono text-[11px]"
              />
            </Field>
            <Field label="Model (optional)">
              <Input
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder="eleven_flash_v2_5"
                className="h-9 border-hairline bg-surface-muted text-xs"
              />
            </Field>
            <Field label="Speaking rate">
              <select
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                className="h-9 w-full rounded-md border border-hairline bg-surface-muted px-2 text-xs"
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </Field>
            <Field label="Style">
              <select
                value={style}
                onChange={(event) => setStyle(event.target.value)}
                className="h-9 w-full rounded-md border border-hairline bg-surface-muted px-2 text-xs"
              >
                <option value="warm">Warm</option>
                <option value="professional">Professional</option>
                <option value="sales">Sales</option>
                <option value="support">Support</option>
              </select>
            </Field>
            <Field label="Voice lock">
              <label className="flex h-9 items-center gap-2 text-xs text-ink-body">
                <input
                  type="checkbox"
                  checked={voiceLock}
                  onChange={(event) => setVoiceLock(event.target.checked)}
                />
                Never change this voice mid-call
              </label>
            </Field>
          </div>

          <p className="mt-4 text-[9px] uppercase tracking-wider text-ink-muted">
            Allowed languages
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LANGUAGES.map(([code, label]) => {
              const on = languages.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    setLanguages((current) =>
                      current.includes(code)
                        ? current.filter((item) => item !== code)
                        : [...current, code],
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-[10px] transition ${on ? 'border-hairline bg-surface-strong text-ink' : 'border-hairline text-ink-muted hover:bg-surface-strong'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              disabled={busy === 'create'}
              onClick={create}
              className="h-9 bg-primary text-[11px] text-primary-foreground hover:bg-[#1d4ed8]"
            >
              {busy === 'create' ? <Loader2 className="animate-spin" /> : null}{' '}
              Create profile
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowForm(false)}
              className="h-9 border-hairline bg-transparent text-[11px]"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {profiles.map((profile) => (
          <div key={profile.id} className="portal-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Mic2 className="size-3.5 text-primary" />
                  <p className="truncate text-sm font-medium">{profile.name}</p>
                </div>
                <p className="mt-1 text-[10px] text-ink-muted">
                  {profile.presentation} · {profile.provider}
                  {profile.modelId ? ` · ${profile.modelId}` : ''}
                  {profile.hasVoiceId ? '' : ' · no voice id yet'}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`text-[9px] ${profile.voiceLock ? 'border-amber-300/20 bg-amber-300/8 text-warning-text' : 'border-hairline text-ink-body'}`}
              >
                {profile.voiceLock ? 'locked' : 'unlocked'}
              </Badge>
            </div>

            {profile.removalNoticeAt ? (
              <p className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-2.5 py-2 text-[10px] leading-relaxed text-danger-text">
                <strong>Voice scheduled for removal.</strong> The provider is
                withdrawing this voice; agents using this profile will stop
                speaking once it is gone. Pick a replacement voice id.
                {profile.removalReason ? ` (${profile.removalReason})` : ''}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1">
              {profile.allowedLanguages.map((code) => (
                <span
                  key={code}
                  className="rounded-md border border-hairline bg-surface-strong px-1.5 py-0.5 text-[9px] text-ink-body"
                >
                  {code}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-ink-muted">
              <span>rate: {profile.speakingRate}</span>
              <span>·</span>
              <span>style: {profile.style}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy === profile.id}
                onClick={async () => {
                  const ok = await call(
                    'PATCH',
                    { profileId: profile.id, voiceLock: !profile.voiceLock },
                    profile.id,
                  );
                  if (ok)
                    flash(
                      profile.voiceLock ? 'Voice unlocked' : 'Voice locked ✓',
                    );
                }}
                className="h-8 border-hairline bg-transparent text-[10px]"
              >
                {profile.voiceLock ? <LockOpen /> : <Lock />}
                {profile.voiceLock ? 'Unlock' : 'Lock voice'}
              </Button>
              {agents.map((agent) => (
                <Button
                  key={agent.id}
                  variant="outline"
                  disabled={
                    busy === `${profile.id}:${agent.id}` ||
                    agent.voice_profile_id === profile.id
                  }
                  onClick={async () => {
                    const ok = await call(
                      'PATCH',
                      {
                        action: 'bind_agent',
                        agentId: agent.id,
                        profileId: profile.id,
                      },
                      `${profile.id}:${agent.id}`,
                    );
                    if (ok) flash(`${agent.name} now uses ${profile.name} ✓`);
                  }}
                  className="h-8 border-hairline bg-transparent text-[10px]"
                >
                  {agent.voice_profile_id === profile.id
                    ? `✓ ${agent.name}`
                    : `Use for ${agent.name}`}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!loading && !profiles.length ? (
        <p className="text-xs text-ink-muted">
          No voice profiles yet. Create one and paste an ElevenLabs voice ID (or
          a Sarvam speaker) to give this agent its own persona.
        </p>
      ) : null}
    </div>
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
    <div>
      <p className="mb-1 text-[9px] uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Volume2, Wifi } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/components/locale-provider';

/**
 * Agent workstation diagnostics (§3, §5, §6, §8, §21).
 *
 * The browser measures — devices, microphone level, round-trip time — and the
 * server scores and decides readiness, so the thresholds live in one place and
 * are testable.
 *
 * Honest about what is being measured: there is no WebRTC peer connection yet
 * (the media gateway serves the carrier, not this tab), so "network" here is
 * HTTP round-trip to Vaani, and the UI says exactly that.
 */

type DeviceOption = { deviceId: string; label: string };
type Verdict = {
  score: number;
  band: string;
  rttMs: number;
  jitterMs: number;
  lossPercent: number;
  warnings: Array<{ code: string; message: string }>;
  primaryIssue: string | null;
};
type TestResult = {
  supportCode: string;
  quality: Verdict;
  readiness: { state: 'ready' | 'warn' | 'blocked'; reasons: string[] };
};

const bandTone: Record<string, string> = {
  excellent: 'text-emerald-200',
  good: 'text-emerald-200',
  fair: 'text-amber-200',
  poor: 'text-rose-200',
};
const stateTone: Record<string, string> = {
  ready: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  blocked: 'border-rose-400/35 bg-rose-400/10 text-rose-100',
};

export function CustomerDiagnostics() {
  const t = useT();
  const [inputs, setInputs] = useState<DeviceOption[]>([]);
  const [outputs, setOutputs] = useState<DeviceOption[]>([]);
  const [inputId, setInputId] = useState('');
  const [outputId, setOutputId] = useState('');
  const [permission, setPermission] = useState<
    'granted' | 'denied' | 'prompt' | 'unsupported'
  >('prompt');
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [policy, setPolicy] = useState<{
    requireDeviceTest: boolean;
    validHours: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);

  /** Releases the microphone. Declared before the effects that use it. */
  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioRef.current?.close();
    audioRef.current = null;
    setListening(false);
    setLevel(0);
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const response = await fetch('/api/app/diagnostics');
      if (!response.ok) return;
      const body = (await response.json()) as {
        preferences?: Record<string, unknown> | null;
        runs?: Record<string, unknown>[];
        policy?: { requireDeviceTest: boolean; validHours: number };
      };
      setRuns(body.runs ?? []);
      setPolicy(body.policy ?? null);
    } catch {
      /* the panel still works without history */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSaved(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSaved]);

  // Stop the microphone the moment this panel goes away: never hold a live
  // input stream open outside an active test or call.
  useEffect(() => stopListening, [stopListening]);

  const refreshDevices = useCallback(async () => {
    if (!supported) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(
        devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            // Labels are empty until permission is granted.
            label: device.label || `Microphone ${index + 1}`,
          })),
      );
      setOutputs(
        devices
          .filter((device) => device.kind === 'audiooutput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Speaker ${index + 1}`,
          })),
      );
    } catch {
      setNotice('The browser would not list audio devices.');
    }
  }, [supported]);

  useEffect(() => {
    // Hot-swap: a headset unplugged mid-shift must not go unnoticed.
    const onChange = () => {
      void refreshDevices();
      setNotice('An audio device was added or removed.');
    };
    const timer = window.setTimeout(() => {
      if (!supported) {
        setPermission('unsupported');
        return;
      }
      void refreshDevices();
      navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [supported, refreshDevices]);


  async function startListening() {
    if (!supported) return;
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: inputId ? { deviceId: { exact: inputId } } : true,
      });
      streamRef.current = stream;
      setPermission('granted');
      await refreshDevices(); // labels appear only after permission
      const context = new AudioContext();
      audioRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      setListening(true);
      setPeak(0);
      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        const rms = Math.sqrt(sum / buffer.length);
        setLevel(rms);
        setPeak((previous) => Math.max(previous, rms));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      const name = (error as { name?: string })?.name ?? '';
      setPermission(name === 'NotAllowedError' ? 'denied' : 'prompt');
      setNotice(
        name === 'NotAllowedError'
          ? 'Microphone access was refused. Allow it in the browser’s site settings, then try again.'
          : 'The microphone could not be opened.',
      );
    }
  }

  /** Plays a short tone through the chosen output, optionally on one side. */
  async function playTone(side: 'both' | 'left' | 'right') {
    setBusy(`tone-${side}`);
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.12;
      panner.pan.value = side === 'left' ? -1 : side === 'right' ? 1 : 0;
      oscillator.connect(gain).connect(panner).connect(context.destination);
      // Output selection needs setSinkId, which not every browser exposes.
      const destination = context.destination as unknown as {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (outputId && typeof destination.setSinkId === 'function') {
        try {
          await destination.setSinkId(outputId);
        } catch {
          setNotice(
            'This browser would not switch the output device; the system default was used.',
          );
        }
      }
      oscillator.start();
      await new Promise((resolve) => setTimeout(resolve, 700));
      oscillator.stop();
      await context.close();
    } catch {
      setNotice('The test tone could not be played.');
    } finally {
      setBusy(null);
    }
  }

  /** Measures HTTP round trip to Vaani — named honestly, not called WebRTC. */
  async function measureNetwork(probes = 12) {
    const rtts: number[] = [];
    let lost = 0;
    for (let index = 0; index < probes; index += 1) {
      const started = performance.now();
      try {
        const response = await fetch(`/api/internal/ping?n=${index}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) lost += 1;
        else rtts.push(performance.now() - started);
      } catch {
        lost += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return { rtts, lossRatio: probes ? lost / probes : 0 };
  }

  async function runFullTest() {
    setBusy('test');
    setNotice(null);
    try {
      if (!listening) await startListening();
      // Give the meter a moment so the level is real, not the opening zero.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const network = await measureNetwork();
      const response = await fetch('/api/app/diagnostics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'record_test',
          rtts: network.rtts,
          lossRatio: network.lossRatio,
          micLevel: Math.max(peak, level),
          microphonePermission: permission,
          hasInputDevice: inputs.length > 0,
          inputDeviceLabel:
            inputs.find((d) => d.deviceId === inputId)?.label ??
            inputs[0]?.label ??
            '',
          outputDeviceLabel:
            outputs.find((d) => d.deviceId === outputId)?.label ?? '',
          inputDeviceId: inputId,
          outputDeviceId: outputId,
          browser: navigator.userAgent,
          platform: navigator.platform,
        }),
      });
      const body = (await response.json()) as TestResult & { error?: string };
      if (!response.ok) {
        setNotice(body.error ?? 'The diagnostic could not be recorded.');
        return;
      }
      setResult(body);
      await loadSaved();
    } finally {
      setBusy(null);
    }
  }

  async function saveDevices() {
    setBusy('save');
    try {
      await fetch('/api/app/diagnostics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save_devices',
          inputDeviceId: inputId,
          outputDeviceId: outputId,
          inputDeviceLabel: inputs.find((d) => d.deviceId === inputId)?.label,
          outputDeviceLabel: outputs.find((d) => d.deviceId === outputId)?.label,
        }),
      });
      setNotice('Devices saved for this browser.');
    } finally {
      setBusy(null);
    }
  }

  const meter = Math.min(100, Math.round(level * 320));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[9px] uppercase tracking-wider text-white/28">
          {t('screen.diagnostics.eyebrow')}
        </p>
        <h1 className="mt-1 text-lg font-semibold">
          {t('screen.diagnostics.title')}
        </h1>
        <p className="mt-1 text-[11px] text-white/40">
          {t('screen.diagnostics.description')}
          {policy?.requireDeviceTest
            ? ` This workspace requires a passing test within ${policy.validHours} hours before an agent can go available.`
            : ''}
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] text-white/70">
          {notice}
        </p>
      ) : null}

      {!supported ? (
        <p className="rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2.5 text-[11px] text-rose-100">
          {t('diag.unsupportedBrowser')}
        </p>
      ) : null}

      <section className="portal-panel p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Mic className="size-4 text-[#afbcff]" /> {t('diag.microphone')}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={inputId}
            onChange={(event) => setInputId(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
          >
            <option value="">{t('diag.systemDefault')}</option>
            {inputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <Button onClick={() => (listening ? stopListening() : void startListening())}>
            {listening ? t('diag.stop') : t('diag.testMic')}
          </Button>
          {permission === 'granted' && !inputs[0]?.label ? (
            <span className="text-[10px] text-white/35">
              {t('diag.namesAfterPermission')}
            </span>
          ) : null}
        </div>
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className={`h-full transition-[width] duration-75 ${
                meter > 92
                  ? 'bg-rose-400'
                  : meter < 6
                    ? 'bg-white/25'
                    : 'bg-emerald-400'
              }`}
              style={{ width: `${meter}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-white/35">
            {!listening
              ? t('diag.notListening')
              : meter < 6
                ? t('diag.noSound')
                : meter > 92
                  ? t('diag.clipping')
                  : t('diag.healthy')}
          </p>
        </div>
      </section>

      <section className="portal-panel p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Volume2 className="size-4 text-[#afbcff]" /> {t('diag.speaker')}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={outputId}
            onChange={(event) => setOutputId(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
          >
            <option value="">{t('diag.systemDefault')}</option>
            {outputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          {(['both', 'left', 'right'] as const).map((side) => (
            <Button
              key={side}
              disabled={busy === `tone-${side}`}
              onClick={() => void playTone(side)}
            >
              {busy === `tone-${side}` ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Play {side}
            </Button>
          ))}
          <Button disabled={busy === 'save'} onClick={() => void saveDevices()}>
            {t('diag.rememberDevices')}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-white/32">
          {t('diag.monoNote')}
        </p>
      </section>

      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Wifi className="size-4 text-[#afbcff]" /> {t('diag.readiness')}
          </h2>
          <Button
            className="portal-primary"
            disabled={busy === 'test' || !supported}
            onClick={() => void runFullTest()}
          >
            {busy === 'test' ? <Loader2 className="animate-spin" /> : null}
            {t('diag.runFullTest')}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-white/32">
          {t('diag.measuresNote')}
        </p>

        {result ? (
          <div className="mt-4 space-y-3">
            <div
              className={`rounded-xl border px-3 py-2.5 text-[11px] ${stateTone[result.readiness.state]}`}
            >
              <p className="font-semibold uppercase tracking-wide">
                {result.readiness.state === 'ready'
                  ? t('diag.readyToTake')
                  : result.readiness.state === 'warn'
                    ? t('diag.usableWithProblems')
                    : t('diag.notReady')}
              </p>
              {result.readiness.reasons.length ? (
                <ul className="mt-1.5 space-y-1">
                  {result.readiness.reasons.map((reason) => (
                    <li key={reason}>· {reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ['Score', `${result.quality.score}/100`, bandTone[result.quality.band]],
                ['Round trip', `${result.quality.rttMs} ms`, ''],
                ['Jitter', `${result.quality.jitterMs} ms`, ''],
                ['Loss', `${result.quality.lossPercent}%`, ''],
              ].map(([label, value, tone]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                >
                  <p className="text-[9px] uppercase tracking-wider text-white/28">
                    {String(label)}
                  </p>
                  <p className={`mt-1 text-sm font-semibold ${String(tone)}`}>
                    {String(value)}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/35">
              Support code{' '}
              <span className="font-mono text-white/70">
                {result.supportCode}
              </span>{' '}
              — {t('diag.supportCodeNote')}
            </p>
          </div>
        ) : null}

        {runs.length ? (
          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-wider text-white/28">
              {t('diag.recentTests')}
            </p>
            <div className="mt-2 space-y-1">
              {runs.slice(0, 5).map((run) => (
                <div
                  key={String(run.id)}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[10px]"
                >
                  <span className="font-mono text-white/70">
                    {String(run.support_code)}
                  </span>
                  <span
                    className={
                      String(run.readiness) === 'blocked'
                        ? 'text-rose-200'
                        : String(run.readiness) === 'warn'
                          ? 'text-amber-200'
                          : 'text-emerald-200'
                    }
                  >
                    {String(run.readiness)}
                  </span>
                  <span className="text-white/45">
                    {String(run.quality_score)}/100 · {String(run.rtt_ms)}ms
                  </span>
                  <span className="ml-auto text-white/28">
                    {String(run.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

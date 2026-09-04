'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Volume2, Wifi } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/components/locale-provider';
import {
  classifyIceCandidates,
  summariseRtcStats,
  type IceSummary,
  type RtcProbeSummary,
} from '@/lib/rtc-diagnostics';

/**
 * Agent workstation diagnostics (§3, §5, §6, §8, §21).
 *
 * The browser measures — devices, microphone level, round-trip time — and the
 * server scores and decides readiness, so the thresholds live in one place and
 * are testable.
 *
 * Honest about what is being measured. Three separate things, never mixed:
 *
 *  - "Connection" is HTTP round trip to Vaani. Call audio does not take this
 *    path, and the UI says so.
 *  - The **WebRTC probe** builds a throwaway peer connection to ask the
 *    questions only WebRTC can answer: which codec gets negotiated, what
 *    bitrate the encoder produces, and — when a STUN or TURN server is
 *    configured — whether media can leave this network at all. It carries no
 *    call audio.
 *  - Real call statistics come from the dialer while a call is live, off the
 *    socket that is actually carrying the voice.
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
type WebRtcProbe = {
  supported: boolean;
  error?: string | null;
  ice?: IceSummary | null;
  stats?: RtcProbeSummary | null;
};
type TestResult = {
  supportCode: string;
  quality: Verdict;
  readiness: { state: 'ready' | 'warn' | 'blocked'; reasons: string[] };
};

const bandTone: Record<string, string> = {
  excellent: 'text-success-text',
  good: 'text-success-text',
  fair: 'text-warning-text',
  poor: 'text-danger-text',
};
const stateTone: Record<string, string> = {
  ready: 'border-emerald-400/35 bg-emerald-400/10 text-success-text',
  warn: 'border-amber-400/30 bg-amber-400/10 text-warning-text',
  blocked: 'border-rose-400/35 bg-rose-400/10 text-danger-text',
};

/**
 * Asks the browser and the network what they can actually do, using a
 * throwaway loopback peer connection. Two answers come out of it:
 *
 *  - What WebRTC negotiates and produces here — codec, clock rate, bitrate.
 *    Real numbers, but they never left this machine, so `scope` says
 *    `loopback` and the UI does not present the jitter as call quality.
 *  - Whether media can leave this network. That needs something to reflect
 *    off, so without a configured STUN or TURN server the verdict is
 *    `untested` rather than a guess.
 *
 * Cleans up both connections and its own audio on every path, including
 * failure — a leaked peer connection keeps the microphone light on.
 */
async function probeWebRtc(
  iceServers: RTCIceServer[],
  stream: MediaStream | null,
): Promise<WebRtcProbe> {
  if (typeof RTCPeerConnection === 'undefined')
    return {
      supported: false,
      error: 'This browser does not support WebRTC.',
    };
  const local = new RTCPeerConnection({ iceServers });
  const remote = new RTCPeerConnection({ iceServers });
  let context: AudioContext | null = null;
  const candidates: string[] = [];
  try {
    local.onicecandidate = (event) => {
      if (!event.candidate) return;
      candidates.push(event.candidate.candidate);
      void remote.addIceCandidate(event.candidate).catch(() => {});
    };
    remote.onicecandidate = (event) => {
      if (event.candidate)
        void local.addIceCandidate(event.candidate).catch(() => {});
    };

    // Prefer the real microphone so the codec sees real speech; fall back to a
    // generated tone when permission was refused, because the codec and
    // reachability answers do not need the agent's voice.
    let track = stream?.getAudioTracks()[0] ?? null;
    if (!track) {
      context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      oscillator.connect(destination);
      oscillator.start();
      track = destination.stream.getAudioTracks()[0];
    }
    if (track) local.addTrack(track);
    remote.addTransceiver('audio', { direction: 'recvonly' });

    const offer = await local.createOffer();
    await local.setLocalDescription(offer);
    await remote.setRemoteDescription(offer);
    const answer = await remote.createAnswer();
    await remote.setLocalDescription(answer);
    await local.setRemoteDescription(answer);

    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      // Bounded wait: some networks never finish gathering, and a diagnostic
      // that hangs is worse than one that reports what it has.
      const deadline = window.setTimeout(resolve, 3500);
      const check = () => {
        if (
          local.iceGatheringState === 'complete' &&
          local.connectionState === 'connected'
        ) {
          window.clearTimeout(deadline);
          resolve();
        }
      };
      local.onicegatheringstatechange = check;
      local.onconnectionstatechange = check;
      check();
    });
    // A moment of real media so the byte and packet counters are non-zero.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const reports: Array<Record<string, unknown>> = [];
    (await local.getStats()).forEach((report) =>
      reports.push(report as unknown as Record<string, unknown>),
    );
    (await remote.getStats()).forEach((report) =>
      reports.push(report as unknown as Record<string, unknown>),
    );
    return {
      supported: true,
      ice: classifyIceCandidates(candidates, {
        stunConfigured: iceServers.length > 0,
      }),
      stats: summariseRtcStats(reports, {
        elapsedMs: performance.now() - startedAt,
        scope: 'loopback',
      }),
    };
  } catch (error) {
    return {
      supported: true,
      error:
        error instanceof Error
          ? error.message.slice(0, 200)
          : 'The WebRTC probe failed.',
      ice: classifyIceCandidates(candidates, {
        stunConfigured: iceServers.length > 0,
      }),
    };
  } finally {
    local.close();
    remote.close();
    if (context) void context.close();
  }
}

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
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [webrtc, setWebrtc] = useState<WebRtcProbe | null>(null);

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
        iceServers?: RTCIceServer[];
      };
      setRuns(body.runs ?? []);
      setPolicy(body.policy ?? null);
      setIceServers(body.iceServers ?? []);
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
    setWebrtc(null);
    try {
      if (!listening) await startListening();
      // Give the meter a moment so the level is real, not the opening zero.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const network = await measureNetwork();
      const rtc = await probeWebRtc(iceServers, streamRef.current);
      setWebrtc(rtc);
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
          webrtc: rtc,
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
          outputDeviceLabel: outputs.find((d) => d.deviceId === outputId)
            ?.label,
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
        <p className="text-[9px] uppercase tracking-wider text-ink-muted">
          {t('screen.diagnostics.eyebrow')}
        </p>
        <h1 className="mt-1 text-lg font-semibold">
          {t('screen.diagnostics.title')}
        </h1>
        <p className="mt-1 text-[11px] text-ink-muted">
          {t('screen.diagnostics.description')}
          {policy?.requireDeviceTest
            ? ` This workspace requires a passing test within ${policy.validHours} hours before an agent can go available.`
            : ''}
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink">
          {notice}
        </p>
      ) : null}

      {!supported ? (
        <p className="rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2.5 text-[11px] text-danger-text">
          {t('diag.unsupportedBrowser')}
        </p>
      ) : null}

      <section className="portal-panel p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Mic className="size-4 text-primary" /> {t('diag.microphone')}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={inputId}
            onChange={(event) => setInputId(event.target.value)}
            className="rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px]"
          >
            <option value="">{t('diag.systemDefault')}</option>
            {inputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <Button
            onClick={() =>
              listening ? stopListening() : void startListening()
            }
          >
            {listening ? t('diag.stop') : t('diag.testMic')}
          </Button>
          {permission === 'granted' && !inputs[0]?.label ? (
            <span className="text-[10px] text-ink-muted">
              {t('diag.namesAfterPermission')}
            </span>
          ) : null}
        </div>
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-strong">
            <div
              className={`h-full transition-[width] duration-75 ${
                meter > 92
                  ? 'bg-rose-400'
                  : meter < 6
                    ? 'bg-surface-strong'
                    : 'bg-emerald-400'
              }`}
              style={{ width: `${meter}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-ink-muted">
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
          <Volume2 className="size-4 text-primary" /> {t('diag.speaker')}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={outputId}
            onChange={(event) => setOutputId(event.target.value)}
            className="rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px]"
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
        <p className="mt-2 text-[10px] text-ink-muted">{t('diag.monoNote')}</p>
      </section>

      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Wifi className="size-4 text-primary" /> {t('diag.readiness')}
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
        <p className="mt-2 text-[10px] text-ink-muted">
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
                [
                  'Score',
                  `${result.quality.score}/100`,
                  bandTone[result.quality.band],
                ],
                ['Round trip', `${result.quality.rttMs} ms`, ''],
                ['Jitter', `${result.quality.jitterMs} ms`, ''],
                ['Loss', `${result.quality.lossPercent}%`, ''],
              ].map(([label, value, tone]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
                >
                  <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                    {String(label)}
                  </p>
                  <p className={`mt-1 text-sm font-semibold ${String(tone)}`}>
                    {String(value)}
                  </p>
                </div>
              ))}
            </div>
            {webrtc ? (
              <div className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                  {t('diag.webrtcTitle')}
                </p>
                {!webrtc.supported ? (
                  <p className="mt-1.5 text-[11px] text-danger-text">
                    {webrtc.error}
                  </p>
                ) : (
                  <>
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      {(
                        [
                          [
                            t('diag.codec'),
                            webrtc.stats?.codec
                              ? `${webrtc.stats.codec}${
                                  webrtc.stats.clockRateHz
                                    ? ` ${Math.round(webrtc.stats.clockRateHz / 1000)}kHz`
                                    : ''
                                }`
                              : t('diag.notMeasured'),
                          ],
                          [
                            t('diag.encoderBitrate'),
                            webrtc.stats?.sendBitrateKbps !== null &&
                            webrtc.stats?.sendBitrateKbps !== undefined
                              ? `${webrtc.stats.sendBitrateKbps} kbps`
                              : t('diag.notMeasured'),
                          ],
                          [
                            t('diag.packets'),
                            webrtc.stats?.packetsSent !== null &&
                            webrtc.stats?.packetsSent !== undefined
                              ? `${webrtc.stats.packetsSent} / ${webrtc.stats.packetsReceived ?? 0}`
                              : t('diag.notMeasured'),
                          ],
                          [
                            t('diag.mediaReach'),
                            t(`diag.ice.${webrtc.ice?.verdict ?? 'untested'}`),
                          ],
                        ] as Array<[string, string]>
                      ).map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                            {label}
                          </p>
                          <p className="mt-0.5 text-[12px] text-ink">{value}</p>
                        </div>
                      ))}
                    </div>
                    {webrtc.ice?.reason ? (
                      <p className="mt-2 text-[10px] leading-relaxed text-ink-muted">
                        {webrtc.ice.reason}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[10px] leading-relaxed text-ink-muted">
                      {t('diag.webrtcScope')}
                    </p>
                    {webrtc.error ? (
                      <p className="mt-1.5 text-[10px] text-warning-text">
                        {webrtc.error}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            <p className="text-[10px] text-ink-muted">
              Support code{' '}
              <span className="font-mono text-ink">{result.supportCode}</span> —{' '}
              {t('diag.supportCodeNote')}
            </p>
          </div>
        ) : null}

        {runs.length ? (
          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted">
              {t('diag.recentTests')}
            </p>
            <div className="mt-2 space-y-1">
              {runs.slice(0, 5).map((run) => (
                <div
                  key={String(run.id)}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface-muted px-2.5 py-1.5 text-[10px]"
                >
                  <span className="font-mono text-ink">
                    {String(run.support_code)}
                  </span>
                  <span
                    className={
                      String(run.readiness) === 'blocked'
                        ? 'text-danger-text'
                        : String(run.readiness) === 'warn'
                          ? 'text-warning-text'
                          : 'text-success-text'
                    }
                  >
                    {String(run.readiness)}
                  </span>
                  <span className="text-ink-muted">
                    {String(run.quality_score)}/100 · {String(run.rtt_ms)}ms
                  </span>
                  <span className="ml-auto text-ink-muted">
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

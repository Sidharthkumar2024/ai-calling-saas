'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MicOff, Pause, PhoneCall, PhoneOff, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/components/locale-provider';

/**
 * Browser dialer (§2, §9, §12).
 *
 * The tab carries the audio: microphone in, agent voice out, over a WebSocket
 * to the media gateway. It never holds the gateway secret — it gets a token
 * Vaani minted for this one call, valid for two minutes.
 *
 * Telephony to a real customer still needs a carrier. This leg connects the
 * agent to the AI, which is what makes the dialer testable today, and the UI
 * says so rather than implying a customer is on the line.
 */

const FRAME_SAMPLES = 160; // 20 ms at 8 kHz
const TARGET_RATE = 8000;

/**
 * Runs in the audio thread: decimates the hardware rate down to 8 kHz and
 * posts exactly one 20 ms frame at a time, so the socket sends a steady
 * stream instead of bursts.
 */
const DOWNSAMPLER_WORKLET = `
class VaaniDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = options.processorOptions || {};
    this.targetRate = settings.targetRate || 8000;
    this.frameSamples = settings.frameSamples || 160;
    this.carry = [];
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const ratio = sampleRate / this.targetRate;
    for (let index = 0; index < input.length / ratio; index += 1) {
      this.carry.push(input[Math.floor(index * ratio)] || 0);
    }
    while (this.carry.length >= this.frameSamples) {
      const frame = new Float32Array(this.carry.splice(0, this.frameSamples));
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}
registerProcessor('vaani-downsampler', VaaniDownsampler);
`;

type Agent = { id: string; name: string; primary_language: string };
type NumberRow = { id: string; phone_number: string; status: string };
type Turn = { heard: string; reply: string; latency?: Record<string, number> };

/** Signed 16-bit sample to a mulaw byte (G.711). */
function pcmToMulaw(sample: number) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let value = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = value < 0 ? 0x80 : 0;
  if (value < 0) value = -value;
  if (value > CLIP) value = CLIP;
  value += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1)
    exponent -= 1;
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function text(value: unknown, fallback = '') {
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'number' || typeof value === 'boolean')
    return value.toString();
  return fallback;
}

function mulawToPcm(byte: number) {
  const BIAS = 0x84;
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

export function CustomerDialer() {
  const t = useT();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [recent, setRecent] = useState<Record<string, unknown>[]>([]);
  const [gatewayReady, setGatewayReady] = useState<boolean | null>(null);
  const [agentId, setAgentId] = useState('');
  const [fromNumberId, setFromNumberId] = useState('');
  const [destination, setDestination] = useState('');
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'ending'>(
    'idle',
  );
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const callIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playAtRef = useRef(0);
  const mutedRef = useRef(false);
  const heldRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/dialer');
      if (!response.ok) return;
      const body = (await response.json()) as {
        agents?: Agent[];
        numbers?: NumberRow[];
        recent?: Record<string, unknown>[];
        gatewayConfigured?: boolean;
      };
      setAgents(body.agents ?? []);
      setNumbers(body.numbers ?? []);
      setRecent(body.recent ?? []);
      setGatewayReady(Boolean(body.gatewayConfigured));
      if (!agentId && body.agents?.[0]) setAgentId(body.agents[0].id);
    } catch {
      setGatewayReady(false);
    }
  }, [agentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (state !== 'live') return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const teardown = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    workletRef.current = null;
    void captureRef.current?.close();
    captureRef.current = null;
    void playbackRef.current?.close();
    playbackRef.current = null;
    playAtRef.current = 0;
    setMuted(false);
    setHeld(false);
    mutedRef.current = false;
    heldRef.current = false;
  }, []);

  // Never leave a microphone open or a socket dangling when the panel goes.
  useEffect(() => teardown, [teardown]);

  /** Queues one 8 kHz mulaw frame for playback, gapless. */
  function playFrame(payload: string) {
    const context = playbackRef.current;
    if (!context) return;
    const bytes = atob(payload);
    const buffer = context.createBuffer(1, bytes.length, TARGET_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < bytes.length; index += 1) {
      channel[index] = mulawToPcm(bytes.charCodeAt(index)) / 32768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    // Schedule back-to-back so frames do not click; a little ahead of "now"
    // to absorb jitter.
    const startAt = Math.max(context.currentTime + 0.05, playAtRef.current);
    source.start(startAt);
    playAtRef.current = startAt + buffer.duration;
  }

  async function startCall() {
    setNotice(null);
    setTurns([]);
    setSeconds(0);
    setState('connecting');
    try {
      const response = await fetch('/api/app/dialer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          agentId,
          fromNumberId: fromNumberId || undefined,
          destination: destination || undefined,
        }),
      });
      const body = (await response.json()) as {
        callId?: string;
        token?: string;
        gatewayUrl?: string;
        note?: string;
        error?: string;
      };
      if (!response.ok || !body.token || !body.gatewayUrl) {
        setNotice(body.error ?? 'The call could not be started.');
        setState('idle');
        return;
      }
      callIdRef.current = body.callId ?? null;
      if (body.note) setNotice(body.note);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const socket = new WebSocket(
        `${body.gatewayUrl}/?carrier=browser&token=${encodeURIComponent(body.token)}`,
      );
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            event: 'start',
            encoding: 'mulaw',
            sampleRate: TARGET_RATE,
          }),
        );
        setState('live');
      };
      socket.onmessage = (message) => {
        const frame = JSON.parse(String(message.data)) as {
          event: string;
          media?: { payload: string };
          heard?: string;
          reply?: string;
          latency?: Record<string, number>;
        };
        if (frame.event === 'media' && frame.media?.payload)
          playFrame(frame.media.payload);
        if (frame.event === 'clear') {
          // Barge-in: drop anything scheduled but not yet heard.
          playAtRef.current = 0;
        }
        if (frame.event === 'transcript')
          setTurns((previous) => [
            ...previous,
            {
              heard: frame.heard ?? '',
              reply: frame.reply ?? '',
              latency: frame.latency,
            },
          ]);
      };
      socket.onclose = (event) => {
        if (event.code === 1008)
          setNotice(`The gateway refused the call: ${event.reason}`);
        teardown();
        setState('idle');
      };
      socket.onerror = () => setNotice('The media connection failed.');

      // Capture runs in an AudioWorklet so resampling happens off the main
      // thread; ScriptProcessorNode is deprecated and glitches under load.
      const capture = new AudioContext();
      captureRef.current = capture;
      const playback = new AudioContext({ sampleRate: TARGET_RATE });
      playbackRef.current = playback;
      const workletUrl = URL.createObjectURL(
        new Blob([DOWNSAMPLER_WORKLET], { type: 'application/javascript' }),
      );
      try {
        await capture.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      const node = new AudioWorkletNode(capture, 'vaani-downsampler', {
        processorOptions: { targetRate: TARGET_RATE, frameSamples: FRAME_SAMPLES },
      });
      workletRef.current = node;
      node.port.onmessage = (event) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const samples = event.data as Float32Array;
        let binary = '';
        // Muted or on hold: send silence rather than stopping, so the gateway
        // does not read the gap as the caller hanging up.
        const silent = mutedRef.current || heldRef.current;
        for (const sample of samples)
          binary += String.fromCharCode(pcmToMulaw(silent ? 0 : sample * 32768));
        socket.send(
          JSON.stringify({ event: 'media', media: { payload: btoa(binary) } }),
        );
      };
      capture.createMediaStreamSource(stream).connect(node);
    } catch (error) {
      const name = (error as { name?: string })?.name ?? '';
      setNotice(
        name === 'NotAllowedError'
          ? 'Microphone access was refused, so the call cannot carry your voice.'
          : 'The call could not be connected.',
      );
      teardown();
      setState('idle');
    }
  }

  async function endCall() {
    setState('ending');
    socketRef.current?.send(JSON.stringify({ event: 'stop' }));
    teardown();
    const callId = callIdRef.current;
    callIdRef.current = null;
    if (callId) {
      try {
        await fetch('/api/app/dialer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'end', callId }),
        });
      } catch {
        /* the gateway also closes the call when the socket drops */
      }
    }
    setState('idle');
    await load();
  }

  const live = state === 'live';
  const ending = state === 'ending';
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[9px] uppercase tracking-wider text-white/28">
          {t('screen.dialer.eyebrow')}
        </p>
        <h1 className="mt-1 text-lg font-semibold">{t('screen.dialer.title')}</h1>
        <p className="mt-1 text-[11px] text-white/40">
          {t('screen.dialer.description')}
        </p>
      </div>

      {gatewayReady === false ? (
        <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-100">
          The media gateway is not configured, so no call can be placed. Set
          <span className="font-mono"> MEDIA_GATEWAY_SECRET </span> and
          <span className="font-mono"> MEDIA_GATEWAY_WS_URL</span>, and run
          <span className="font-mono"> services/media-gateway</span>.
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] text-white/70">
          {notice}
        </p>
      ) : null}

      <section className="portal-panel p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[10px] text-white/45">AI agent</span>
            <select
              value={agentId}
              disabled={live}
              onChange={(event) => setAgentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-white/45">
              Caller ID (optional)
            </span>
            <select
              value={fromNumberId}
              disabled={live}
              onChange={(event) => setFromNumberId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
            >
              <option value="">Not set</option>
              {numbers.map((number) => (
                <option key={number.id} value={number.id}>
                  {number.phone_number}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-white/45">
              Customer number (optional)
            </span>
            <input
              value={destination}
              disabled={live}
              placeholder="+919876543210"
              onChange={(event) => setDestination(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-white/32">
          A customer number is recorded on the call but not dialled: bridging a
          real customer onto this leg needs a carrier. Leaving it blank is a
          straight conversation with the AI.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!live ? (
            <Button
              className="portal-primary"
              disabled={
                state === 'connecting' || !agentId || gatewayReady === false
              }
              onClick={() => void startCall()}
            >
              {state === 'connecting' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <PhoneCall />
              )}
              Start call
            </Button>
          ) : (
            <>
              <span className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-100">
                <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                Live · {clock}
              </span>
              <Button
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  mutedRef.current = next;
                }}
              >
                <MicOff />
                {muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button
                onClick={() => {
                  const next = !held;
                  setHeld(next);
                  heldRef.current = next;
                }}
              >
                {held ? <Play /> : <Pause />}
                {held ? 'Resume' : 'Hold'}
              </Button>
              <Button disabled={ending} onClick={() => void endCall()}>
                <PhoneOff />
                End
              </Button>
            </>
          )}
        </div>
        {muted || held ? (
          <p className="mt-2 text-[10px] text-amber-200/80">
            {muted ? 'Your microphone is muted. ' : ''}
            {held ? 'The call is on hold; silence is being sent. ' : ''}
            The agent hears nothing until you resume.
          </p>
        ) : null}
      </section>

      {turns.length ? (
        <section className="portal-panel p-5">
          <h2 className="text-sm font-semibold">Live transcript</h2>
          <div className="mt-3 space-y-2">
            {turns.map((turn, index) => (
              <div key={index} className="space-y-1">
                <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[12px] text-white/80">
                  <span className="text-[9px] uppercase tracking-wider text-white/28">
                    you{' '}
                  </span>
                  {turn.heard || '—'}
                </p>
                <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-2 text-[12px] text-white/80">
                  <span className="text-[9px] uppercase tracking-wider text-emerald-200/60">
                    agent{' '}
                  </span>
                  {turn.reply || '—'}
                  {turn.latency ? (
                    <span className="mt-1 block text-[9px] text-white/28">
                      heard in {turn.latency.stt}ms · thought in{' '}
                      {turn.latency.llm}ms · spoke in {turn.latency.tts}ms
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length ? (
        <section className="portal-panel p-5">
          <h2 className="text-sm font-semibold">Recent dialer calls</h2>
          <div className="mt-3 space-y-1">
            {recent.slice(0, 6).map((call) => (
              <div
                key={String(call.id)}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[10px]"
              >
                <span className="text-white/70">
                  {text(call.agent_name, 'unassigned')}
                </span>
                <span className="text-white/45">{text(call.to_number, '—')}</span>
                <span className="text-white/45">
                  {Number(call.duration_seconds ?? 0)}s
                </span>
                <span className="ml-auto text-white/28">
                  {text(call.outcome) || text(call.status)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

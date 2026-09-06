'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ear, Loader2, MessageSquare, PhoneForwarded } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/components/locale-provider';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Supervisor monitoring (§12).
 *
 * Opens a listening leg on a live call. Three modes, and the difference
 * matters: `listen` is silent, `whisper` is heard only by the agent, `join`
 * is heard by everyone including the customer. The mode is signed into the
 * token by the server, so this component cannot promote itself.
 *
 * Whisper mode carries a real risk of being misunderstood, so the UI always
 * states who can hear the supervisor.
 */

const TARGET_RATE = 8000;

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

const WORKLET = `
class VaaniSupervisorTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const s = options.processorOptions || {};
    this.targetRate = s.targetRate || 8000;
    this.frameSamples = s.frameSamples || 160;
    this.carry = [];
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const ratio = sampleRate / this.targetRate;
    for (let i = 0; i < input.length / ratio; i += 1) {
      this.carry.push(input[Math.floor(i * ratio)] || 0);
    }
    while (this.carry.length >= this.frameSamples) {
      const frame = new Float32Array(this.carry.splice(0, this.frameSamples));
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}
registerProcessor('vaani-supervisor-tap', VaaniSupervisorTap);
`;

type Mode = 'listen' | 'whisper' | 'duplex';

/** Why the gateway gave a supervisor a quieter mode than they asked for. */
const DEMOTION: Record<string, TranslationKey | undefined> = {
  no_agent_to_whisper_to: 'sup.noAgentToWhisper',
  whisper_target_left: 'sup.whisperTargetLeft',
};

const AUDIENCE: Record<Mode, TranslationKey> = {
  listen: 'sup.nobodyHears',
  whisper: 'sup.onlyAgentHears',
  duplex: 'sup.everyoneHears',
};

export function SupervisorMonitor({
  callId,
  onClose,
}: {
  callId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode | null>(null);
  const [connecting, setConnecting] = useState<Mode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const playbackRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAtRef = useRef(0);

  /**
   * Closes the microphone without leaving the call.
   *
   * The gateway can take a supervisor's voice away mid-session — the agent
   * they were coaching hangs up, and a whisper with no target reaches nobody.
   * Leaving the microphone open then is a live input that goes nowhere, with
   * the browser's recording indicator still lit.
   */
  const stopMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void captureRef.current?.close();
    captureRef.current = null;
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    stopMicrophone();
    void playbackRef.current?.close();
    playbackRef.current = null;
    playAtRef.current = 0;
    setMode(null);
    setFrames(0);
  }, [stopMicrophone]);

  // Never keep listening to someone's call after this panel closes.
  useEffect(() => disconnect, [disconnect]);

  function play(payload: string) {
    const context = playbackRef.current;
    if (!context) return;
    const bytes = atob(payload);
    const buffer = context.createBuffer(1, bytes.length, TARGET_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < bytes.length; index += 1)
      channel[index] = mulawToPcm(bytes.charCodeAt(index)) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.05, playAtRef.current);
    source.start(startAt);
    playAtRef.current = startAt + buffer.duration;
  }

  async function connect(requested: Mode) {
    disconnect();
    setConnecting(requested);
    setNotice(null);
    try {
      const response = await fetch('/api/app/dialer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'monitor', callId, mode: requested }),
      });
      const body = (await response.json()) as {
        token?: string;
        gatewayUrl?: string;
        mode?: Mode;
        note?: string;
        error?: string;
      };
      if (!response.ok || !body.token || !body.gatewayUrl) {
        setNotice(body.error ?? 'Monitoring could not start.');
        return;
      }

      const socket = new WebSocket(
        `${body.gatewayUrl}/?carrier=browser&token=${encodeURIComponent(body.token)}`,
      );
      socketRef.current = socket;
      const playback = new AudioContext({ sampleRate: TARGET_RATE });
      playbackRef.current = playback;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            event: 'start',
            encoding: 'mulaw',
            sampleRate: TARGET_RATE,
          }),
        );
        setMode(body.mode ?? requested);
        setNotice(body.note ?? null);
      };
      socket.onmessage = (message) => {
        const frame = JSON.parse(String(message.data)) as {
          event: string;
          media?: { payload: string };
          mode?: Mode;
          reason?: string | null;
        };
        if (frame.event === 'media' && frame.media?.payload) {
          play(frame.media.payload);
          setFrames((count) => count + 1);
        }
        // The mode the room grants is not always the one that was asked for:
        // there may be no human agent to coach, or the one being coached may
        // hang up. This panel shows what the gateway actually did, because the
        // gap between the two is a supervisor talking to nobody.
        if (frame.event === 'mode' && frame.mode) {
          setMode(frame.mode);
          if (frame.mode === 'listen') stopMicrophone();
          const explanation = DEMOTION[frame.reason ?? ''];
          if (explanation) setNotice(t(explanation));
        }
      };
      socket.onclose = (event) => {
        if (event.code === 1008)
          setNotice(`The gateway refused this session: ${event.reason}`);
        disconnect();
      };
      socket.onerror = () => setNotice('The monitoring connection failed.');

      // Only open a microphone when the supervisor will actually be heard.
      if (requested !== 'listen') {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;
        const capture = new AudioContext();
        captureRef.current = capture;
        const url = URL.createObjectURL(
          new Blob([WORKLET], { type: 'application/javascript' }),
        );
        try {
          await capture.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(capture, 'vaani-supervisor-tap', {
          processorOptions: { targetRate: TARGET_RATE, frameSamples: 160 },
        });
        node.port.onmessage = (event) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          let binary = '';
          for (const sample of event.data as Float32Array)
            binary += String.fromCharCode(pcmToMulaw(sample * 32768));
          socket.send(
            JSON.stringify({
              event: 'media',
              media: { payload: btoa(binary) },
            }),
          );
        };
        capture.createMediaStreamSource(stream).connect(node);
      }
    } catch (error) {
      const name = (error as { name?: string })?.name ?? '';
      setNotice(
        name === 'NotAllowedError'
          ? 'Microphone access was refused, so you cannot be heard on this call.'
          : 'Monitoring could not start.',
      );
      disconnect();
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[11px] uppercase tracking-wider text-sky-700">
          {t('sup.title')}
          {mode ? ` · ${mode === 'duplex' ? 'joined' : mode}` : ''}
          {mode ? ` · ${frames} frames` : ''}
        </p>
        {(
          [
            ['listen', t('sup.listen'), Ear],
            ['whisper', t('sup.whisper'), MessageSquare],
            ['duplex', t('sup.join'), PhoneForwarded],
          ] as const
        ).map(([value, label, Icon]) => (
          <Button
            key={value}
            disabled={connecting !== null}
            onClick={() => void connect(value)}
            className={mode === value ? 'portal-primary' : ''}
          >
            {connecting === value ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Icon />
            )}
            {label}
          </Button>
        ))}
        {mode ? (
          <Button
            onClick={() => {
              disconnect();
              onClose();
            }}
          >
            {t('sup.stop')}
          </Button>
        ) : null}
      </div>
      {/* Always say who can hear the supervisor: getting this wrong means a
          customer overhears coaching. */}
      <p
        className={`mt-2 text-[11px] leading-relaxed ${
          mode === 'duplex' ? 'text-warning-text' : 'text-ink-muted'
        }`}
      >
        {mode ? t(AUDIENCE[mode]) : t('sup.choose')}
      </p>
      {notice ? (
        <p className="mt-1.5 text-[11px] text-ink-body">{notice}</p>
      ) : null}
    </div>
  );
}

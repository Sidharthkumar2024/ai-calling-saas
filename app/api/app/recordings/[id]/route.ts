import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { getRecording } from '@/lib/recording-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const call = await getRawDb().prepare(`SELECT id, recording_status, recording_storage_key, recording_url FROM call_records
    WHERE id = ? AND organization_id = ? LIMIT 1`).bind(id, auth.session.organizationId).first<{ id: string; recording_status: string; recording_storage_key: string | null; recording_url: string | null }>();
  if (!call || call.recording_status === 'not_available') return NextResponse.json({ error: 'Recording not available.' }, { status: 404 });
  if (call.recording_storage_key) {
    const object = await getRecording(call.recording_storage_key);
    if (object?.body) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'private, max-age=300');
      headers.set('content-disposition', `inline; filename="${id}.wav"`);
      return new NextResponse(object.body, { headers });
    }
  }
  if (call.recording_url?.startsWith('https://')) {
    const remote = await fetch(call.recording_url, { signal: AbortSignal.timeout(20_000) });
    if (remote.ok) return new NextResponse(remote.body, { headers: { 'content-type': remote.headers.get('content-type') || 'audio/wav', 'cache-control': 'private, max-age=120' } });
  }
  const audio = makeDemoWav();
  return new NextResponse(audio, { headers: { 'content-type': 'audio/wav', 'content-length': String(audio.byteLength), 'cache-control': 'private, max-age=300', 'content-disposition': `inline; filename="${id}-demo.wav"` } });
}

function makeDemoWav() {
  const sampleRate = 8000;
  const samples = sampleRate * 2;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => value.split('').forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / 800) * Math.min(1, (samples - i) / 800);
    const tone = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.035 * envelope;
    view.setInt16(44 + i * 2, Math.round(tone * 32767), true);
  }
  return buffer;
}

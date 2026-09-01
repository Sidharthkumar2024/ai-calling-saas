import { env } from 'cloudflare:workers';

export async function storeRecording(key: string, response: Response) {
  if (!env.RECORDINGS) return { stored: false as const, key: null };
  const contentType = response.headers.get('content-type') || 'audio/wav';
  const object = await env.RECORDINGS.put(key, response.body, {
    httpMetadata: { contentType, cacheControl: 'private, max-age=300' },
    customMetadata: { storedAt: new Date().toISOString() },
  });
  if (!object) throw new Error('Recording object could not be stored.');
  return { stored: true as const, key };
}

export async function getRecording(key: string) {
  if (!env.RECORDINGS) return null;
  return env.RECORDINGS.get(key);
}

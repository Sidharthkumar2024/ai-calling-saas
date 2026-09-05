import { env } from 'cloudflare:workers';

import { keyBelongsTo, recordingKey } from '@/lib/recording-keys';

export {
  keyBelongsTo,
  recordingKey,
  recordingPrefix,
} from '@/lib/recording-keys';

export async function storeRecording(
  input: {
    organizationId: string;
    callId: string;
    at?: Date;
    extension?: string;
  },
  response: Response,
) {
  if (!env.RECORDINGS) return { stored: false as const, key: null };
  const key = recordingKey(input);
  const contentType = response.headers.get('content-type') || 'audio/wav';
  const object = await env.RECORDINGS.put(key, response.body, {
    httpMetadata: { contentType, cacheControl: 'private, max-age=300' },
    customMetadata: {
      storedAt: new Date().toISOString(),
      // Stamped on the object itself, so an audit can answer "whose is this?"
      // from the bucket alone rather than by joining back to the database.
      organizationId: input.organizationId,
      callId: input.callId,
    },
  });
  if (!object) throw new Error('Recording object could not be stored.');
  return { stored: true as const, key };
}

/**
 * Reads a recording, and only for the workspace that owns it.
 *
 * The tenant is a required argument rather than an optional check, so a future
 * caller cannot forget it.
 */
export async function getRecording(key: string, organizationId: string) {
  if (!env.RECORDINGS) return null;
  if (!keyBelongsTo(key, organizationId)) return null;
  return env.RECORDINGS.get(key);
}

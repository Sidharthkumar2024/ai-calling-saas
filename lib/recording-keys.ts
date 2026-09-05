/**
 * Where a call recording lives, and who is allowed to read it.
 *
 * The object key used to be handed in by whoever was storing the recording.
 * It happened to be tenant-scoped at the one call site that existed, but
 * nothing here required that — a second caller could pass any string, and the
 * read path fetched whatever key was on the row without checking it belonged
 * to the workspace asking. One bad write anywhere would have turned into one
 * tenant serving another tenant's audio, and nothing in this module would
 * have objected.
 *
 * So the key is now built here from the tenant and the call, and reading is
 * refused unless the key is inside that tenant's own prefix. Both halves
 * matter: deriving it stops a bad key being written, and checking it stops one
 * already written from being served.
 *
 * The shape follows the architecture's convention rather than a flat name, so
 * a lifecycle rule can expire a month of one tenant's audio without a script
 * that parses filenames:
 *
 *   tenant/{organization}/calls/{YYYY}/{MM}/{call}/recording.{ext}
 */

const SAFE_SEGMENT = /^[A-Za-z0-9_.:@+-]{1,120}$/;

export function recordingPrefix(organizationId: string) {
  return `tenant/${organizationId}/`;
}

/**
 * Builds the key. Rejects ids that are not simple identifiers rather than
 * escaping them — a `../` in an object key is not a formatting problem to be
 * cleaned up, it is a caller doing something it should not.
 */
export function recordingKey(input: {
  organizationId: string;
  callId: string;
  at?: Date;
  extension?: string;
}) {
  if (!SAFE_SEGMENT.test(input.organizationId))
    throw new Error(
      'Recording key: organization id is not a plain identifier.',
    );
  if (!SAFE_SEGMENT.test(input.callId))
    throw new Error('Recording key: call id is not a plain identifier.');
  const at = input.at ?? new Date();
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const extension = /^[a-z0-9]{1,5}$/.test(input.extension ?? '')
    ? input.extension
    : 'wav';
  return `${recordingPrefix(input.organizationId)}calls/${year}/${month}/${input.callId}/recording.${extension}`;
}

/** Whether a stored key is inside this workspace's own prefix. */
export function keyBelongsTo(key: string | null, organizationId: string) {
  if (!key) return false;
  if (key.includes('..')) return false;
  // Keys written before this convention were `<organization>/<call>.wav`.
  // They are still that workspace's own audio, so they stay readable — by the
  // same tenant and no other.
  return (
    key.startsWith(recordingPrefix(organizationId)) ||
    key.startsWith(`${organizationId}/`)
  );
}

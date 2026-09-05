/**
 * WhatsApp media: what may be sent out, and what may be kept when it comes in.
 *
 * Two directions, two different risks.
 *
 * **Outbound.** An agent asked to "send the 3 BHK options on WhatsApp" is
 * about to put the workspace's own files in front of a stranger. The risk is
 * not technical, it is that it sends something nobody meant it to — a private
 * floor plan, an unpublished price, a document belonging to another customer.
 * So an agent sends from an approved set and nothing else, and anything the
 * workspace marked sensitive is held back for a person to release rather than
 * quietly included.
 *
 * **Inbound.** A stranger is putting a file into the workspace's storage. The
 * architecture calls this step "malware/MIME/size validation", and one of
 * those three words is a promise this cannot keep:
 *
 *   **There is no virus scanning here, and this module does not pretend
 *   otherwise.** What it does is enforce an allowlist of types, check the
 *   bytes actually match the type that was declared, and cap the size. A
 *   renamed executable is caught by the byte check; a genuine malicious PDF is
 *   not, and calling this "scanned" would be the lie.
 *
 * Pure: the allowlists, the byte signatures, the size caps, the send policy
 * and the document states.
 */

export type MediaKind = 'image' | 'document' | 'video' | 'audio';

/**
 * What a workspace may receive. Deliberately short: every entry here is a
 * type somebody has to be able to open, and an allowlist that grows to be
 * convenient stops being a boundary.
 */
export const ALLOWED_INCOMING: Record<
  string,
  { kind: MediaKind; extension: string }
> = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'application/pdf': { kind: 'document', extension: 'pdf' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'audio/ogg': { kind: 'audio', extension: 'ogg' },
  'audio/mpeg': { kind: 'audio', extension: 'mp3' },
};

/** Per-kind ceilings, in bytes. WhatsApp's own limits are near these. */
export const MAX_BYTES: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
};

/**
 * First bytes of each accepted type.
 *
 * This is the check that earns its keep: WhatsApp reports a mime type, and a
 * reported type is a claim by whoever sent the file. An .exe announced as
 * `image/jpeg` passes every check except this one.
 */
const SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  {
    mime: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'video/mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'audio/ogg', bytes: [0x4f, 0x67, 0x67, 0x53] },
  { mime: 'audio/mpeg', bytes: [0x49, 0x44, 0x33] },
];

export type MediaCheck =
  | { ok: true; kind: MediaKind; extension: string; mime: string }
  | { ok: false; reason: string; detail: string };

/**
 * Whether an incoming file may be stored.
 *
 * `bytes` is optional only because the size and type can be refused before
 * anything is downloaded — refusing a 200MB file after fetching it defeats
 * the purpose of the limit.
 */
export function checkIncomingMedia(input: {
  mimeType: string;
  sizeBytes: number;
  bytes?: Uint8Array | null;
}): MediaCheck {
  const mime = (input.mimeType ?? '').split(';')[0].trim().toLowerCase();
  const allowed = ALLOWED_INCOMING[mime];
  if (!allowed)
    return {
      ok: false,
      reason: 'type_not_allowed',
      detail: `${mime || 'An unnamed type'} is not a file type this workspace accepts.`,
    };

  const size = Number(input.sizeBytes);
  if (!Number.isFinite(size) || size <= 0)
    return {
      ok: false,
      reason: 'unknown_size',
      detail:
        'The provider did not say how large the file is, so it was not fetched.',
    };
  const cap = MAX_BYTES[allowed.kind];
  if (size > cap)
    return {
      ok: false,
      reason: 'too_large',
      detail: `${Math.round(size / 1024 / 1024)}MB is over the ${Math.round(cap / 1024 / 1024)}MB limit for a ${allowed.kind}.`,
    };

  if (
    input.bytes &&
    input.bytes.length > 0 &&
    !signatureMatches(mime, input.bytes)
  )
    return {
      ok: false,
      reason: 'content_mismatch',
      // The one that catches a renamed executable.
      detail: `The file's contents are not ${mime}, whatever it was labelled as. It was not stored.`,
    };

  return { ok: true, kind: allowed.kind, extension: allowed.extension, mime };
}

function signatureMatches(mime: string, bytes: Uint8Array) {
  const signature = SIGNATURES.find((entry) => entry.mime === mime);
  if (!signature) return true;
  const offset = signature.offset ?? 0;
  if (bytes.length < offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Said on the screen next to every stored document, because a workspace
 * reviewing an Aadhaar card should know exactly what was and was not done to
 * it before they opened it.
 */
export const VALIDATION_NOTE =
  'Checked for type, contents and size. Not scanned for viruses — open documents from people you do not know with the same care you would an email attachment.';

/* ------------------------------------------------------------------ *
 * Document inbox
 * ------------------------------------------------------------------ */

export const DOCUMENT_STATUSES = [
  'new',
  'under_review',
  'accepted',
  'rejected',
  'needs_new_file',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return (
    typeof value === 'string' &&
    (DOCUMENT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Which statuses may follow which.
 *
 * `accepted` is terminal on purpose. A document a person has accepted is one
 * a decision has been made on — a KYC passed, a payment matched — and quietly
 * flipping it back later would leave the decision standing on a file the
 * screen no longer claims is good. Rejecting it means asking for a new one.
 */
export function nextStatuses(current: DocumentStatus): DocumentStatus[] {
  if (current === 'new')
    return ['under_review', 'accepted', 'rejected', 'needs_new_file'];
  if (current === 'under_review')
    return ['accepted', 'rejected', 'needs_new_file'];
  if (current === 'rejected' || current === 'needs_new_file')
    return ['under_review'];
  return [];
}

export function canMove(from: DocumentStatus, to: DocumentStatus) {
  return nextStatuses(from).includes(to);
}

/* ------------------------------------------------------------------ *
 * Outbound send policy
 * ------------------------------------------------------------------ */

export type Asset = {
  id: string;
  label: string;
  kind: MediaKind;
  url: string;
  /** Marked by the workspace as needing a person's say-so before it goes out. */
  sensitive?: boolean;
};

export type SendPolicy = {
  /** Assets this agent is allowed to send at all. */
  allowedKinds: MediaKind[];
  /** How many of them may go in one message. */
  maxAssets: number;
  /** Whether sensitive assets may be released by the agent alone. */
  allowSensitive: boolean;
};

export const DEFAULT_SEND_POLICY: SendPolicy = {
  allowedKinds: ['image', 'document'],
  maxAssets: 4,
  allowSensitive: false,
};

export type SendSet = {
  /** What will actually be sent. */
  sending: Asset[];
  /** What was asked for and held back, each with the reason. */
  withheld: Array<{ asset: Asset; reason: string }>;
  /** True when a person has to release something before this is complete. */
  needsApproval: boolean;
};

/**
 * Decides what actually goes out.
 *
 * Withheld assets are returned rather than filtered away: an agent that
 * silently sends three of the five things it was asked for has told the caller
 * something untrue, and the caller is the one who will notice.
 */
export function buildSendSet(input: {
  requested: Asset[];
  policy?: SendPolicy;
}): SendSet {
  const policy = input.policy ?? DEFAULT_SEND_POLICY;
  const sending: Asset[] = [];
  const withheld: SendSet['withheld'] = [];

  for (const asset of input.requested) {
    if (!policy.allowedKinds.includes(asset.kind)) {
      withheld.push({
        asset,
        reason: `This agent is not allowed to send ${asset.kind} files.`,
      });
      continue;
    }
    if (asset.sensitive && !policy.allowSensitive) {
      withheld.push({
        asset,
        reason: 'Marked sensitive — a person has to release it.',
      });
      continue;
    }
    if (sending.length >= policy.maxAssets) {
      withheld.push({
        asset,
        reason: `Over the ${policy.maxAssets}-file limit for one message.`,
      });
      continue;
    }
    sending.push(asset);
  }

  return {
    sending,
    withheld,
    needsApproval: withheld.some((entry) =>
      entry.reason.startsWith('Marked sensitive'),
    ),
  };
}

/**
 * What the agent should say about it.
 *
 * The point is that the caller is told the truth about what landed on their
 * phone. "I have sent all of them" when two were held back is the failure this
 * exists to prevent.
 */
export function describeSend(set: SendSet): string {
  if (set.sending.length === 0)
    return 'Nothing could be sent — tell the caller a colleague will follow up with the files.';
  const sent = `Sent ${set.sending.length} ${set.sending.length === 1 ? 'file' : 'files'}: ${set.sending.map((asset) => asset.label).join(', ')}.`;
  if (set.withheld.length === 0) return sent;
  return `${sent} ${set.withheld.length} more ${set.withheld.length === 1 ? 'was' : 'were'} not sent — tell the caller a colleague will send the rest, and do not claim they were already delivered.`;
}

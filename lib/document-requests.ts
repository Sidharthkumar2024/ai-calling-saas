/**
 * Asking a customer for a document, and meaning it.
 *
 * The Document Inbox could already receive a file over WhatsApp. What did not
 * exist was a way to *ask* — the workflow builder's "Document request" step
 * composed the line "Use the link in this message" and then sent a message with
 * no link in it. The customer read an instruction that could not be followed,
 * and the workspace sat waiting for a file nobody could send.
 *
 * So a request is a row with a token, and the token is the credential: the
 * customer has no account and never will. That shapes everything here — only
 * the hash is stored, it expires, failed attempts are counted, and one request
 * accepts one file. The rules live in this module, away from the database and
 * the network, so they can be tested and so the refusals are consistent
 * wherever a request is made from: a workflow step, a live call, or a person
 * clicking a button.
 */

export const DOCUMENT_REQUEST_STATUSES = [
  'open',
  'fulfilled',
  'expired',
  'cancelled',
] as const;

export type DocumentRequestStatus = (typeof DOCUMENT_REQUEST_STATUSES)[number];

export function isDocumentRequestStatus(
  value: unknown,
): value is DocumentRequestStatus {
  return (DOCUMENT_REQUEST_STATUSES as readonly string[]).includes(
    String(value),
  );
}

/**
 * Three days. Long enough that a customer who was driving when the call ended
 * can still send the file that evening or the next; short enough that a link to
 * an upload endpoint is not left lying in a chat history for a month.
 */
export const DEFAULT_TTL_HOURS = 72;
export const MAX_TTL_HOURS = 24 * 30;

/**
 * Failed attempts before the request closes itself.
 *
 * An upload endpoint that anyone holding the URL can post to repeatedly is a
 * free file scanner. Ten refusals is well past a customer picking the wrong
 * file twice, and well short of useful to anybody probing what the checks let
 * through.
 */
export const MAX_ATTEMPTS = 10;

/** Anything that is not already text is not text. */
function asText(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : '';
}

/** What the customer is being asked for, in a shape safe to put in a message. */
export function normaliseDocumentLabel(value: unknown): string {
  return asText(value)
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * The deployment's own public origin, or null.
 *
 * A relative path is no use: this URL is read on the customer's phone, in
 * WhatsApp, with no idea what host sent it. `localhost` is deliberately allowed
 * — it is how this is developed — but anything that is not an absolute http(s)
 * origin is refused rather than concatenated into something broken.
 */
export function linkBase(raw: unknown): string | null {
  const value = asText(raw).trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return `${url.protocol}//${url.host}`;
}

/** Where a token is redeemed. One place, so the page and the message agree. */
export function uploadPath(token: string) {
  return `/upload/${encodeURIComponent(token)}`;
}

export function uploadUrl(base: unknown, token: string): string | null {
  const origin = linkBase(base);
  if (!origin || !token) return null;
  return `${origin}${uploadPath(token)}`;
}

/**
 * Why no link can be made, phrased for the workspace rather than the customer.
 *
 * Returned instead of a URL so that every caller has something specific to
 * record and to say out loud, rather than sending an instruction with a hole
 * in it. `null` means a link is possible.
 */
export function linkProblem(base: unknown): string | null {
  if (linkBase(base)) return null;
  return asText(base).trim()
    ? 'PUBLIC_BASE_URL is set to something that is not an absolute http(s) address, so no upload link can be built.'
    : 'This deployment has no PUBLIC_BASE_URL, so there is no address to send the customer to.';
}

export function expiryFrom(
  now: Date,
  hours: unknown = DEFAULT_TTL_HOURS,
): string {
  const asked = Number(hours);
  // `|| DEFAULT` would be wrong here: 0 is falsy but it is also a real answer,
  // and someone asking for no window should get the shortest one, not the
  // longest one by accident.
  const requested = Number.isFinite(asked) ? asked : DEFAULT_TTL_HOURS;
  const capped = Math.min(MAX_TTL_HOURS, Math.max(1, Math.round(requested)));
  return new Date(now.getTime() + capped * 3_600_000).toISOString();
}

export type DocumentRequestRow = {
  status: string;
  expires_at: string | null;
  attempts: number | null;
};

export type RequestState = {
  open: boolean;
  reason:
    | 'open'
    | 'fulfilled'
    | 'cancelled'
    | 'expired'
    | 'too_many_attempts'
    | 'unknown_status';
  /** Shown to whoever is holding the link — so, to the customer. */
  message: string;
};

/**
 * Whether this request will still accept a file.
 *
 * Expiry is decided here from the timestamp rather than trusted from the status
 * column, because nothing sweeps the table between the moment a request lapses
 * and the moment somebody opens the link. A row can read `open` and be three
 * days past its deadline.
 */
export function requestState(
  row: DocumentRequestRow | null | undefined,
  now: Date = new Date(),
): RequestState {
  if (!row)
    return {
      open: false,
      reason: 'unknown_status',
      message: 'This upload link is not valid. Ask for a new one.',
    };

  if (row.status === 'fulfilled')
    return {
      open: false,
      reason: 'fulfilled',
      message:
        'This document has already been received. There is nothing left to upload here.',
    };
  if (row.status === 'cancelled')
    return {
      open: false,
      reason: 'cancelled',
      message: 'This request was withdrawn. Nothing needs to be uploaded.',
    };

  const attempts = Math.max(0, Math.round(Number(row.attempts) || 0));
  if (attempts >= MAX_ATTEMPTS)
    return {
      open: false,
      reason: 'too_many_attempts',
      message:
        'Too many files were refused on this link, so it has been closed. Ask for a new one.',
    };

  const deadline = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  if (Number.isFinite(deadline) && deadline <= now.getTime())
    return {
      open: false,
      reason: 'expired',
      message: 'This upload link has expired. Ask for a new one.',
    };

  if (row.status !== 'open')
    return {
      open: false,
      reason: 'unknown_status',
      message: 'This upload link is not valid. Ask for a new one.',
    };

  return { open: true, reason: 'open', message: 'Ready for the file.' };
}

/**
 * The message the customer actually receives.
 *
 * `url` is required, not optional with a fallback. The whole defect this
 * module exists to fix was a sentence that mentioned a link that was never
 * generated, and an optional parameter here would let it come back.
 */
export function requestMessage(input: {
  document: string;
  url: string;
  business?: string | null;
  expiresAt?: string | null;
  now?: Date;
}): string {
  const document = normaliseDocumentLabel(input.document) || 'the document';
  const from = String(input.business ?? '').trim();
  const opening = from
    ? `${from} needs your ${document}.`
    : `We need your ${document}.`;
  return [opening, `Upload it here: ${input.url}`, expiryLine(input)]
    .filter(Boolean)
    .join(' ');
}

function expiryLine(input: { expiresAt?: string | null; now?: Date }): string {
  const deadline = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  if (!Number.isFinite(deadline)) return '';
  const hours = Math.floor(
    (deadline - (input.now ?? new Date()).getTime()) / 3_600_000,
  );
  // Below an hour the honest thing is a plain instruction, not "0 hours".
  if (hours < 1) return 'The link expires shortly.';
  if (hours < 48) return `The link works for the next ${hours} hours.`;
  return `The link works for the next ${Math.floor(hours / 24)} days.`;
}

/** One line for the workspace's own screens and audit trail. */
export function describeRequest(input: {
  document: string;
  status: string;
  expiresAt?: string | null;
  now?: Date;
}): string {
  const document = normaliseDocumentLabel(input.document) || 'a document';
  const state = requestState(
    { status: input.status, expires_at: input.expiresAt ?? null, attempts: 0 },
    input.now ?? new Date(),
  );
  if (state.reason === 'fulfilled') return `${document} — received.`;
  if (state.reason === 'cancelled') return `${document} — request withdrawn.`;
  if (state.reason === 'expired')
    return `${document} — link expired, not sent.`;
  return `${document} — waiting for the customer to upload it.`;
}

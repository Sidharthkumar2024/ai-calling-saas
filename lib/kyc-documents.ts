/**
 * The KYC documents a number needs, and where each one has got to.
 *
 * What was there: the customer could upload, and then saw a number — a bare
 * `kyc_document_count`. Not which documents, not whether any had been looked
 * at, not which ones were still missing. A number sat in "kyc_review" and the
 * only honest thing anyone could say about it was "some files exist".
 *
 * And on the other side, the platform reviewed a number's documents *all at
 * once* — `UPDATE kyc_documents SET status = ? WHERE phone_number_id = ?` — so
 * approving the GST certificate also approved an address proof nobody had
 * read, and rejecting one rejected the lot.
 *
 * These are the rules for both halves: what is required, what a status means,
 * and when a number is actually cleared.
 */

export const KYC_DOCUMENT_TYPES = [
  'business_registration',
  'authorized_signatory',
  'address_proof',
  'telecom_ownership',
  'calling_use_case',
] as const;

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export function isKycDocumentType(value: unknown): value is KycDocumentType {
  return (KYC_DOCUMENT_TYPES as readonly string[]).includes(String(value));
}

export const KYC_DOCUMENT_LABEL: Record<KycDocumentType, string> = {
  business_registration: 'Business registration / GST',
  authorized_signatory: 'Authorised signatory ID',
  address_proof: 'Business address proof',
  telecom_ownership: 'Existing number ownership',
  calling_use_case: 'Calling use-case declaration',
};

/**
 * Which of them a carrier will not proceed without.
 *
 * Ownership proof is required only when the workspace is bringing a number it
 * already holds; there is nothing to prove ownership of on a number the
 * provider is issuing.
 */
export const ALWAYS_REQUIRED: KycDocumentType[] = [
  'business_registration',
  'authorized_signatory',
  'address_proof',
  'calling_use_case',
];

export function requiredFor(connectionMode: string | null | undefined) {
  return connectionMode === 'native_import' || connectionMode === 'sip_trunk'
    ? [...ALWAYS_REQUIRED, 'telecom_ownership' as KycDocumentType]
    : [...ALWAYS_REQUIRED];
}

export const KYC_STATUSES = [
  'submitted',
  'under_review',
  'approved',
  'rejected',
] as const;

export type KycStatus = (typeof KYC_STATUSES)[number];

export function isKycStatus(value: unknown): value is KycStatus {
  return (KYC_STATUSES as readonly string[]).includes(String(value));
}

/** Anything unrecognised is treated as still waiting, never as cleared. */
export function normaliseKycStatus(value: unknown): KycStatus {
  const status = typeof value === 'string' ? value : '';
  return isKycStatus(status) ? status : 'submitted';
}

/**
 * What a reviewer may do next.
 *
 * `approved` is terminal; a document that turns out to be wrong is replaced by
 * a new upload rather than un-approved, so the trail still shows what was
 * accepted and when. `rejected` reopens only by the customer sending another
 * file, which arrives as a new row.
 */
export function nextKycStatuses(current: string): KycStatus[] {
  const status = normaliseKycStatus(current);
  if (status === 'submitted') return ['under_review', 'approved', 'rejected'];
  if (status === 'under_review') return ['approved', 'rejected'];
  return [];
}

export function canMoveKyc(from: string, to: string) {
  return nextKycStatuses(from).includes(to as KycStatus);
}

/** What the customer reads next to each file. */
export function describeKycStatus(
  status: string,
  rejectionReason?: string | null,
): string {
  switch (normaliseKycStatus(status)) {
    case 'approved':
      return 'Accepted.';
    case 'rejected':
      return rejectionReason?.trim()
        ? `Not accepted — ${rejectionReason.trim()}`
        : 'Not accepted. Upload a replacement.';
    case 'under_review':
      return 'Being checked now.';
    default:
      return 'Uploaded, waiting to be checked.';
  }
}

export type DocumentRow = {
  document_type: string;
  status: string;
  rejection_reason?: string | null;
};

export type KycProgress = {
  required: KycDocumentType[];
  /** Required types with no upload at all. */
  missing: KycDocumentType[];
  /** Required types whose latest upload was turned down. */
  rejected: KycDocumentType[];
  /** Required types uploaded and not yet decided. */
  waiting: KycDocumentType[];
  approved: KycDocumentType[];
  complete: boolean;
  message: string;
};

/**
 * Where a number's paperwork stands.
 *
 * The latest upload of a type is the one that counts: a rejected GST followed
 * by a corrected one is not still rejected. Rows are expected newest-first,
 * which is how both screens query them.
 */
export function kycProgress(
  documents: DocumentRow[],
  connectionMode?: string | null,
): KycProgress {
  const required = requiredFor(connectionMode);
  const latest = new Map<string, DocumentRow>();
  for (const document of documents)
    if (!latest.has(document.document_type))
      latest.set(document.document_type, document);

  const missing: KycDocumentType[] = [];
  const rejected: KycDocumentType[] = [];
  const waiting: KycDocumentType[] = [];
  const approved: KycDocumentType[] = [];

  for (const type of required) {
    const row = latest.get(type);
    if (!row) {
      missing.push(type);
      continue;
    }
    const status = normaliseKycStatus(row.status);
    if (status === 'approved') approved.push(type);
    else if (status === 'rejected') rejected.push(type);
    else waiting.push(type);
  }

  const complete = approved.length === required.length;
  return {
    required,
    missing,
    rejected,
    waiting,
    approved,
    complete,
    message: progressMessage({
      required,
      missing,
      rejected,
      waiting,
      approved,
      complete,
    }),
  };
}

function progressMessage(input: {
  required: KycDocumentType[];
  missing: KycDocumentType[];
  rejected: KycDocumentType[];
  waiting: KycDocumentType[];
  approved: KycDocumentType[];
  complete: boolean;
}): string {
  if (input.complete) return 'All required documents accepted.';
  const parts: string[] = [];
  // Rejections first: they are the only part the customer can act on today.
  if (input.rejected.length > 0)
    parts.push(
      `${input.rejected.length} to replace (${input.rejected
        .map((type) => KYC_DOCUMENT_LABEL[type])
        .join(', ')})`,
    );
  if (input.missing.length > 0)
    parts.push(
      `${input.missing.length} still to upload (${input.missing
        .map((type) => KYC_DOCUMENT_LABEL[type])
        .join(', ')})`,
    );
  if (input.waiting.length > 0)
    parts.push(`${input.waiting.length} waiting to be checked`);
  return `${input.approved.length} of ${input.required.length} accepted — ${parts.join('; ')}.`;
}

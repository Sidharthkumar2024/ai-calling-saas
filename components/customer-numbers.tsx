'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  FileUp,
  KeyRound,
  Loader2,
  LockKeyhole,
  PhoneForwarded,
  Route,
  ShieldCheck,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeKycStatus, KYC_DOCUMENT_LABEL } from '@/lib/kyc-documents';

export type NumberRow = {
  id: string;
  phone_number: string;
  acquisition_type: string;
  public_provider_name: string;
  provider_code: string;
  connection_mode: string;
  provider_account_hint?: string | null;
  business_use_case?: string | null;
  estimated_monthly_minutes: number;
  onboarding_status: string;
  assigned_agent_name?: string | null;
  direction: string;
  kyc_status: string;
  kyc_document_count: number;
  documents?: Array<{
    id: string;
    document_type: string;
    status: string;
    rejection_reason: string | null;
    reviewed_at: string | null;
    created_at: string;
  }>;
  kycProgress?: {
    required: string[];
    missing: string[];
    rejected: string[];
    waiting: string[];
    approved: string[];
    complete: boolean;
    message: string;
  };
  status: string;
  monthly_rental: number;
};

export type CustomerNumbersData = { numbers?: NumberRow[] };

const providers = [
  {
    id: 'auto',
    name: 'Best available route',
    note: 'Vaani selects by country, compliance and quality',
  },
  {
    id: 'exotel',
    name: 'Exotel',
    note: 'India-first native import and Voicebot routing',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    note: 'Native import or programmable call routing',
  },
  {
    id: 'sip',
    name: 'SIP trunk',
    note: 'Enterprise BYOC with TLS and encrypted media',
  },
  {
    id: 'plivo',
    name: 'Plivo',
    note: 'Bring an existing business number or trunk',
  },
  { id: 'telnyx', name: 'Telnyx', note: 'SIP-based global number routing' },
] as const;

export function CustomerNumbers({
  data,
  onChanged,
  onNavigate,
}: {
  data: CustomerNumbersData;
  onChanged: () => Promise<void>;
  onNavigate?: (page: string) => void;
}) {
  const numbers = (data.numbers ?? []) as NumberRow[];

  const [phoneNumber, setPhoneNumber] = useState('+91');
  const [agentName, setAgentName] = useState('Sara · Sales');
  const [providerCode, setProviderCode] = useState('auto');
  const [connectionMode, setConnectionMode] = useState<
    'native_import' | 'sip_trunk'
  >('native_import');
  const [providerAccountId, setProviderAccountId] = useState('');
  const [businessUseCase, setBusinessUseCase] = useState(
    'Sales qualification and customer follow-up',
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [kycTargetId, setKycTargetId] = useState('');
  const [documentType, setDocumentType] = useState('business_registration');
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [verification, setVerification] = useState<{
    numberId: string;
    demoCode?: string;
    code: string;
  } | null>(null);

  async function createNumber() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/app/numbers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'connect',
          phoneNumber,
          assignedAgentName: agentName,
          direction: 'inbound_outbound',
          providerCode,
          connectionMode,
          providerAccountId,
          businessUseCase,
          estimatedMonthlyMinutes: estimatedMinutes,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        nextStep?: string;
        demoCode?: string;
        number?: { id: string };
      };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to start number setup.');
      const numberId = payload.number?.id ?? '';
      setKycTargetId(numberId);
      setMessage(payload.nextStep ?? 'Number setup started.');
      setVerification({
        numberId,
        demoCode: payload.demoCode,
        code: payload.demoCode ?? '',
      });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to start number setup.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!verification) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/app/numbers/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          numberId: verification.numberId,
          code: verification.code,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        nextStep?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to verify number.');
      setMessage(payload.nextStep ?? 'Ownership verified.');
      setKycTargetId(verification.numberId);
      setVerification(null);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to verify number.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadKyc() {
    if (!kycTargetId || !kycFile) {
      setError('Choose a number request and a PDF, JPEG or PNG document.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.set('phoneNumberId', kycTargetId);
      form.set('documentType', documentType);
      form.set('file', kycFile);
      const response = await fetch('/api/app/compliance', {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to upload KYC document.');
      setMessage(
        'Document submitted securely. The platform team can now review the number request.',
      );
      setKycFile(null);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to upload KYC document.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warning-text">
          Telephony onboarding
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Connect, verify and activate a business number
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted sm:text-sm">
          Choose a managed Vaani number or import your own carrier route.
          Credentials stay encrypted, documents stay private, and calling
          remains locked until approval.
        </p>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          {/* §15: numbers come from the workspace's own telephony account. The
              platform does not resell them, so there is no second mode. */}
          <p className="rounded-xl bg-surface-strong px-3 py-2.5 text-[11px] text-ink-body">
            Numbers come from your own telephony account. Vaani does not sell
            numbers — connect a Twilio, Exotel, Plivo or SIP number you already
            own.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => setProviderCode(provider.id)}
                className={`rounded-xl border p-3 text-left transition ${providerCode === provider.id ? 'border-cyan-300/22 bg-cyan-300/[0.045]' : 'border-hairline bg-surface-muted hover:bg-surface-strong'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{provider.name}</span>
                  <span
                    className={`size-2 rounded-full ${providerCode === provider.id ? 'bg-primary' : 'bg-surface-strong'}`}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-4 text-ink-muted">
                  {provider.note}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Connection path">
              <select
                value={connectionMode}
                onChange={(event) =>
                  setConnectionMode(
                    event.target.value as 'native_import' | 'sip_trunk',
                  )
                }
                className="number-select"
              >
                <option value="native_import">Native provider import</option>
                <option value="sip_trunk">SIP trunk / BYOC</option>
              </select>
            </Field>
            <Field label="Existing number (E.164)">
              <Input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+919876543210"
              />
            </Field>
            <Field label="Provider account / trunk reference">
              <Input
                value={providerAccountId}
                onChange={(event) => setProviderAccountId(event.target.value)}
                placeholder="Stored only as a masked hint here"
              />
            </Field>
            <div className="rounded-xl border border-violet-300/12 bg-violet-300/[0.03] p-3 text-[11px] leading-4 text-ink-muted">
              <LockKeyhole className="mb-2 size-4 text-violet-700" />
              API tokens are never stored in the number record. Add them in
              Integrations & API using encrypted secret storage.
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Calling use case">
              <Input
                value={businessUseCase}
                onChange={(event) => setBusinessUseCase(event.target.value)}
              />
            </Field>
            <Field label="Estimated minutes / month">
              <Input
                type="number"
                min="0"
                value={estimatedMinutes}
                onChange={(event) =>
                  setEstimatedMinutes(Number(event.target.value))
                }
              />
            </Field>
            <Field label="Assign AI agent">
              <Input
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
              />
            </Field>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-[11px] text-danger-text">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-[11px] text-success-text">
              {message}
            </div>
          ) : null}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={createNumber}
              disabled={loading}
              className="flex-1 bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
            >
              {loading ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Start ownership check
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onNavigate?.('integrations')}
              className="flex-1 border-hairline bg-transparent"
            >
              <LockKeyhole /> Secure provider credentials
            </Button>
          </div>

          {verification ? (
            <div className="mt-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
              <p className="text-xs font-medium">Verify number ownership</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                Local demo code:{' '}
                <span className="font-mono text-warning-text">
                  {verification.demoCode ?? 'sent to the number'}
                </span>
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  value={verification.code}
                  onChange={(event) =>
                    setVerification({
                      ...verification,
                      code: event.target.value,
                    })
                  }
                  maxLength={6}
                  className="font-mono"
                />
                <Button
                  onClick={verify}
                  disabled={loading}
                  className="bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
                >
                  Verify
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">KYC document vault</h2>
              <p className="mt-1 text-[11px] text-ink-muted">
                Documents are checksum-verified and stored outside the
                application database
              </p>
            </div>
            <FileCheck2 className="size-5 text-success-text" />
          </div>
          <div className="mt-5 space-y-4">
            <Field label="Number request">
              <select
                value={kycTargetId}
                onChange={(event) => setKycTargetId(event.target.value)}
                className="number-select"
              >
                <option value="">Select pending request</option>
                {numbers
                  .filter(
                    (item) => !['approved', 'active'].includes(item.kyc_status),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.phone_number} · {item.status.replaceAll('_', ' ')}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Document type">
              <select
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="number-select"
              >
                <option value="business_registration">
                  Business registration / GST
                </option>
                <option value="authorized_signatory">
                  Authorized signatory ID
                </option>
                <option value="address_proof">Business address proof</option>
                <option value="telecom_ownership">
                  Existing number ownership
                </option>
                <option value="calling_use_case">
                  Calling use-case declaration
                </option>
              </select>
            </Field>
            <label className="block rounded-xl border border-dashed border-hairline bg-surface-muted p-5 text-center text-[11px] text-ink-muted">
              <FileUp className="mx-auto mb-3 size-5 text-cyan-700" />
              <span>
                {kycFile?.name || 'Choose PDF, JPEG or PNG · max 8 MB'}
              </span>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(event) =>
                  setKycFile(event.target.files?.[0] ?? null)
                }
                className="mt-3"
              />
            </label>
            <Button
              onClick={uploadKyc}
              disabled={loading || !kycTargetId || !kycFile}
              className="w-full bg-emerald-300 text-[#07120d] hover:bg-emerald-200"
            >
              {loading ? <Loader2 className="animate-spin" /> : <FileUp />}{' '}
              Submit for review
            </Button>
          </div>
          <div className="mt-6 space-y-3">
            {[
              [
                '1',
                'Ownership',
                'OTP/test call or carrier credential check',
                PhoneForwarded,
              ],
              [
                '2',
                'Business KYC',
                'Identity, address and calling-purpose evidence',
                FileCheck2,
              ],
              [
                '3',
                'Provider route',
                'Native import, SIP trunk or managed DID',
                Route,
              ],
              [
                '4',
                'Security test',
                'TLS/SRTP, webhook signature and masked logs',
                ShieldCheck,
              ],
              [
                '5',
                'Activation',
                'Inbound, outbound, recording and failover test',
                CheckCircle2,
              ],
            ].map(([step, title, note, Icon]) => (
              <div
                key={String(step)}
                className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-muted p-3"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-strong text-[11px] text-ink-body">
                  {String(step)}
                </span>
                <div className="flex-1">
                  <p className="text-xs font-medium">{String(title)}</p>
                  <p className="mt-1 text-[11px] leading-4 text-ink-muted">
                    {String(note)}
                  </p>
                </div>
                <Icon className="size-4 text-ink-muted" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <DocumentTracker numbers={numbers} />

      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">
          Number inventory and activation state
        </h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Provider routing is visible to workspace owners; voice-engine vendors
          remain private behind Vaani products.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="border-y border-hairline text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                {[
                  'Number',
                  'Provider path',
                  'Agent',
                  'Use case',
                  'Volume',
                  'Documents',
                  'KYC',
                  'Onboarding',
                  'Status',
                ].map((item) => (
                  <th key={item} className="px-3 py-3 font-medium">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {numbers.map((number) => (
                <tr key={number.id}>
                  <td className="px-3 py-4 font-mono">{number.phone_number}</td>
                  <td className="px-3 py-4 text-ink-muted">
                    <p className="capitalize">
                      {(number.provider_code || 'auto').replaceAll('_', ' ')}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {(
                        number.connection_mode || number.acquisition_type
                      ).replaceAll('_', ' ')}{' '}
                      {number.provider_account_hint || ''}
                    </p>
                  </td>
                  <td className="px-3 py-4 text-ink-body">
                    {number.assigned_agent_name || 'Unassigned'}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {number.business_use_case || '—'}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {Number(
                      number.estimated_monthly_minutes || 0,
                    ).toLocaleString('en-IN')}{' '}
                    min
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {/* A bare count could not say which paperwork was
                        accepted, waiting, or never sent. */}
                    {number.kycProgress
                      ? `${number.kycProgress.approved.length}/${number.kycProgress.required.length}`
                      : Number(number.kyc_document_count || 0)}
                  </td>
                  <td className="px-3 py-4">
                    <Status value={number.kyc_status} />
                  </td>
                  <td className="px-3 py-4">
                    <Status value={number.onboarding_status || 'active'} />
                  </td>
                  <td className="px-3 py-4">
                    <Status value={number.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * Which paperwork each number has, and where it has got to.
 *
 * The screen used to show one number per number: `kyc_document_count`. That
 * could not say which document had been accepted, which was still being
 * checked, or which had never been sent — so a number sat in "kyc_review" and
 * nobody could tell what was actually holding it up.
 */
function DocumentTracker({ numbers }: { numbers: NumberRow[] }) {
  const pending = numbers.filter(
    (number) => (number.documents?.length ?? 0) > 0 || number.kycProgress,
  );
  if (pending.length === 0) return null;

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5">
      <h2 className="text-sm font-semibold">Document status</h2>
      <p className="mt-1 max-w-2xl text-[11px] text-ink-muted">
        Every file you have sent for each number, and what happened to it. A
        rejected document is replaced by uploading a new one — the old one stays
        on the record.
      </p>
      <div className="mt-4 space-y-3">
        {pending.map((number) => {
          const documents = number.documents ?? [];
          const progress = number.kycProgress;
          return (
            <div
              key={number.id}
              className="rounded-xl border border-hairline bg-surface-muted p-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">
                  {number.phone_number}
                </span>
                {progress ? (
                  <span
                    className={`text-[11px] ${progress.complete ? 'text-success-text' : 'text-ink-muted'}`}
                  >
                    {progress.message}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 space-y-1">
                {documents.length === 0 ? (
                  <p className="text-[11px] text-ink-muted">
                    Nothing uploaded for this number yet.
                  </p>
                ) : null}
                {documents.map((document) => (
                  <p key={document.id} className="text-[11px]">
                    <span className="text-ink-body">
                      {KYC_DOCUMENT_LABEL[
                        document.document_type as keyof typeof KYC_DOCUMENT_LABEL
                      ] ?? document.document_type.replaceAll('_', ' ')}
                    </span>
                    <span
                      className={
                        document.status === 'approved'
                          ? ' text-success-text'
                          : document.status === 'rejected'
                            ? ' text-danger-text'
                            : ' text-ink-muted'
                      }
                    >
                      {' — '}
                      {describeKycStatus(
                        document.status,
                        document.rejection_reason,
                      )}
                    </span>
                  </p>
                ))}
                {/* Named rather than left to be inferred from an absence. */}
                {progress?.missing.length ? (
                  <p className="text-[11px] text-warning-text">
                    Not sent yet:{' '}
                    {progress.missing
                      .map(
                        (type) =>
                          KYC_DOCUMENT_LABEL[
                            type as keyof typeof KYC_DOCUMENT_LABEL
                          ] ?? type,
                      )
                      .join(', ')}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs text-ink-body">
      {label}
      <div className="mt-2 [&_.number-select]:h-10 [&_.number-select]:w-full [&_.number-select]:rounded-lg [&_.number-select]:border [&_.number-select]:border-hairline [&_.number-select]:bg-surface [&_.number-select]:px-3 [&_.number-select]:text-xs [&_input]:h-10 [&_input]:border-hairline [&_input]:bg-surface-muted">
        {children}
      </div>
    </label>
  );
}
function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const positive = ['active', 'approved', 'verified'].some((item) =>
    normalized.includes(item),
  );
  const warning = [
    'pending',
    'required',
    'review',
    'submitted',
    'verification',
  ].some((item) => normalized.includes(item));
  return (
    <Badge
      variant="outline"
      className={`${positive ? 'border-emerald-400/15 text-success-text' : warning ? 'border-amber-300/15 text-warning-text' : 'border-hairline text-ink-muted'} text-[11px]`}
    >
      {value.replaceAll('_', ' ')}
    </Badge>
  );
}

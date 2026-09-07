import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { PublicFooter } from '@/components/public-footer';

const privacy = [
  ['Information in your workspace', 'The platform processes account and business details, contacts, messages, call metadata, recordings and transcripts when those features are used. Payment and usage records support billing. Do not upload information you are not authorised to use.'],
  ['Why information is processed', 'Workspace information supports calling, follow-ups, customer support, analytics, billing and security. An agent uses the business context and knowledge sources configured for that workspace.'],
  ['Recordings and AI improvement', 'Only enable recording where you have an appropriate basis and have provided any required notice or consent. Historical recordings should be reviewed and approved before becoming agent playbooks. Uploading a recording is not permission to train a general-purpose model on it.'],
  ['Service providers and access', 'Configured communications, AI, payment and storage providers may process information to deliver the features you enable. Provider-specific processing terms and retention need to be reviewed before a live launch. Team access depends on workspace roles.'],
  ['Retention and requests', 'Retention depends on your workspace configuration and applicable obligations. Contact your workspace owner to request access, corrections, export or deletion. Platform operator contact details and a formal request process must be published before public launch.'],
  ['Cookies and local preferences', 'Sign-in uses session cookies. Browser storage remembers choices such as language and notification sounds. Signing out ends the current authenticated session.'],
];
const terms = [
  ['Using VANI', 'VANI provides tools for business conversations and automation. You are responsible for your account, authorised team members, business content and the activities initiated in your workspace. Keep credentials private.'],
  ['Calling and messaging', 'Use only contacts and phone numbers you are authorised to contact. Honour consent, opt-outs, calling restrictions and channel rules. Do not use the service for impersonation, harassment, spam or other unlawful activity.'],
  ['AI and human oversight', 'AI output can be inaccurate. Review agent prompts, knowledge, payment details and customer-facing actions before enabling automation. Use approval gates and human handoff where an action needs review.'],
  ['Plans, credits and payments', 'Review the plan, credit quantity, currency and checkout total before paying. Production purchases are confirmed after verification by the payment system. Sandbox purchases are simulations, not money transfers. Commercial refund, cancellation and expiry terms must be finalised and disclosed before paid public launch.'],
  ['Your data and integrations', 'You retain responsibility for your uploaded content and connected accounts. Connect only services you are authorised to manage, and review each provider’s permissions. Customer payment collections are separate from VANI subscription billing.'],
  ['Service and support', 'Availability depends on the platform and configured service providers. Support commitments, liability terms, governing law and the operating legal entity are pending commercial and legal review. This preview is not a published service-level agreement.'],
];
export function PolicyPage({ type }: { type: 'privacy' | 'terms' }) {
  const title = type === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
  return <main className="vani-auth min-h-screen text-ink">
    <article className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="size-4" /> Back to VANI</Link>
      <ShieldCheck className="mt-12 size-9 text-primary" /><h1 className="mt-5 text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-4 text-sm text-ink-muted">Last updated: 7 September 2026</p>
      <aside className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Pre-launch draft. The operating company, contact details and commercial/legal terms still require review before this policy can be used for a public launch.</aside>
      <div className="mt-10 space-y-9">{(type === 'privacy' ? privacy : terms).map(([heading, body], index) => <section key={heading}><h2 className="text-lg font-semibold">{index + 1}. {heading}</h2><p className="mt-3 text-base leading-7 text-ink-body">{body}</p></section>)}</div>
    </article><PublicFooter />
  </main>;
}

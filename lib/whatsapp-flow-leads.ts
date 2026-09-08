/**
 * Turning a filled-in WhatsApp form into a lead.
 *
 * The forms went in last, and the answers landed on a screen and stopped
 * there. A form that asks somebody's name, their budget and when they can
 * visit, and then leaves all three sitting in a list nobody follows up from,
 * is the shape this project keeps removing: a built thing that reaches
 * nowhere. Answers now enter the CRM the same way a website form's do.
 *
 * The mapping is guesswork, and it is done here where it can be read and
 * argued with rather than buried in a webhook. The rule is: keep every answer,
 * guess only the four fields the CRM actually indexes, and put everything else
 * in the notes under the question it answered — so nothing a customer typed is
 * lost because this module did not recognise a field name.
 *
 * Pure — no database, no fetch.
 */

/** Answer names that mean "this is the person's name", most specific first. */
const NAME_KEYS = [
  'full_name',
  'name',
  'customer_name',
  'your_name',
  'first_name',
];
const EMAIL_KEYS = ['email', 'email_address', 'your_email'];
const PHONE_KEYS = [
  'phone',
  'phone_number',
  'mobile',
  'contact_number',
  'whatsapp_number',
];
const INTEREST_KEYS = [
  'interested_in',
  'product_interest',
  'interest',
  'looking_for',
  'requirement',
  'budget',
];

function pick(answers: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = (answers[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

/** A phone number the dialer could actually call. */
export function usablePhone(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

export type FlowLead = {
  sourceType: 'whatsapp';
  externalLeadId: string;
  name: string;
  phone: string;
  email?: string;
  productInterest?: string;
  campaignName: string;
  notes: string;
};

/**
 * Builds the lead a form's answers describe.
 *
 * `senderPhone` is where the form came back from and is the fallback: a person
 * who filled in a form on WhatsApp is reachable at the number they filled it
 * in from, whatever they typed into a phone field.
 *
 * Returns null only when there is no number at all to call, because a lead
 * nobody can contact is a row that wastes somebody's time in a queue.
 */
export function leadFromFlowAnswers(input: {
  answers: Record<string, string>;
  senderPhone: string;
  flowName: string;
  flowToken: string;
}): FlowLead | null {
  const answers = input.answers ?? {};
  const phone =
    usablePhone(input.senderPhone) || usablePhone(pick(answers, PHONE_KEYS));
  if (!phone) return null;

  const typed = pick(answers, NAME_KEYS);
  // A lead needs a name, and inventing one is worse than saying where it came
  // from: "WhatsApp form" beside the number is honest and searchable.
  const name =
    typed.length >= 2 ? typed.slice(0, 120) : `WhatsApp form · ${phone}`;

  const email = pick(answers, EMAIL_KEYS);
  const interest = pick(answers, INTEREST_KEYS);

  // Every answer, under the question it answered. Recognising a field name is
  // how it reaches a CRM column; not recognising one must not be how it is
  // thrown away.
  const notes = Object.entries(answers)
    .filter(([, value]) => (value ?? '').trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return {
    sourceType: 'whatsapp',
    // The send token, so a retried webhook cannot produce a second lead even
    // if it gets past the duplicate check above it.
    externalLeadId: input.flowToken,
    name,
    phone,
    ...(email ? { email } : {}),
    ...(interest ? { productInterest: interest.slice(0, 200) } : {}),
    campaignName: input.flowName || 'WhatsApp form',
    notes: notes.slice(0, 4000),
  };
}

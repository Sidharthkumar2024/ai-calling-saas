export const BUSINESS_STEPS = [
  {
    title: 'Your business',
    description: 'What should your AI know before it talks to anyone?',
    fields: ['company', 'website', 'business'],
  },
  {
    title: 'Your customers',
    description: 'Who do you serve, and what alternatives do they consider?',
    fields: ['ideal_customer', 'competitors'],
  },
  {
    title: 'Your first goal',
    description:
      'Choose a starting point. Nothing is launched or sent automatically.',
    fields: ['goals', 'lead_definition'],
  },
] as const;

export const BUSINESS_GOALS = [
  'Generate qualified leads',
  'Build a sales funnel',
  'Book appointments',
  'Improve customer support',
  'Collect payments',
  'Increase repeat purchases',
];

export function businessStepError(
  step: number,
  answers: Record<string, string>,
): string | null {
  const required =
    step === 0
      ? ['company', 'business']
      : step === 1
        ? ['ideal_customer']
        : ['goals', 'lead_definition'];
  if (
    required.some(
      (key) =>
        typeof answers[key] !== 'string' || answers[key].trim().length < 3,
    )
  )
    return 'Please add a little detail to the required answers before continuing.';
  if (step === 0 && answers.website?.trim()) {
    try {
      const url = new URL(
        answers.website.includes('://')
          ? answers.website
          : `https://${answers.website}`,
      );
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !url.hostname.includes('.')
      )
        return 'Enter a valid website address, or leave it blank.';
    } catch {
      return 'Enter a valid website address, or leave it blank.';
    }
  }
  return null;
}

export function firstBusinessStep(answers: Record<string, string>) {
  const first = BUSINESS_STEPS.findIndex((_, index) =>
    businessStepError(index, answers),
  );
  return first < 0 ? 0 : first;
}

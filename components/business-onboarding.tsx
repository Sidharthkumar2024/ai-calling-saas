'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Leaf, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BUSINESS_GOALS,
  BUSINESS_STEPS,
  businessStepError,
  firstBusinessStep,
} from '@/lib/business-onboarding';
import { DISCOVERY_QUESTIONS } from '@/lib/growth-manager';

export function BusinessOnboarding({
  initial,
  onDone,
  onCancel,
}: {
  initial: Record<string, string>;
  onDone: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [answers, setAnswers] = useState(initial);
  const [step, setStep] = useState(() => firstBusinessStep(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const questions = new Map(
    DISCOVERY_QUESTIONS.map((question) => [question.id, question]),
  );
  async function next(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = businessStepError(step, answers);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save_discovery', answers, step }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          result.error || 'Could not save your answers. Please try again.',
        );
      if (step < 2) setStep(step + 1);
      else await onDone();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save your answers.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-hairline bg-surface p-6 sm:p-9">
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
        <Leaf className="size-4" /> Let’s build your business brief
      </span>
      <h2 className="mt-5 text-3xl font-semibold tracking-tight">
        {BUSINESS_STEPS[step].title}
      </h2>
      <p className="mt-2 text-base text-ink-body">
        {BUSINESS_STEPS[step].description}
      </p>
      <ol
        aria-label="Business setup progress"
        className="my-7 grid grid-cols-3 gap-3"
      >
        {BUSINESS_STEPS.map((item, index) => (
          <li
            key={item.title}
            aria-current={index === step ? 'step' : undefined}
            className={`border-t-2 pt-3 text-sm ${index <= step ? 'border-emerald-700 text-emerald-800' : 'border-hairline text-ink-muted'}`}
          >
            <span className="mr-1 inline-flex">
              {index < step ? <Check className="size-4" /> : `0${index + 1}`}
            </span>{' '}
            {item.title}
          </li>
        ))}
      </ol>
      <form onSubmit={next} className="space-y-5">
        {step === 2 ? (
          <div
            className="flex flex-wrap gap-2"
            aria-label="Suggested business goals"
          >
            {BUSINESS_GOALS.map((goal) => (
              <button
                key={goal}
                type="button"
                disabled={busy}
                aria-pressed={answers.goals === goal}
                onClick={() => setAnswers({ ...answers, goals: goal })}
                className={`rounded-full border px-3 py-2 text-sm ${answers.goals === goal ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-hairline'}`}
              >
                {goal}
              </button>
            ))}
          </div>
        ) : null}
        {BUSINESS_STEPS[step].fields.map((key) => {
          const question = questions.get(key)!;
          return (
            <label className="block" key={key}>
              <span className="text-sm font-medium">
                {question.question}{' '}
                {['website', 'competitors'].includes(key) ? (
                  <span className="font-normal text-ink-muted">(optional)</span>
                ) : null}
              </span>
              <span className="mt-1 block text-sm text-ink-muted">
                {question.purpose}
              </span>
              {key === 'company' || key === 'website' ? (
                <Input
                  className="mt-2 h-12 text-base"
                  value={answers[key] ?? ''}
                  onChange={(event) =>
                    setAnswers({ ...answers, [key]: event.target.value })
                  }
                  disabled={busy}
                  maxLength={2000}
                  placeholder={
                    key === 'website'
                      ? 'https://your-company.com'
                      : 'Your company name'
                  }
                />
              ) : (
                <textarea
                  className="mt-2 w-full rounded-xl border border-hairline bg-surface p-3 text-base"
                  rows={3}
                  maxLength={2000}
                  value={answers[key] ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    setAnswers({ ...answers, [key]: event.target.value })
                  }
                />
              )}
            </label>
          );
        })}
        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-3 text-sm text-danger-text"
          >
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-5">
          <Button
            type="button"
            variant="outline"
            disabled={busy || (step === 0 && !onCancel)}
            onClick={() => (step > 0 ? setStep(step - 1) : onCancel?.())}
          >
            <ArrowLeft /> {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {step === 2 ? 'Open my business workspace' : 'Save & continue'}
            <ArrowRight />
          </Button>
        </div>
        <p className="text-sm text-ink-muted">
          Answers are saved to your workspace after each step. Calls, campaigns,
          paid scans and messages still need a separate action.
        </p>
      </form>
    </section>
  );
}

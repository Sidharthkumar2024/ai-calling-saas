'use client';

import { useLocale } from '@/components/locale-provider';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { SELECTABLE_TOOLS } from '@/lib/agent-tool-catalog';
import { VAANI_ENGINES } from '@/lib/vaani-engine-catalog';
import type { TranslationKey } from '@/lib/i18n';

/**
 * The numbers band, and what is deliberately not in it.
 *
 * The layout this follows carries traction figures — users, calls handled, a
 * store rating. Vaani has none of those yet, and a landing page that prints
 * "50 lakh+ users" before it has them is the one thing on a site that cannot
 * be walked back once a customer checks.
 *
 * So the band holds only figures this repository can prove: the languages the
 * agent actually speaks, the tools it can actually call, the engines that
 * actually exist. Each is counted from its own catalog at build time rather
 * than typed in here, which means it cannot drift into a claim.
 *
 * When there are real usage figures, they belong here — read from the
 * platform's own tables, not typed into this file.
 */
export function LandingProofBand() {
  const { t } = useLocale();

  const facts: Array<{ value: string; key: TranslationKey }> = [
    {
      value: String(SUPPORTED_LANGUAGES.length),
      key: 'landing.proof.languages',
    },
    { value: String(SELECTABLE_TOOLS.length), key: 'landing.proof.tools' },
    { value: String(VAANI_ENGINES.length), key: 'landing.proof.engines' },
    { value: '24×7', key: 'landing.proof.hours' },
  ];

  return (
    <section className="border-y border-hairline bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <h2 className="max-w-3xl whitespace-pre-line text-[32px] font-normal leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
          {t('landing.proof.title')}
        </h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-ink-body">
          {t('landing.proof.sub')}
        </p>

        <div className="mt-12 grid grid-cols-2 gap-8 sm:gap-10 lg:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.key}>
              <p className="text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[56px]">
                {fact.value}
              </p>
              <p className="mt-3 text-base text-ink-body">{t(fact.key)}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-sm text-ink-muted">
          {t('landing.proof.note')}
        </p>
      </div>
    </section>
  );
}

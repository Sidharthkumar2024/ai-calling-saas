'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Headphones,
  IndianRupee,
  PhoneIncoming,
  ShoppingBag,
  Sparkles,
  Target,
} from 'lucide-react';

import { useT } from '@/components/locale-provider';
import type { TranslationKey } from '@/lib/i18n';

/**
 * The demo conversations stay as written in each entry: they are the thing
 * being demonstrated — Vaani speaking Hindi, Hinglish and English — not
 * interface copy. The labels around them come from the catalog.
 */
const examples = [
  {
    key: 'showcase.tab.sales',
    icon: ShoppingBag,
    agent: 'Tara · Commerce',
    language: 'Hinglish',
    customer: 'Send the product details on WhatsApp and payment link at 8 PM.',
    response:
      'ज़रूर। Payment link भेजने से पहले confirm कर दूँ—क्या इसी calling number पर WhatsApp चलता है?',
    actionKey: 'showcase.sales',
  },
  {
    key: 'showcase.tab.qualification',
    icon: Target,
    agent: 'Sara · Qualification',
    language: 'Hindi + English',
    customer: 'My budget is around ₹2 crore and I want possession this year.',
    response:
      'आपकी timeline और budget के हिसाब से CRM, AI calling और automation का सही package सुझा सकती हूँ। क्या मैं Sidharth के साथ demo call schedule कर दूँ?',
    actionKey: 'showcase.qualification',
  },
  {
    key: 'showcase.tab.reception',
    icon: PhoneIncoming,
    agent: 'Meera · Reception',
    language: 'Multilingual',
    customer: 'I need to speak with someone from accounts tomorrow morning.',
    response:
      'I can arrange that. I will create a callback for the accounts team and share the confirmed time on WhatsApp.',
    actionKey: 'showcase.reception',
  },
  {
    key: 'showcase.tab.appointments',
    icon: CalendarCheck2,
    agent: 'Kabir · Scheduling',
    language: 'Indian English',
    customer: 'Do you have an appointment after 5 PM on Thursday?',
    response:
      'Yes, 5:30 PM and 6:15 PM are available. Which slot should I reserve for you?',
    actionKey: 'showcase.appointments',
  },
  {
    key: 'showcase.tab.support',
    icon: Headphones,
    agent: 'Aarohi · Support',
    language: 'Hindi',
    customer: 'मेरा order अभी तक deliver नहीं हुआ है।',
    response:
      'मैं order status check कर रही हूँ। यदि delivery आज तक नहीं होती, तो मैं support executive के लिए priority ticket बना दूँगी।',
    actionKey: 'showcase.support',
  },
] as const;

export function LandingAgentShowcase() {
  const t = useT();
  const [active, setActive] = useState(0);
  const example = examples[active];
  const Icon = example.icon;
  return (
    <section
      id="agent-demos"
      className="landing-lazy border-y border-hairline bg-[#f6f7fb] py-20 text-[#101529] sm:py-28"
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <div className="grid gap-8 xl:grid-cols-[0.82fr_1.18fr] xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6e58d8]">
              {t('showcase.eyebrow')}
            </p>
            <h2 className="mt-4 text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-5xl">
              {t('showcase.title')}
            </h2>
          </div>
          <div className="xl:justify-self-end">
            <p className="max-w-xl text-sm leading-6 text-[#5f667a]">
              {t('showcase.sub')}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {examples.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`rounded-full border px-3 py-2 text-[11px] font-medium transition-colors ${active === index ? 'border-[#18203a] bg-[#18203a] text-white' : 'border-[#d8dce8] bg-white text-[#5c6375] hover:border-[#b5bbca]'}`}
                >
                  {t(item.key)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 grid overflow-hidden rounded-[26px] border border-[#dfe2eb] bg-white shadow-[0_24px_80px_-48px_rgba(28,34,58,0.35)] xl:grid-cols-[0.88fr_1.12fr]">
          <div className="relative flex min-h-[400px] flex-col overflow-hidden border-b border-[#e4e7ef] bg-[radial-gradient(circle_at_50%_30%,rgba(103,232,249,0.23),transparent_26%),radial-gradient(circle_at_58%_34%,rgba(167,139,250,0.25),transparent_36%),#fbfcff] p-5 sm:min-h-[480px] sm:p-6 xl:min-h-[520px] xl:border-b-0 xl:border-r xl:p-8">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#dfe2eb] bg-surface-strong px-3 py-1.5 text-[11px] font-medium text-[#596077]">
                <Icon className="size-3.5 text-[#6e58d8]" /> {t(example.key)}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-[#5b6478]">
                <span className="size-1.5 rounded-full bg-emerald-500" />{' '}
                {t('showcase.sandboxLive')}
              </span>
            </div>
            <div className="my-auto">
              <div className="mx-auto flex size-40 items-center justify-center rounded-full border border-[#dfe3f0] bg-surface-strong shadow-[inset_0_0_60px_rgba(124,58,237,0.08)] sm:size-52 xl:size-60">
                <div
                  className="flex h-24 w-40 items-center justify-center gap-1.5"
                  aria-label={t('showcase.voiceAria')}
                >
                  {[16, 28, 44, 64, 38, 78, 52, 86, 60, 34, 68, 46, 24].map(
                    (height, index) => (
                      <span
                        key={`${height}-${index}`}
                        className="w-1.5 rounded-full bg-gradient-to-t from-[#56c9e7] to-[#7968e8]"
                        style={{ height }}
                      />
                    ),
                  )}
                </div>
              </div>
              <div className="mt-8 text-center">
                <p className="text-lg font-semibold">{example.agent}</p>
                <p className="mt-1 text-xs text-[#5b6478]">
                  {example.language} · {t('showcase.playground')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-[#5b6478]">
              {(
                [
                  'showcase.noCall',
                  'showcase.creditsPerTurn',
                  'showcase.actionsPreviewed',
                ] as TranslationKey[]
              ).map((key) => (
                <div
                  key={key}
                  className="rounded-xl border border-[#e1e4ed] bg-surface-strong p-2.5"
                >
                  {t(key)}
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-[520px] flex-col bg-[#f3f4f9] p-6 sm:p-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6e58d8]">
                {t('showcase.previewEyebrow')}
              </p>
              <h3 className="mt-3 max-w-lg text-2xl font-semibold tracking-tight">
                {t('showcase.previewTitle')}
              </h3>
            </div>
            <div className="mt-8 space-y-4">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-[#18203a] p-4 text-sm leading-6 text-white">
                <p className="mb-2 text-[11px] uppercase tracking-wider text-white/60">
                  {t('showcase.customer')}
                </p>
                {example.customer}
              </div>
              <div className="max-w-[92%] rounded-2xl rounded-tl-md border border-[#dfe2eb] bg-white p-4 text-sm leading-6 text-[#4e566c]">
                <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6e58d8]">
                  <Sparkles className="size-3" /> {t('showcase.response')}
                </p>
                {example.response}
              </div>
            </div>
            <div className="mt-5 space-y-2">
              {['action1', 'action2', 'action3'].map((leaf) => (
                <div
                  key={leaf}
                  className="flex items-center gap-3 rounded-xl border border-emerald-600/10 bg-emerald-500/[0.045] p-3 text-[11px] text-[#365b50]"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  <span className="flex-1">
                    {t(`${example.actionKey}.${leaf}` as TranslationKey)}
                  </span>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] text-[#5b6478]">
                    {t('showcase.preview')}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-auto flex flex-col gap-3 border-t border-[#dee1ea] pt-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-[11px] text-[#777f92]">
                <IndianRupee className="size-3.5" /> {t('showcase.testMode')}
              </div>
              <Link
                href="/signup"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#18203a] px-2.5 text-sm font-medium text-white transition-colors hover:bg-[#222c4c] sm:ml-auto"
              >
                {t('showcase.tryYourOwn')} <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

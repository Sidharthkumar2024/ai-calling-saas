'use client';
import { useState } from 'react';
import {
  benchmarkMinute,
  PRICING_REVIEW_DATE,
  WHATSAPP_INDIA,
} from '@/lib/pricing-reference';
import {
  contribution,
  PLANS,
  STANDARD_MINUTE_BUDGET_INR,
} from '@/lib/commercial-catalog';

export function PricingReference({ admin = false }: { admin?: boolean }) {
  const [fx, setFx] = useState(90);
  const [sell, setSell] = useState(19);
  const model = benchmarkMinute(fx, sell);
  return (
    <details className="rounded-2xl border border-hairline bg-surface p-5">
      <summary className="cursor-pointer text-base font-semibold">
        Usage costs explained{admin ? ' · plan economics' : ''}
      </summary>
      <div className="mt-5 space-y-5 text-sm leading-6">
        <p className="rounded-xl bg-amber-50 p-3 text-amber-950">
          Reference snapshot · {PRICING_REVIEW_DATE}. These are supplier
          benchmarks, not a provider invoice. New plans use catalog
          2026-09-08-v1; existing subscriptions and prepaid balances are
          preserved. New credits cost ₹1.90 each.
        </p>
        <h3 className="text-lg font-semibold">
          WhatsApp · India recipient numbers
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="py-2">Delivered message category</th>
                <th>Meta base charge</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(WHATSAPP_INDIA).map(([name, rate]) => (
                <tr key={name} className="border-t border-hairline">
                  <td className="py-2 capitalize">{name.replaceAll('_', ' ')}</td>
                  <td>
                    {rate
                      ? `₹${rate.toFixed(4)}`
                      : 'Free in the eligible service window'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          A customer’s message opens a rolling 24-hour service window. Service
          replies and eligible utility replies are free during that window;
          marketing is not generally free. Outside it, use an approved template
          and valid opt-in. Eligible ad-entry conversations may have a 72-hour
          free window. BSP fees, AI processing and taxes are separate.{' '}
          <a
            className="underline"
            href="https://whatsappbusiness.com/products/platform-pricing/"
            target="_blank"
            rel="noreferrer"
          >
            Meta pricing and eligibility
          </a>
          .
        </p>
        <p>
          Voice usage includes the voice engine <em>or</em> separate STT + LLM +
          TTS components, plus carrier, transfer legs, storage and optional
          analysis. Do not count a bundled engine and its components twice.
          Provider-billable duration can include silence and rounding. Credits
          are wallet units—not automatically minutes.
        </p>
        {admin ? (
          <>
            <h3 className="text-lg font-semibold">
              Plan economics · subscription + usage
            </h3>
            <p>
              New monthly subscriptions include no recurring voice credits.
              Seat/feature/sender enforcement requires further validation.
              Consent, basic role security, opt-out and human escalation belong
              in every tier.
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className="rounded-xl border border-hairline p-4"
                >
                  <h4 className="font-semibold">{plan.name}</h4>
                  <p className="my-2 text-2xl font-semibold">
                    ₹{plan.monthly.toLocaleString('en-IN')}
                    <span className="text-xs font-normal"> / month</span>
                  </p>
                  <p>
                    {plan.agents} agents ·{' '}
                    {plan.concurrency} concurrent calls ceiling
                  </p>
                  <p className="mt-2 text-ink-muted">{plan.features.join(' · ')}</p>
                </article>
              ))}
            </div>
            <h3 className="text-lg font-semibold">
              Illustrative monthly contribution
            </h3>
            <p>
              Planning budget ₹{STANDARD_MINUTE_BUDGET_INR.toFixed(2)}/AI
              minute; target sell ₹19/minute, 3% collection allowance. Live
              duration billing is a release gate, not yet a verified tariff.
              Carrier, rentals and premium routes are additional.
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              {PLANS.map((p, i) => {
                const minutes = [500, 2000, 10000][i];
                const result = contribution(p.monthly, minutes)!;
                return (
                  <article
                    key={p.id}
                    className="rounded-xl border border-hairline p-4"
                  >
                    <h4>
                      {p.name} · {minutes.toLocaleString('en-IN')} minutes
                    </h4>
                    <p className="mt-2 text-xl font-semibold">
                      ₹{Math.round(result.gross).toLocaleString('en-IN')}
                    </p>
                    <p>
                      {((result.margin ?? 0) * 100).toFixed(1)}% contribution
                      before fixed costs
                    </p>
                  </article>
                );
              })}
            </div>
            <p>
              Not net profit: subtract salaries, support, fixed hosting, sales,
              refunds and other overhead. The default India stack is Sarvam STT
              + language model + Bulbul voice; voice synthesis is the largest
              estimated component at heavy usage. Deepgram handles
              transcription; ElevenLabs premium voice is priced separately, not
              added on top of bundled voice engines.
            </p>
            <h3 className="text-lg font-semibold">
              Voice benchmark calculator · not measured COGS
            </h3>
            <p>
              Retell reference: $0.055 infrastructure + $0.015 standard TTS +
              $0.016 selected LLM = $0.086/min.{' '}
              <a
                className="underline"
                href="https://www.retellai.com/pricing"
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
              . This is a competitor benchmark, not Call Vani’s negotiated
              supplier rate.
            </p>
            <div className="flex flex-wrap gap-4">
              <label>
                Illustrative INR / USD
                <input
                  className="ml-2 w-24 rounded-lg border border-hairline p-2"
                  type="number"
                  min="1"
                  value={fx}
                  onChange={(event) => setFx(Number(event.target.value))}
                />
              </label>
              <label>
                Proposed AI ₹ / min
                <input
                  className="ml-2 w-24 rounded-lg border border-hairline p-2"
                  type="number"
                  min="1"
                  value={sell}
                  onChange={(event) => setSell(Number(event.target.value))}
                />
              </label>
            </div>
            <p>
              Assumptions: ₹0.75 own variable infrastructure/min, 10%
              contingency, 3% collection allowance and 40% target usage margin.
              Carrier, rentals, premium models and taxes excluded.
            </p>
            {model ? (
              <p className="rounded-xl bg-emerald-50 p-4 text-emerald-950">
                Buffered cost ₹{model.bufferedCost.toFixed(2)}/min · Minimum
                price ₹{model.floorPrice.toFixed(2)}/min · Planning margin{' '}
                {(model.margin * 100).toFixed(1)}%
              </p>
            ) : (
              <p role="alert">Enter positive, finite assumptions.</p>
            )}
            <p>
              No rate or subscription is changed by this calculator. Confirm
              measured usage and supplier invoices, then use effective-dated
              admin rate cards.
            </p>
          </>
        ) : null}
      </div>
    </details>
  );
}

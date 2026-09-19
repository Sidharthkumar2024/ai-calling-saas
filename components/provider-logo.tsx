'use client';
import { useState } from 'react';
import { Plug } from 'lucide-react';
import Image from 'next/image';
import {
  siMeta,
  siFacebook,
  siWhatsapp,
  siRazorpay,
  siHubspot,
  siGoogleads,
  siGoogleanalytics,
  siGooglesearchconsole,
  siGooglesheets,
  siGooglecalendar,
  siStripe,
  siResend,
  siElevenlabs,
  siDeepgram,
  siAnthropic,
  siOpenrouter,
  siPerplexity,
  siPhonepe,
  siPaytm,
  siZoho,
  siN8n,
  siShopify,
  siGithub,
  siVonage,
  siCaldotcom,
  siMake,
  siZapier,
  type SimpleIcon,
} from 'simple-icons';

const LOGOS: Record<string, SimpleIcon> = {
  meta: siMeta,
  meta_ads: siMeta,
  facebook: siFacebook,
  whatsapp: siWhatsapp,
  whatsapp_cloud: siWhatsapp,
  razorpay: siRazorpay,
  hubspot: siHubspot,
  google_ads: siGoogleads,
  google_analytics: siGoogleanalytics,
  google_search_console: siGooglesearchconsole,
  google_sheets: siGooglesheets,
  google_calendar: siGooglecalendar,
  stripe: siStripe,
  resend: siResend,
  elevenlabs: siElevenlabs,
  elevenlabs_voice: siElevenlabs,
  deepgram: siDeepgram,
  anthropic: siAnthropic,
  anthropic_reasoning: siAnthropic,
  openrouter: siOpenrouter,
  perplexity: siPerplexity,
  phonepe: siPhonepe,
  paytm: siPaytm,
  zoho: siZoho,
  n8n: siN8n,
  shopify: siShopify,
  github: siGithub,
  telephony_vonage: siVonage,
  calcom: siCaldotcom,
  make: siMake,
  zapier: siZapier,
};

const BRAND_IMAGES: Record<string, string> = {
  google: '/brands/google-g.png',
  twilio: '/brands/twilio.svg',
  plivo: '/brands/plivo.svg',
  vobiz: '/brands/vobiz.svg',
  openai: '/brands/openai.svg',
  salesforce: '/brands/salesforce.svg',
  cartesia: '/brands/cartesia.svg',
  sarvam: '/brands/sarvam.svg',
  bolna: 'https://www.bolna.ai/favicon.ico',
  telnyx: 'https://telnyx.com/favicon.ico',
  cashfree:
    'https://cdn.prod.website-files.com/6a60525e5f4d2e4f1faed952/6a9071ad87cf45c25ea9e1df_Icon.png',
  pipedrive:
    'https://cdn.dub-1.pipedriveassets.com/www-main-renderer/_next/static/media/apple-touch-icon-57x57.9b9c7103.png',
};
const ALIASES: Record<string, string> = {
  openai_platform: 'openai',
  openai_realtime: 'openai',
  bolna_voice: 'bolna',
  cartesia_voice: 'cartesia',
  sarvam_voice: 'sarvam',
  whatsapp_cloud: 'whatsapp',
  elevenlabs_voice: 'elevenlabs',
  anthropic_reasoning: 'anthropic',
};

function BrandImage({
  src,
  size,
  className,
  label,
}: {
  src: string;
  size: number;
  className: string;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center rounded-md bg-surface-muted text-[10px] font-semibold ${className}`}
        style={{ width: size, height: size }}
      >
        {label.slice(0, 2).toUpperCase()}
      </span>
    );
  return (
    <Image
      unoptimized
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Provider marks are identification, not an assertion that an account is connected. */
export function ProviderLogo({
  provider,
  size = 24,
  className = '',
}: {
  provider: string;
  size?: number;
  className?: string;
}) {
  const normalized = provider.replace(/^provider_|^telephony_/, '');
  const key = ALIASES[normalized] ?? normalized;
  const src = BRAND_IMAGES[key];
  if (src)
    return (
      <BrandImage
        key={src}
        src={src}
        size={size}
        className={className}
        label={key}
      />
    );
  const logo = LOGOS[key] ?? LOGOS[provider];
  if (!logo)
    return (
      <Plug
        size={size}
        className={`shrink-0 text-ink-muted ${className}`}
        aria-hidden="true"
      />
    );
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={`#${logo.hex}`}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <path d={logo.path} />
    </svg>
  );
}

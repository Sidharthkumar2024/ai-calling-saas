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
  zoho: siZoho,
  n8n: siN8n,
  shopify: siShopify,
  github: siGithub,
  telephony_vonage: siVonage,
  calcom: siCaldotcom,
  make: siMake,
  zapier: siZapier,
};

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
  if (provider === 'google')
    return (
      <Image
        unoptimized
        src="/brands/google-g.png"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  const logo = LOGOS[provider];
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

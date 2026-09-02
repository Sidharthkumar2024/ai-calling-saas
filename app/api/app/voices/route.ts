import { NextResponse } from 'next/server';

import { requireCustomer } from '@/lib/api-session';
import { VAANI_VOICES, voiceFilters } from '@/lib/voice-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const country = url.searchParams.get('country');
  const language = url.searchParams.get('language');
  const style = url.searchParams.get('style');
  const voices = VAANI_VOICES.filter(
    (voice) =>
      (!country || voice.country === country) &&
      (!language || voice.language === language) &&
      (!style || voice.style === style),
  );
  return NextResponse.json({ voices, filters: voiceFilters() });
}

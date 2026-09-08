'use client';

import {
  Activity,
  CalendarCheck2,
  CheckCheck,
  PhoneIncoming,
} from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import Image from 'next/image';

/** Original product image with accessible HTML notifications. */
export function LandingPhoneScene({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const hi = locale === 'hi';
  return (
    <div className={`cv-phone-scene ${compact ? 'cv-phone-compact' : ''}`}>
      <Image
        unoptimized
        className="cv-phone-art"
        src="/media/call-vani-phone.png"
        alt={
          hi ? 'Call Vani AI कॉल असिस्टेंट' : 'Call Vani AI calling assistant'
        }
        width={1024}
        height={1536}
      />
      <div className="cv-phone-screen-card">
        <span className="cv-online">
          <span />
          {hi ? 'असिस्टेंट तैयार' : 'Assistant ready'}
        </span>
        <Activity size={26} />
        <strong>
          {hi
            ? 'हर बातचीत।\nएक बेहतर अगला कदम।'
            : 'Every conversation.\nA better next step.'}
        </strong>
        <div>
          <CheckCheck size={15} />
          {hi ? 'कॉल · WhatsApp · CRM' : 'Calls · WhatsApp · CRM'}
        </div>
      </div>
      <div className="cv-phone-note cv-note-incoming">
        <span className="cv-note-icon">
          <PhoneIncoming size={21} />
        </span>
        <div>
          <small>{hi ? 'कॉल की जानकारी' : 'CALL INTELLIGENCE'}</small>
          <strong>{hi ? 'जानें कौन कॉल कर रहा है' : 'Know who’s calling'}</strong>
          <p>{hi ? 'नई लीड · डेमो की रिक्वेस्ट' : 'New lead · Demo requested'}</p>
        </div>
      </div>
      <div className="cv-phone-note cv-note-action">
        <span className="cv-note-icon">
          <CalendarCheck2 size={21} />
        </span>
        <div>
          <small>{hi ? 'अगला कदम' : 'NEXT BEST ACTION'}</small>
          <strong>{hi ? 'फॉलो-अप, तैयार' : 'Follow-up, ready'}</strong>
          <p>
            {hi ? 'आपकी टीम के लिए पूरा संदर्भ' : 'The full context for your team'}
          </p>
        </div>
      </div>
    </div>
  );
}

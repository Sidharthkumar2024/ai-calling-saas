'use client';

import {
  Activity,
  ArrowUpRight,
  BatteryFull,
  CalendarCheck2,
  Check,
  CheckCheck,
  Database,
  FileText,
  Languages,
  MessageCircle,
  Mic,
  PhoneCall,
  PhoneOff,
  Signal,
  Volume2,
  Wifi,
} from 'lucide-react';
import { useLocale } from '@/components/locale-provider';

export function LandingCallPreview({
  step = 0,
  active = true,
}: {
  step?: number;
  active?: boolean;
}) {
  const { locale } = useLocale();
  const hi = locale === 'hi';
  const text = (en: string, hindi: string) => (hi ? hindi : en);
  const labels = [
    text('Incoming enquiry', 'नई पूछताछ'),
    text('Call Vani is listening', 'Call Vani सुन रही है'),
    text('A natural conversation', 'एक सहज बातचीत'),
    text('Next step, taken care of', 'अगला काम भी पूरा'),
    text('Ready for your team', 'आपकी टीम के लिए तैयार'),
    text('Your caller’s language', 'कॉलर की अपनी भाषा'),
  ];
  return (
    <div className="vani-call-preview">
      <div className="vani-phone-status" aria-hidden="true">
        <span>9:41</span>
        <span>
          <Signal size={12} />
          <Wifi size={12} />
          <BatteryFull size={16} />
        </span>
      </div>
      <div className="vani-phone-brand">
        <Activity size={17} />
        <strong>Call Vani</strong>
        <span>{text('DEMO', 'डेमो')}</span>
      </div>
      <div className="vani-call-identity">
        {step !== 4 && (
          <div className="vani-caller-avatar">
            {step === 3 ? (
              <Check size={30} />
            ) : step === 5 ? (
              <Languages size={27} />
            ) : (
              <PhoneCall size={27} />
            )}
          </div>
        )}
        <h3>
          {step === 3 || step === 4
            ? text('All taken care of.', 'सब हो गया।')
            : text('Neha Kapoor', 'नेहा कपूर')}
        </h3>
        <p>
          {step === 3 || step === 4
            ? text('One call. Every next step.', 'एक कॉल। हर अगला काम।')
            : text('Website enquiry · Property', 'वेबसाइट पूछताछ · प्रॉपर्टी')}
        </p>
        <div className="vani-call-status">
          <span />
          {labels[step]}
        </div>
      </div>
      <div className="vani-phone-content" key={step}>
        {step <= 1 ? (
          <>
            <div className="vani-wave-panel">
              <div className="vani-call-wave" aria-hidden="true">
                {[12, 22, 34, 20, 46, 32, 54, 28, 40, 24, 34, 16, 10].map(
                  (h, i) => (
                    <span
                      key={i}
                      className={active ? 'vani-wave-active' : ''}
                      style={{ height: h, animationDelay: `${i * 85}ms` }}
                    />
                  ),
                )}
              </div>
              <p>
                {step === 0
                  ? text(
                      'Your next conversation starts here.',
                      'आपकी अगली बातचीत यहाँ शुरू होती है।',
                    )
                  : text(
                      '“हाँ जी, बताइए। I’m listening.”',
                      '“हाँ जी, बताइए। मैं सुन रही हूँ।”',
                    )}
              </p>
            </div>
            <div className="vani-phone-card">
              <span className="vani-card-icon">
                <Activity size={17} />
              </span>
              <div>
                <strong>
                  {text('Sara · Sales assistant', 'सारा · सेल्स असिस्टेंट')}
                </strong>
                <p>
                  {text(
                    'Hindi + English · Context ready',
                    'हिंदी + अंग्रेज़ी · जानकारी तैयार',
                  )}
                </p>
              </div>
            </div>
          </>
        ) : step === 2 ? (
          <>
            <div className="vani-chat-bubble">
              2 BHK chahiye, Sector 82 mein.
            </div>
            <div className="vani-chat-bubble vani-chat-agent">
              Bilkul. Aapka budget aur move-in plan kya hai?
            </div>
            <div className="vani-chat-bubble">
              85 lakh tak. Site visit kar sakte hain?
            </div>
            <div className="vani-intent">
              <CheckCheck size={16} />
              {text('Intent captured · Site visit', 'इरादा समझा · साइट विज़िट')}
            </div>
          </>
        ) : step === 3 ? (
          <>
            <div className="vani-phone-card vani-phone-card-success">
              <span className="vani-card-icon">
                <CalendarCheck2 size={18} />
              </span>
              <div>
                <strong>{text('Site visit booked', 'साइट विज़िट बुक')}</strong>
                <p>{text('Saturday · 11:00 AM', 'शनिवार · सुबह 11 बजे')}</p>
              </div>
            </div>
            <div className="vani-phone-card">
              <span className="vani-card-icon">
                <MessageCircle size={18} />
              </span>
              <div>
                <strong>{text('Sent on WhatsApp', 'WhatsApp पर भेजा')}</strong>
                <p>
                  {text('Location + property details', 'लोकेशन और प्रॉपर्टी डिटेल')}
                </p>
              </div>
              <Check size={15} />
            </div>
            <div className="vani-phone-card">
              <span className="vani-card-icon">
                <FileText size={18} />
              </span>
              <div>
                <strong>{text('Call summary saved', 'कॉल का सारांश सेव')}</strong>
                <p>{text('Attached to the lead', 'लीड के साथ जोड़ा')}</p>
              </div>
              <Check size={15} />
            </div>
          </>
        ) : step === 4 ? (
          <>
            <div className="vani-lead-card">
              <div>
                <span>{text('QUALIFIED LEAD', 'क्वालिफाइड लीड')}</span>
                <ArrowUpRight size={17} />
              </div>
              <strong>{text('Neha Kapoor', 'नेहा कपूर')}</strong>
              <p>Sector 82 · ₹85 lakh</p>
              <div className="vani-score">
                <span>{text('Intent score', 'इंटेंट स्कोर')}</span>
                <strong>
                  82<span>/100</span>
                </strong>
              </div>
              <div className="vani-score-track">
                <span />
              </div>
            </div>
            <div className="vani-phone-card">
              <span className="vani-card-icon">
                <Database size={18} />
              </span>
              <div>
                <strong>{text('Synced to your CRM', 'आपके CRM में सेव')}</strong>
                <p>
                  {text(
                    'Recording · Summary · Follow-up',
                    'रिकॉर्डिंग · सारांश · फ़ॉलो-अप',
                  )}
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            {[
              ['हिन्दी', 'मैं आपकी साइट विज़िट बुक कर देती हूँ।'],
              ['Hinglish', 'Saturday 11 baje ka slot rakh doon?'],
              ['English', 'I can book Saturday at 11 for you.'],
            ].map(([language, line]) => (
              <div className="vani-language-card" key={language}>
                <strong>
                  <Languages size={14} />
                  {language}
                </strong>
                <p>{line}</p>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="vani-call-controls" aria-hidden="true">
        <span>
          <Mic size={19} />
        </span>
        <span className="vani-hangup">
          <PhoneOff size={19} />
        </span>
        <span>
          <Volume2 size={19} />
        </span>
      </div>
      <div className="vani-phone-home" aria-hidden="true" />
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  AudioLines,
  BookOpen,
  CalendarCheck2,
  Check,
  CheckCheck,
  FileText,
  Globe2,
  Headphones,
  Layers3,
  Pause,
  Phone,
  Play,
  RotateCcw,
  ShieldCheck,
  UserRound,
  Workflow,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/provider-logo';
import { useLocale } from '@/components/locale-provider';
import { WORKFORCE_DEMOS } from '@/lib/landing-workforce';

const CONNECTORS = [
  ['meta_ads', 'Meta Ads'],
  ['google_ads', 'Google Ads'],
  ['whatsapp', 'WhatsApp'],
  ['razorpay', 'Razorpay'],
  ['hubspot', 'HubSpot'],
  ['google_sheets', 'Google Sheets'],
] as const;

export function LandingConnectedPlatform() {
  const { locale } = useLocale();
  const hi = locale === 'hi';
  const [orbitPaused, setOrbitPaused] = useState(false);
  return (
    <section id="workflow" className="cv-section cv-connect-section">
      <div className="cv-container">
        <div className="cv-connect-layout">
          <div>
            <p className="cv-eyebrow">
              <span />
              {hi ? 'एक जुड़ा हुआ प्लेटफ़ॉर्म' : 'One connected platform'}
            </p>
            <h2 className="cv-title">
              {hi ? (
                <>
                  आपके टूल्स। आपकी टीम।
                  <br />
                  <em>एक बेहतर बातचीत।</em>
                </>
              ) : (
                <>
                  Your tools. Your team.
                  <br />
                  <em>One smarter conversation.</em>
                </>
              )}
            </h2>
            <p className="cv-sub">
              {hi
                ? 'विज्ञापन से आई लीड, वेबसाइट की पूछताछ या WhatsApp का मैसेज—Call Vani जानकारी को बातचीत और आपकी टीम के अगले काम से जोड़ता है।'
                : 'A lead from an ad. A question on your website. A message on WhatsApp. Call Vani connects that context to a conversation—and the next job for your team.'}
            </p>
            <Link href="/signup" className="cv-text-link">
              {hi ? 'अपना वर्कस्पेस बनाएँ' : 'Build your workspace'}{' '}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div
            className="cv-orbit"
            data-paused={orbitPaused}
            aria-label={
              hi ? 'Call Vani के इंटीग्रेशन' : 'Tools that connect to Call Vani'
            }
          >
            <div className="cv-orbit-rings" aria-hidden="true" />
            <div className="cv-orbit-core">
              <Activity size={36} />
              <strong>Call Vani</strong>
              <span>{hi ? 'आपकी AI टीम' : 'Your AI team'}</span>
            </div>
            <div className="cv-orbit-track">
              {CONNECTORS.map(([id, label], index) => (
                <div key={id} className={`cv-orbit-slot cv-orbit-${index}`}>
                  <div className="cv-orbit-node">
                    <ProviderLogo provider={id} size={28} />
                    <span>{label}</span>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="cv-orbit-toggle"
              aria-pressed={orbitPaused}
              onClick={() => setOrbitPaused(!orbitPaused)}
            >
              {orbitPaused ? <Play size={14} /> : <Pause size={14} />}
              {orbitPaused
                ? hi
                  ? 'घुमाएँ'
                  : 'Resume motion'
                : hi
                  ? 'रोकें'
                  : 'Pause motion'}
            </button>
          </div>
        </div>
        <div className="cv-setup-grid">
          <article>
            <span className="cv-step-number">01</span>
            <h3>{hi ? 'जानकारी जोड़ें' : 'Connect your world'}</h3>
            <p>
              {hi
                ? 'बिज़नेस की वेबसाइट, दस्तावेज़ और चुने हुए इंटीग्रेशन जोड़ें।'
                : 'Bring your website, business documents and selected integrations together.'}
            </p>
            <div className="cv-source-files">
              {[
                [FileText, 'PDF'],
                [BookOpen, 'Docs'],
                [Layers3, 'CSV'],
                [Globe2, 'Web'],
                [Workflow, 'API'],
              ].map(([Icon, label]) => {
                const I = Icon as typeof FileText;
                return (
                  <span key={String(label)}>
                    <I size={22} />
                    {String(label)}
                  </span>
                );
              })}
            </div>
          </article>
          <article>
            <span className="cv-step-number">02</span>
            <h3>{hi ? 'अपनी AI को सिखाएँ' : 'Give it your context'}</h3>
            <p>
              {hi
                ? 'ज्ञान, आवाज़, भाषा और नियम तय करें। लाइव होने से पहले प्लेग्राउंड में जाँचें।'
                : 'Set the knowledge, voice, language and rules. Test in the playground before going live.'}
            </p>
            <div className="cv-knowledge-preview">
              <span>
                <BookOpen size={17} />
                {hi ? 'ज्ञान के स्रोत' : 'Business knowledge'}
              </span>
              <div>
                <span />
                <span />
                <span />
              </div>
              <small>
                {hi ? 'जानकारी → टेस्ट → अप्रूवल' : 'Knowledge → Test → Approve'}
              </small>
            </div>
          </article>
          <article>
            <span className="cv-step-number">03</span>
            <h3>{hi ? 'अगला काम पूरा करें' : 'Make the next move'}</h3>
            <p>
              {hi
                ? 'कॉल का सारांश, CRM अपडेट और टीम के लिए फॉलो-अप—आपके नियंत्रण में।'
                : 'Call summaries, CRM updates and team follow-ups—with your controls in place.'}
            </p>
            <div className="cv-task-preview">
              <span>
                <CheckCheck size={18} />
                {hi ? 'लीड का संदर्भ तैयार' : 'Lead context prepared'}
              </span>
              <span>
                <ShieldCheck size={18} />
                {hi
                  ? 'फॉलो-अप समीक्षा के लिए तैयार'
                  : 'Follow-up ready for review'}
              </span>
            </div>
          </article>
        </div>
        <p className="cv-integration-note">
          {hi
            ? 'प्रोवाइडर खाते, क्रेडेंशियल और आवश्यक अप्रूवल जोड़ने के बाद इंटीग्रेशन सक्रिय होते हैं।'
            : 'Integrations require your provider accounts, credentials and applicable approvals. Logos identify providers, not partnerships.'}
        </p>
      </div>
    </section>
  );
}

export function LandingWorkforceDemo() {
  const [selected, setSelected] = useState<string>(WORKFORCE_DEMOS[0].id);
  const { locale } = useLocale();
  const hi = locale === 'hi';
  return (
    <section id="solutions" className="cv-section cv-workforce-section">
      <div className="cv-container">
        <div className="cv-section-head">
          <p className="cv-eyebrow">
            <span />
            {hi ? 'एक भूमिका चुनें। काम होते देखें।' : 'Pick a role. Follow the work.'}
          </p>
          <h2 className="cv-title">
            {hi ? (
              <>
                आपकी <em>AI टीम</em>, काम पर।
              </>
            ) : (
              <>
                Your <em>AI workforce</em>, in action.
              </>
            )}
          </h2>
          <p className="cv-sub">
            {hi
              ? 'बातचीत से फॉलो-अप तक—पाँच उदाहरणों में देखें कि आपका वर्कफ़्लो कैसे बन सकता है।'
              : 'Explore five example workflows, from the first conversation to a prepared follow-up.'}
          </p>
        </div>
        <Tabs
          value={selected}
          onValueChange={(value) => setSelected(String(value))}
        >
          <TabsList
            className="cv-workforce-tabs"
            aria-label={hi ? 'AI भूमिका' : 'AI role'}
          >
            {WORKFORCE_DEMOS.map((demo) => (
              <TabsTrigger value={demo.id} key={demo.id}>
                {hi ? demo.hindi : demo.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {WORKFORCE_DEMOS.map((demo) => (
            <TabsContent value={demo.id} key={demo.id}>
              <WorkforcePreview
                key={`${selected}-${locale}`}
                demo={demo}
                hi={hi}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

function WorkforcePreview({
  demo,
  hi,
}: {
  demo: (typeof WORKFORCE_DEMOS)[number];
  hi: boolean;
}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const steps = hi ? demo.stepsHi : demo.steps;
  const dialogue = hi ? demo.dialogueHi : demo.dialogue;
  const complete = step === steps.length;
  useEffect(() => {
    if (!playing || complete) return;
    const timer = window.setTimeout(() => setStep((value) => value + 1), 1900);
    return () => window.clearTimeout(timer);
  }, [playing, complete, step]);
  useEffect(() => {
    const stop = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', stop);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setPlaying(false);
    });
    if (panel.current) observer.observe(panel.current);
    return () => {
      document.removeEventListener('visibilitychange', stop);
      observer.disconnect();
    };
  }, []);
  const play = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(complete ? 0 : steps.length);
      setPlaying(false);
      return;
    }
    if (complete) setStep(0);
    setPlaying(!playing || complete);
  };
  return (
    <div ref={panel} className="cv-workforce-panel">
      <header>
        <div>
          <h3>{hi ? demo.hindi : demo.title}</h3>
          <p>{hi ? demo.descriptionHi : demo.description}</p>
        </div>
        <span className="cv-preview-badge">
          {hi ? 'उदाहरण प्रीव्यू' : 'Illustrative preview'}
        </span>
      </header>
      <div className="cv-workforce-columns">
        <div className="cv-conversation-preview">
          <div className="cv-agent-identity">
            <span>
              <AudioLines size={24} />
            </span>
            <div>
              <strong>{demo.agent}</strong>
              <small>
                {hi
                  ? 'सैंपल बातचीत · कोई लाइव कॉल नहीं'
                  : 'Sample conversation · No live call'}
              </small>
            </div>
          </div>
          <div className="cv-dialogue" aria-live="polite">
            {dialogue
              .slice(0, Math.max(1, Math.min(4, step + 1)))
              .map((line, index) => (
                <div
                  key={line}
                  className={
                    index % 2 ? 'cv-dialogue-agent' : 'cv-dialogue-caller'
                  }
                >
                  <small>
                    {index % 2 ? 'Call Vani' : hi ? 'कॉलर' : demo.caller}
                  </small>
                  <p>{line}</p>
                </div>
              ))}
          </div>
          <div className="cv-playback">
            <Button
              className="cv-play-button"
              onClick={play}
              aria-label={
                complete
                  ? 'Restart workflow preview'
                  : playing
                    ? 'Pause workflow preview'
                    : 'Play workflow preview'
              }
            >
              {complete ? (
                <RotateCcw size={21} />
              ) : playing ? (
                <Pause size={21} />
              ) : (
                <Play size={21} />
              )}
            </Button>
            <div>
              <div
                className="cv-preview-wave"
                data-playing={playing && !complete}
                aria-hidden="true"
              >
                {Array.from({ length: 38 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      height: `${12 + ((i * 17) % 29)}px`,
                      animationDelay: `${i * 65}ms`,
                    }}
                  />
                ))}
              </div>
              <small>
                {complete
                  ? hi
                    ? 'प्रीव्यू पूरा · फिर चलाएँ'
                    : 'Preview complete · Start again'
                  : playing
                    ? hi
                      ? 'प्रीव्यू चल रहा है'
                      : 'Playing workflow preview'
                    : hi
                      ? 'प्रीव्यू चलाएँ'
                      : 'Play the workflow preview'}
              </small>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reset workflow preview"
              onClick={() => {
                setStep(0);
                setPlaying(false);
              }}
            >
              <RotateCcw size={17} />
            </Button>
          </div>
        </div>
        <div className="cv-workflow-preview">
          <p className="cv-eyebrow">
            <span />
            {hi ? 'बातचीत → अगला कदम' : 'Conversation → Action'}
          </p>
          <ol>
            {steps.map((label, index) => (
              <li
                key={label}
                data-state={
                  index < step ? 'done' : index === step ? 'current' : 'pending'
                }
              >
                <span className="cv-workflow-dot">
                  {index < step ? <Check size={15} /> : index + 1}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {index < step
                      ? hi
                        ? 'प्रीव्यू में पूरा'
                        : 'Completed in preview'
                      : index === step
                        ? hi
                          ? 'अगला कदम'
                          : 'Next step'
                        : hi
                          ? 'कतार में'
                          : 'Queued'}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <progress
            className="cv-workflow-meter"
            aria-label="Workflow preview progress"
            max={5}
            value={step}
          />
          <p className="cv-preview-disclaimer">
            {hi
              ? 'यह एक इंटरैक्टिव उदाहरण है। वास्तविक कार्रवाइयों के लिए कॉन्फ़िगर किए हुए इंटीग्रेशन, सहमति और आवश्यक अप्रूवल चाहिए।'
              : 'This is an interactive example. Real actions require configured integrations, consent and any required approvals.'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LandingControlBento() {
  const { locale } = useLocale();
  const hi = locale === 'hi';
  const [approved, setApproved] = useState(false);
  return (
    <section id="product" className="cv-section">
      <div className="cv-container">
        <div className="cv-section-head">
          <p className="cv-eyebrow">
            <span />
            {hi
              ? 'संदर्भ जुड़ा रहे। नियंत्रण आपका रहे।'
              : 'Keep the context. Keep the control.'}
          </p>
          <h2 className="cv-title">
            {hi ? (
              <>
                हर चैनल जुड़ा।
                <br />
                <em>हर ज़रूरी निर्णय आपका।</em>
              </>
            ) : (
              <>
                Connected conversations.
                <br />
                <em>You stay in charge.</em>
              </>
            )}
          </h2>
        </div>
        <div className="cv-control-grid">
          <article className="cv-control-channels">
            <div>
              <Phone className="cv-feature-icon" />
              <h3>
                {hi ? 'बातचीत आगे बढ़ती रहे' : 'Keep the conversation moving'}
              </h3>
              <p>
                {hi
                  ? 'वॉइस, वेबसाइट और WhatsApp के बीच लीड का संदर्भ बनाए रखें। ज़रूरत पर टीम को सौंपें।'
                  : 'Carry lead context between voice, your website and WhatsApp. Bring in a teammate when it matters.'}
              </p>
            </div>
            <div className="cv-channel-map">
              <span>
                <Phone size={16} />
                Calls
              </span>
              <span>
                <ProviderLogo provider="whatsapp" size={17} />
                WhatsApp
              </span>
              <strong>
                <Activity size={27} />
                Call Vani
              </strong>
              <span>
                <Globe2 size={16} />
                Website
              </span>
              <span>
                <UserRound size={16} />
                Your team
              </span>
            </div>
          </article>
          <article>
            <ShieldCheck className="cv-feature-icon" />
            <h3>{hi ? 'अप्रूवल, आपकी शर्तों पर' : 'Approval, on your terms'}</h3>
            <p>
              {hi
                ? 'संवेदनशील कार्रवाई को समीक्षा के लिए रोकें। AI के ड्राफ़्ट को लाइव एक्शन समझने की गलती न हो।'
                : 'Hold sensitive actions for review. Keep AI suggestions separate from actions that actually run.'}
            </p>
            <Button
              className="cv-approve-button"
              onClick={() => setApproved(!approved)}
            >
              <CheckCheck size={18} />
              {approved
                ? hi
                  ? 'प्रीव्यू रीसेट करें'
                  : 'Reset preview'
                : hi
                  ? 'अप्रूवल प्रीव्यू'
                  : 'Preview approval'}
            </Button>
            <small aria-live="polite">
              {approved
                ? hi
                  ? 'डेमो में स्वीकृत—कोई वास्तविक कार्रवाई नहीं हुई।'
                  : 'Approved in this demo. No real action was taken.'
                : hi
                  ? 'यह सिर्फ़ इंटरैक्टिव डेमो है।'
                  : 'Interactive demo only.'}
            </small>
          </article>
          <article>
            <Workflow className="cv-feature-icon" />
            <h3>{hi ? 'आपके चुने हुए टूल्स' : 'Your tools, still yours'}</h3>
            <p>
              {hi
                ? 'CRM, पेमेंट और बिज़नेस डेटा को अपने वर्कफ़्लो में जोड़ें।'
                : 'Connect your CRM, payments and business data to the workflow you choose.'}
            </p>
            <div className="cv-tool-logos">
              {[
                ['hubspot', 'HubSpot'],
                ['razorpay', 'Razorpay'],
                ['google_sheets', 'Sheets'],
                ['meta', 'Meta'],
                ['zoho', 'Zoho'],
              ].map(([id, name]) => (
                <span key={id} title={name}>
                  <ProviderLogo provider={id} size={28} />
                  <small>{name}</small>
                </span>
              ))}
            </div>
          </article>
          <article className="cv-control-memory">
            <div>
              <Layers3 className="cv-feature-icon" />
              <h3>
                {hi
                  ? 'अगले व्यक्ति को पूरी जानकारी'
                  : 'Context for the next person'}
              </h3>
              <p>
                {hi
                  ? 'कॉल का सारांश, ट्रांसक्रिप्ट और लीड की जानकारी एक जगह। हैंडऑफ़ हो, फिर से शुरुआत नहीं।'
                  : 'A summary, transcript and lead record in one place. A handover, not a fresh start.'}
              </p>
            </div>
            <div className="cv-memory-stack">
              <span>
                <Phone size={16} />
                {hi ? 'कॉल का सारांश' : 'Call summary'}
              </span>
              <span>
                <FileText size={16} />
                {hi ? 'ट्रांसक्रिप्ट' : 'Transcript'}
              </span>
              <span>
                <CalendarCheck2 size={16} />
                {hi ? 'अगली कार्रवाई' : 'Next action'}
              </span>
              <strong>
                <Headphones size={18} />
                {hi ? 'टीम के लिए तैयार' : 'Ready for your team'}
              </strong>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

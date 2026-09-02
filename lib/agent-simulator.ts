export type SimulatedAction = {
  type:
    | 'send_whatsapp'
    | 'send_email'
    | 'create_payment_link'
    | 'schedule_follow_up'
    | 'book_appointment'
    | 'create_ticket'
    | 'transfer_human';
  label: string;
  status: 'preview';
  payload?: Record<string, string | number>;
};

type Lang = 'english' | 'hindi' | 'haryanvi' | 'punjabi';

// Detect an explicit "talk in <language>" request in a piece of text.
function detectLanguageRequest(text: string): Lang | null {
  if (/english|अंग्रेज|angrez/i.test(text)) return 'english';
  if (/punjabi|पंजाबी|पंजाब|ਪੰਜਾਬੀ| punjab/i.test(text)) return 'punjabi';
  if (/haryanvi|हरियाणवी|हरयाणवी/i.test(text)) return 'haryanvi';
  if (/hindi|हिंदी|हिन्दी/i.test(text)) return 'hindi';
  return null;
}

// Deterministically pick a line that is not a repeat of the last reply.
function pick(variants: string[], avoid: string, seed: number): string {
  const normalizedAvoid = avoid.trim().toLowerCase();
  const fresh = variants.filter(
    (line) => line.trim().toLowerCase() !== normalizedAvoid,
  );
  const pool = fresh.length ? fresh : variants;
  return pool[Math.abs(seed) % pool.length];
}

const GREETING: Record<Lang, string[]> = {
  hindi: [
    'मैं बढ़िया हूँ जी! आप सुनाइए—सब ठीक चल रहा है ना?',
    'एकदम बढ़िया जी। आप बताइए, आज कैसे मदद करूँ?',
    'बस मज़े में जी! आपका दिन कैसा जा रहा है?',
  ],
  haryanvi: [
    'मैं बढ़िया सूँ जी! आप सुनाओ—सब ठीक-ठाक सै?',
    'एकदम बढ़िया जी। बताओ, थारी के मदद करूँ?',
    'बस मौज सै जी! थारा दिन कैसा जा रया सै?',
  ],
  punjabi: [
    'ਮੈਂ ਬਿਲਕੁਲ ਵਧੀਆ ਹਾਂ ਜੀ! ਤੁਸੀਂ ਸੁਣਾਓ—ਸਭ ਠੀਕ ਹੈ ਨਾ?',
    'ਬਹੁਤ ਵਧੀਆ ਜੀ। ਦੱਸੋ, ਅੱਜ ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰਾਂ?',
    'ਬੱਸ ਮੌਜਾਂ ਜੀ! ਤੁਹਾਡਾ ਦਿਨ ਕਿਵੇਂ ਲੰਘ ਰਿਹਾ ਹੈ?',
  ],
  english: [
    "I'm doing great, thanks! How are you—all good on your side?",
    'All good here! Tell me, how can I help you today?',
    "Doing well, thank you! What's on your mind today?",
  ],
};

const DISCOVERY: Record<Lang, string[]> = {
  hindi: [
    'जी हाँ, मैं सुन रही हूँ। ज़रा खुलकर बताइए—आप किस बारे में जानना चाहते हैं?',
    'अच्छा जी। आप बस बताइए आपको क्या चाहिए, बाकी मैं संभाल लेती हूँ।',
    'हम्म, समझी। थोड़ा और बताइए ताकि मैं सही तरीके से मदद कर सकूँ।',
  ],
  haryanvi: [
    'हाँ जी, बताओ ना—किस बारै मैं जाणना चाहो सो?',
    'अच्छा जी। खुलकै बताओ, मैं थारी पूरी मदद करूँ सूँ।',
    'हम्म, समझ गी। थोड़ा और बताओ, मैं ठीक तै मदद करूँ।',
  ],
  punjabi: [
    'ਹਾਂ ਜੀ, ਦੱਸੋ ਨਾ—ਤੁਸੀਂ ਕਿਸ ਬਾਰੇ ਜਾਣਨਾ ਚਾਹੁੰਦੇ ਹੋ?',
    'ਠੀਕ ਜੀ। ਖੁੱਲ੍ਹ ਕੇ ਦੱਸੋ, ਬਾਕੀ ਮੈਂ ਸੰਭਾਲ ਲੈਂਦੀ ਹਾਂ।',
    'ਹਮਮ, ਸਮਝ ਗਈ। ਥੋੜ੍ਹਾ ਹੋਰ ਦੱਸੋ ਤਾਂ ਜੋ ਮੈਂ ਸਹੀ ਮਦਦ ਕਰ ਸਕਾਂ।',
  ],
  english: [
    "Sure, I'm listening. Tell me a bit more—what would you like to know?",
    "Got it. Just tell me what you need and I'll take care of the rest.",
    'Mm, understood. Share a little more so I can help you properly.',
  ],
};

const SWITCH_ACK: Record<Lang, string[]> = {
  hindi: [
    'बिल्कुल, हम हिंदी में ही बात करेंगे। आराम से बताइए, मैं आपकी क्या मदद करूँ?',
    'जी हाँ, मैं हिंदी में ही बात कर रही हूँ। बेझिझक बताइए, क्या चाहिए?',
  ],
  haryanvi: [
    'हाँ जी, बिल्कुल हरियाणवी में बात करांगे। आराम तै बताओ, मैं थारी के मदद करूँ?',
    'हाँ जी, मैं हरियाणवी में ए बात कर री सूँ। बेझिझक बताओ, के चाहिए?',
  ],
  punjabi: [
    'ਹਾਂ ਜੀ, ਬਿਲਕੁਲ ਪੰਜਾਬੀ ਵਿੱਚ ਗੱਲ ਕਰਦੇ ਹਾਂ। ਆਰਾਮ ਨਾਲ ਦੱਸੋ, ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰਾਂ?',
    'ਜੀ ਹਾਂ, ਮੈਂ ਪੰਜਾਬੀ ਵਿੱਚ ਹੀ ਗੱਲ ਕਰ ਰਹੀ ਹਾਂ। ਬੇਝਿਜਕ ਦੱਸੋ, ਕੀ ਮਦਦ ਕਰਾਂ?',
  ],
  english: [
    'Absolutely, I will continue in English. Please tell me how I can help you today.',
    "Yes, I'm already speaking in English—please go ahead, how can I help?",
  ],
};

const AFFIRM: Record<Lang, string> = {
  hindi:
    'बहुत अच्छा। आपकी ज़रूरत समझने के लिए बस एक-दो छोटी बातें—आपकी प्राथमिकता क्या है और कब तक करना चाहते हैं?',
  haryanvi:
    'भोत बढ़िया। थारी जरूरत समझण खातर एक-दो छोटी बात—थारी प्राथमिकता के सै अर कद तक करणा चाहो सो?',
  punjabi:
    'ਬਹੁਤ ਵਧੀਆ। ਤੁਹਾਡੀ ਲੋੜ ਸਮਝਣ ਲਈ ਬੱਸ ਇੱਕ-ਦੋ ਗੱਲਾਂ—ਤੁਹਾਡੀ ਤਰਜੀਹ ਕੀ ਹੈ ਤੇ ਕਦੋਂ ਤੱਕ ਕਰਨਾ ਹੈ?',
  english:
    "Wonderful. Just a couple of quick things to understand your need—what's your priority and by when would you like to move?",
};

export function simulateAgentTurn(input: {
  message: string;
  useCase: string;
  language: string;
  businessName: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const started = Date.now();
  const raw = input.message.trim();
  const message = raw.toLowerCase();
  const history = input.history ?? [];
  const historyText = history
    .slice(-6)
    .map((item) => item.content)
    .join(' ')
    .toLowerCase();
  const lastAssistant =
    [...history].reverse().find((item) => item.role === 'assistant')?.content ??
    '';

  // Active language: honour the most recent explicit request across the whole
  // conversation so a "talk in Punjabi" instruction persists on later turns.
  const baseLang: Lang = input.language === 'haryanvi' ? 'haryanvi' : 'hindi';
  let activeLang: Lang = baseLang;
  for (const item of history) {
    if (item.role !== 'user') continue;
    const requested = detectLanguageRequest(item.content);
    if (requested) activeLang = requested;
  }
  const requestedThisTurn = detectLanguageRequest(raw);
  if (requestedThisTurn) activeLang = requestedThisTurn;

  const seed = history.length + raw.length;

  const wantsWhatsApp = /whatsapp|व्हाट्सऐप|व्हाट्सएप|details|brochure/.test(
    message,
  );
  const wantsPayment = /payment|pay|पेमेंट|भुगतान|link|लिंक/.test(message);
  const priorPayment = /payment|pay|पेमेंट|भुगतान|link|लिंक/.test(historyText);
  const awaitingWhatsAppConfirmation =
    /calling number|इसी नंबर|whatsapp.*नंबर|नंबर.*whatsapp|नंबर पर/.test(
      lastAssistant.toLowerCase(),
    );
  const confirmsWhatsApp =
    /(?:yes|हाँ|हां|जी|yep|correct).{0,28}(?:whatsapp|व्हाट्सऐप|व्हाट्सएप|इसी|यही|same)|(?:whatsapp|व्हाट्सऐप|व्हाट्सएप).{0,28}(?:yes|हाँ|हां|जी|same)|(?:इसी|यही|same|this)\s*(?:number|नंबर)/.test(
      message,
    ) ||
    (awaitingWhatsAppConfirmation &&
      /^(yes|हाँ|हां|जी|बिल्कुल|correct|sure)[.!\s]*$/i.test(message));
  const deniesWhatsApp =
    /(?:no|नहीं|नही).{0,28}(?:whatsapp|व्हाट्सऐप|व्हाट्सएप|इस नंबर|इसी नंबर)|(?:whatsapp|व्हाट्सऐप|व्हाट्सएप).{0,28}(?:नहीं|नही|no)/.test(
      message,
    );
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const paymentContext = wantsPayment || priorPayment;
  const wantsAppointment =
    /appointment|meeting|site visit|slot|अपॉइंटमेंट|मुलाकात/.test(message);
  const wantsHuman = /human|person|manager|sales guy|executive|इंसान|मैनेजर/.test(
    message,
  );
  const asksWhatsUp =
    /क्या\s*(हो रहा|चल रहा)|के\s*हो\s*रया|what'?s up|what is happening/.test(
      message,
    );
  const asksHowAreYou =
    /कैसे\s*हो|कैसी\s*हो|के\s*हाल|तेरे\s*के\s*हाल|हाल[ -]?चाल|how are you|how'?re you|ki haal/.test(
      message,
    );
  const later = /8\s*(pm|p\.m\.|बजे)|eight\s*(pm|o'clock)|later|बाद में/.test(
    `${message} ${historyText}`,
  );
  const amountMatch = `${raw} ${historyText}`.match(
    /(?:₹|rs\.?|inr|रुपये?)?\s*(\d{2,7}(?:,\d{3})*)/i,
  );
  const amount = amountMatch ? Number(amountMatch[1].replaceAll(',', '')) : 550;
  const actions: SimulatedAction[] = [];

  if (wantsWhatsApp && !paymentContext) {
    actions.push({
      type: 'send_whatsapp',
      label: 'Preview WhatsApp product details',
      status: 'preview',
      payload: { template: 'vaani_product_details' },
    });
  }
  if (paymentContext && (confirmsWhatsApp || emailMatch)) {
    actions.push({
      type: 'create_payment_link',
      label: `Create ₹${amount.toLocaleString('en-IN')} payment link`,
      status: 'preview',
      payload: {
        amount,
        provider: 'Razorpay',
        delivery: later ? 'scheduled' : 'instant',
        channel: confirmsWhatsApp ? 'whatsapp' : 'email',
      },
    });
    actions.push(
      confirmsWhatsApp
        ? {
            type: 'send_whatsapp',
            label: later
              ? 'Deliver approved payment link on WhatsApp at 8:00 PM'
              : 'Deliver approved payment link on WhatsApp',
            status: 'preview',
            payload: { channel: 'calling_number', consent: 'confirmed' },
          }
        : {
            type: 'send_email',
            label: `Deliver approved payment link to ${emailMatch![0]}`,
            status: 'preview',
            payload: { email: emailMatch![0], consent: 'confirmed' },
          },
    );
    if (later) {
      actions.push({
        type: 'schedule_follow_up',
        label: 'Schedule delivery for 8:00 PM',
        status: 'preview',
        payload: { time: '20:00', timezone: 'Asia/Kolkata' },
      });
    }
  }
  if (wantsAppointment) {
    actions.push({
      type: 'book_appointment',
      label: 'Check and reserve an appointment slot',
      status: 'preview',
    });
  }
  if (wantsHuman) {
    actions.push({
      type: 'transfer_human',
      label: 'Prepare a warm transfer with conversation summary',
      status: 'preview',
    });
  }

  let response: string;
  if (asksHowAreYou || asksWhatsUp) {
    response = pick(GREETING[activeLang], lastAssistant, seed);
  } else if (requestedThisTurn) {
    // The caller asked to switch language — acknowledge in that language. If the
    // previous turn already requested the same language, use the "already
    // speaking this" variant instead of repeating the switch line.
    const prevUser = [...history].reverse().find((h) => h.role === 'user');
    const repeatRequest = prevUser
      ? detectLanguageRequest(prevUser.content) === activeLang
      : false;
    response = SWITCH_ACK[activeLang][repeatRequest ? 1 : 0];
  } else if (paymentContext && confirmsWhatsApp) {
    response = later
      ? `बिल्कुल। ₹${amount.toLocaleString('en-IN')} का payment link इसी WhatsApp नंबर पर रात 8 बजे भेजने की request तैयार है। भेजने से पहले amount और timing दोनों confirm हैं।`
      : `बिल्कुल। ₹${amount.toLocaleString('en-IN')} का payment link इसी WhatsApp नंबर पर भेजने की request तैयार है।`;
  } else if (paymentContext && emailMatch) {
    response = `धन्यवाद। मैंने ${emailMatch[0]} पर ₹${amount.toLocaleString('en-IN')} का payment link भेजने की request तैयार कर दी है।`;
  } else if (paymentContext && deniesWhatsApp) {
    response =
      'कोई बात नहीं। कृपया वह email address बताइए जिस पर payment link भेजना है।';
  } else if (wantsPayment) {
    response = `ठीक है। ₹${amount.toLocaleString('en-IN')} का secure payment link भेजने से पहले confirm कर दूँ—क्या इसी calling number पर WhatsApp चलता है?`;
  } else if (wantsWhatsApp) {
    response =
      'ज़रूर। मैंने product details और approved brochure का WhatsApp preview तैयार कर दिया है। Live mode में यह केवल consent वाले नंबर पर भेजा जाएगा।';
  } else if (wantsAppointment) {
    response =
      'बिल्कुल। मैं उपलब्ध slots देख सकती हूँ और आपकी पसंद का समय reserve कर सकती हूँ। आप morning या evening में क्या prefer करेंगे?';
  } else if (wantsHuman) {
    response =
      'मैं एक sales specialist को warm transfer कर दूँगी और उन्हें इस बातचीत का छोटा summary भी दे दूँगी, ताकि आपको दोबारा सब न बताना पड़े।';
  } else if (/^(yes|हाँ|हां|जी|sure|okay|ok|हाँजी|ਹਾਂ)[.!\s]*$/i.test(message)) {
    response =
      input.useCase === 'commerce_sales'
        ? 'धन्यवाद। क्या आप product details पहले WhatsApp पर चाहेंगे, या मैं सीधे secure payment link तैयार करूँ?'
        : AFFIRM[activeLang];
  } else {
    response = pick(DISCOVERY[activeLang], lastAssistant, seed);
  }

  // A concrete intent was handled deterministically → answer instantly. Open
  // discovery turns stay non-fast so a connected LLM can craft a natural reply
  // when a provider key is configured (graceful fallback to the line above).
  const matched =
    asksHowAreYou ||
    asksWhatsUp ||
    Boolean(requestedThisTurn) ||
    paymentContext ||
    wantsWhatsApp ||
    wantsAppointment ||
    wantsHuman ||
    /^(yes|हाँ|हां|जी|sure|okay|ok|हाँजी|ਹਾਂ)[.!\s]*$/i.test(message);

  return {
    response,
    actions,
    extraction: {
      language:
        activeLang === 'english'
          ? 'English'
          : activeLang === 'haryanvi'
            ? 'Haryanvi'
            : activeLang === 'punjabi'
              ? 'Punjabi'
              : 'Hindi',
      intent: paymentContext
        ? 'payment'
        : wantsWhatsApp
          ? 'product_details'
          : wantsAppointment
            ? 'appointment'
            : wantsHuman
              ? 'human_transfer'
              : 'discovery',
      amount: paymentContext ? amount : null,
      timing: later ? '20:00 Asia/Kolkata' : paymentContext ? 'instant' : null,
      delivery_channel: confirmsWhatsApp
        ? 'whatsapp'
        : emailMatch
          ? 'email'
          : deniesWhatsApp
            ? 'email_requested'
            : paymentContext
              ? 'confirmation_required'
              : null,
    },
    fastPath: matched,
    latencyMs: Math.max(12, Date.now() - started),
  };
}

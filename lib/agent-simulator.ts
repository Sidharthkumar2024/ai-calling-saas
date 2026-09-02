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
  const historyText = (input.history ?? [])
    .slice(-6)
    .map((item) => item.content)
    .join(' ')
    .toLowerCase();
  const lastAssistant =
    [...(input.history ?? [])]
      .reverse()
      .find((item) => item.role === 'assistant')
      ?.content.toLowerCase() ?? '';
  const wantsEnglish = /english|अंग्रेज/.test(message);
  const wantsHindi = /hindi|हिंदी/.test(message);
  const wantsHaryanvi =
    /haryanvi|हरियाणवी/.test(message) || input.language === 'haryanvi';
  const wantsWhatsApp = /whatsapp|व्हाट्सऐप|व्हाट्सएप|details|brochure/.test(
    message,
  );
  const wantsPayment = /payment|pay|पेमेंट|भुगतान|link|लिंक/.test(message);
  const priorPayment = /payment|pay|पेमेंट|भुगतान|link|लिंक/.test(historyText);
  const awaitingWhatsAppConfirmation =
    /calling number|इसी नंबर|whatsapp.*नंबर|नंबर.*whatsapp|नंबर पर/.test(
      lastAssistant,
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
    /कैसे\s*हो|कैसी\s*हो|के\s*हाल|तेरे\s*के\s*हाल|हाल[ -]?चाल|how are you|how'?re you/.test(
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
  if (asksHowAreYou && wantsHaryanvi) {
    response = 'मैं बढ़िया सूँ जी, आप सुनाओ—आपके के हाल हैं?';
  } else if (asksHowAreYou) {
    response = 'मैं बढ़िया हूँ जी, आप सुनाइए—सब ठीक चल रहा है?';
  } else if (asksWhatsUp && wantsHaryanvi) {
    response = 'बस बढ़िया जी, आपसे बात हो री सै। आप सुनाओ, आज के चाल रया सै?';
  } else if (asksWhatsUp) {
    response = 'बस बढ़िया जी, आपसे बात हो रही है। आप सुनाइए, सब ठीक?';
  } else if (wantsEnglish) {
    response =
      'Absolutely. I will continue in English. How may I help you with the product or order today?';
  } else if (wantsHaryanvi) {
    response = 'हाँ जी, बिल्कुल हरियाणवी में बात करांगे। आप आराम तै बताओ, मैं के मदद करूँ?';
  } else if (wantsHindi) {
    response =
      'बिल्कुल, हम हिंदी में बात जारी रखेंगे। बताइए मैं प्रोडक्ट या ऑर्डर में आपकी क्या मदद कर सकती हूँ?';
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
  } else if (/yes|हाँ|जी|sure|okay|ok/.test(message)) {
    response =
      input.useCase === 'commerce_sales'
        ? 'धन्यवाद। क्या आप product details पहले WhatsApp पर चाहेंगे, या मैं सीधे secure payment link तैयार करूँ?'
        : 'बहुत अच्छा। आपकी जरूरत समझने के लिए मैं दो छोटे सवाल पूछूँगी—आपकी प्राथमिकता क्या है और निर्णय कब तक लेना चाहते हैं?';
  } else {
    response = 'जी, मैं सुन रही हूँ। आप आराम से बताइए—आज किस चीज़ में मदद चाहिए?';
  }

  return {
    response,
    actions,
    extraction: {
      language: wantsEnglish
        ? 'English'
        : wantsHaryanvi
          ? 'Haryanvi'
          : wantsHindi
            ? 'Hindi'
            : input.language,
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
    fastPath:
      wantsEnglish ||
      wantsHindi ||
      wantsHaryanvi ||
      wantsWhatsApp ||
      paymentContext ||
      wantsAppointment ||
      wantsHuman ||
      asksWhatsUp ||
      asksHowAreYou ||
      /^(yes|हाँ|हां|जी|sure|okay|ok)[.!\s]*$/i.test(message),
    latencyMs: Math.max(12, Date.now() - started),
  };
}

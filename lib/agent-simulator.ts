export type SimulatedAction = {
  type: 'send_whatsapp' | 'create_payment_link' | 'schedule_follow_up' | 'book_appointment' | 'transfer_human';
  label: string;
  status: 'preview';
  payload?: Record<string, string | number>;
};

export function simulateAgentTurn(input: {
  message: string;
  useCase: string;
  language: string;
  businessName: string;
}) {
  const raw = input.message.trim();
  const message = raw.toLowerCase();
  const wantsEnglish = /english|अंग्रेज/.test(message);
  const wantsHindi = /hindi|हिंदी/.test(message);
  const wantsHaryanvi = /haryanvi|हरियाणवी/.test(message) || input.language === 'haryanvi';
  const wantsWhatsApp = /whatsapp|व्हाट्सऐप|व्हाट्सएप|details|brochure/.test(message);
  const wantsPayment = /payment|pay|पेमेंट|भुगतान|link|लिंक/.test(message);
  const wantsAppointment = /appointment|meeting|site visit|slot|अपॉइंटमेंट|मुलाकात/.test(message);
  const wantsHuman = /human|person|manager|sales guy|executive|इंसान|मैनेजर/.test(message);
  const later = /8\s*(pm|p\.m\.|बजे)|eight\s*(pm|o'clock)|later|बाद में/.test(message);
  const amountMatch = raw.match(/(?:₹|rs\.?|inr|रुपये?)?\s*(\d{2,7}(?:,\d{3})*)/i);
  const amount = amountMatch ? Number(amountMatch[1].replaceAll(',', '')) : 550;
  const actions: SimulatedAction[] = [];

  if (wantsWhatsApp) {
    actions.push({
      type: 'send_whatsapp',
      label: 'Preview WhatsApp product details',
      status: 'preview',
      payload: { template: 'vaani_product_details' },
    });
  }
  if (wantsPayment) {
    actions.push({
      type: 'create_payment_link',
      label: `Create ₹${amount.toLocaleString('en-IN')} payment link`,
      status: 'preview',
      payload: { amount, provider: 'Razorpay', delivery: later ? 'scheduled' : 'instant' },
    });
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
  if (wantsEnglish) {
    response = 'Absolutely. I will continue in English. How may I help you with the product or order today?';
  } else if (wantsHaryanvi) {
    response = 'हाँ जी, बिल्कुल हरियाणवी में बात करांगे। बताओ, प्रोडक्ट की जानकारी चाहिए, WhatsApp पे details भेजूं या payment link तैयार करूं?';
  } else if (wantsHindi) {
    response = 'बिल्कुल, हम हिंदी में बात जारी रखेंगे। बताइए मैं प्रोडक्ट या ऑर्डर में आपकी क्या मदद कर सकती हूँ?';
  } else if (wantsPayment && later) {
    response = `ज़रूर। मैंने ₹${amount.toLocaleString('en-IN')} का सुरक्षित payment link रात 8 बजे WhatsApp पर भेजने के लिए तैयार कर दिया है। Live mode में भेजने से पहले आपका consent और नंबर दोबारा confirm होगा।`;
  } else if (wantsPayment) {
    response = `ठीक है। ₹${amount.toLocaleString('en-IN')} का secure payment link अभी WhatsApp पर भेजने के लिए तैयार है। क्या मैं इसी नंबर पर भेज दूँ?`;
  } else if (wantsWhatsApp) {
    response = 'ज़रूर। मैंने product details और approved brochure का WhatsApp preview तैयार कर दिया है। Live mode में यह केवल consent वाले नंबर पर भेजा जाएगा।';
  } else if (wantsAppointment) {
    response = 'बिल्कुल। मैं उपलब्ध slots देख सकती हूँ और आपकी पसंद का समय reserve कर सकती हूँ। आप morning या evening में क्या prefer करेंगे?';
  } else if (wantsHuman) {
    response = 'मैं एक sales specialist को warm transfer कर दूँगी और उन्हें इस बातचीत का छोटा summary भी दे दूँगी, ताकि आपको दोबारा सब न बताना पड़े।';
  } else if (/yes|हाँ|जी|sure|okay|ok/.test(message)) {
    response = input.useCase === 'commerce_sales'
      ? 'धन्यवाद। क्या आप product details पहले WhatsApp पर चाहेंगे, या मैं सीधे secure payment link तैयार करूँ?'
      : 'बहुत अच्छा। आपकी जरूरत समझने के लिए मैं दो छोटे सवाल पूछूँगी—आपकी प्राथमिकता क्या है और निर्णय कब तक लेना चाहते हैं?';
  } else {
    response = `समझ गई। मैं ${input.businessName} की ओर से मदद कर रही हूँ। आप details, WhatsApp follow-up, appointment या payment link—इनमें से क्या चाहेंगे?`;
  }

  return {
    response,
    actions,
    extraction: {
      language: wantsEnglish ? 'English' : wantsHaryanvi ? 'Haryanvi' : wantsHindi ? 'Hindi' : input.language,
      intent: wantsPayment ? 'payment' : wantsWhatsApp ? 'product_details' : wantsAppointment ? 'appointment' : wantsHuman ? 'human_transfer' : 'discovery',
      amount: wantsPayment ? amount : null,
      timing: later ? '20:00 Asia/Kolkata' : wantsPayment ? 'instant' : null,
    },
    latencyMs: 420 + Math.floor(Math.random() * 180),
  };
}

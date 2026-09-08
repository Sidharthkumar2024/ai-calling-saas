// Illustrative workflows, not live sessions, customer results or endorsements.
export const WORKFORCE_DEMOS = [
  {
    id: 'admissions',
    title: 'AI Admissions Officer',
    hindi: 'AI एडमिशन ऑफिसर',
    description:
      'Turn a course enquiry into a prepared counselling conversation, with the right details ready for your admissions team.',
    descriptionHi:
      'कोर्स की पूछताछ से काउंसलिंग तक—एडमिशन टीम को सही जानकारी और अगला कदम दें।',
    caller: 'Student enquiry',
    agent: 'Aarya · Admissions',
    dialogue: [
      'Hi, I’d like to know about your design programme.',
      'Of course. Which course and intake are you considering?',
      'The July intake. Could I speak to a counsellor?',
      'I’ll prepare your enquiry and request a counselling slot.',
    ],
    dialogueHi: [
      'मुझे डिज़ाइन कोर्स की जानकारी चाहिए।',
      'ज़रूर। आप कौन सा कोर्स और बैच देख रहे हैं?',
      'जुलाई वाला। क्या काउंसलर से बात हो सकती है?',
      'मैं आपकी जानकारी और काउंसलिंग की रिक्वेस्ट तैयार करती हूँ।',
    ],
    steps: [
      'Capture the enquiry',
      'Understand course & intake',
      'Prepare the CRM record',
      'Draft a counselling follow-up',
      'Queue for the admissions team',
    ],
    stepsHi: [
      'पूछताछ दर्ज करें',
      'कोर्स और बैच समझें',
      'CRM रिकॉर्ड तैयार करें',
      'काउंसलिंग फॉलो-अप बनाएँ',
      'एडमिशन टीम को सौंपें',
    ],
  },
  {
    id: 'reception',
    title: 'AI Receptionist',
    hindi: 'AI रिसेप्शनिस्ट',
    description:
      'Welcome callers, answer from your business knowledge and route booking requests or urgent conversations to the right person.',
    descriptionHi:
      'कॉलर का स्वागत करें, बिज़नेस की जानकारी से जवाब दें और बुकिंग या ज़रूरी कॉल सही व्यक्ति तक पहुँचाएँ।',
    caller: 'Appointment enquiry',
    agent: 'Sara · Reception',
    dialogue: [
      'Are you open tomorrow? I’d like an appointment.',
      'Yes. What time would work for you?',
      'Around three. It’s my first visit.',
      'I’ll share your preferred time with the reception team.',
    ],
    dialogueHi: [
      'क्या आप कल खुले हैं? अपॉइंटमेंट चाहिए।',
      'जी। आपको कौन सा समय ठीक लगेगा?',
      'तीन बजे के आसपास। यह मेरी पहली विज़िट है।',
      'मैं आपकी पसंद का समय रिसेप्शन टीम तक पहुँचाती हूँ।',
    ],
    steps: [
      'Welcome the caller',
      'Answer from approved knowledge',
      'Capture appointment preferences',
      'Request a calendar slot',
      'Share context with reception',
    ],
    stepsHi: [
      'कॉलर का स्वागत',
      'स्वीकृत जानकारी से जवाब',
      'अपॉइंटमेंट की पसंद दर्ज',
      'कैलेंडर स्लॉट की रिक्वेस्ट',
      'रिसेप्शन को जानकारी दें',
    ],
  },
  {
    id: 'support',
    title: 'AI Customer Ops',
    hindi: 'AI कस्टमर ऑप्स',
    description:
      'Keep the conversation connected across calls, support tickets and WhatsApp, without making the customer start again.',
    descriptionHi:
      'कॉल, सपोर्ट टिकट और WhatsApp में बातचीत का संदर्भ बनाए रखें—ग्राहक को दोबारा सब न बताना पड़े।',
    caller: 'Order support',
    agent: 'Mira · Customer care',
    dialogue: [
      'I need help with a delivery.',
      'I can help. Could you share your order reference?',
      'It’s order 2048. The address needs a correction.',
      'I’ll prepare the change for your support team to review.',
    ],
    dialogueHi: [
      'मुझे डिलीवरी में मदद चाहिए।',
      'ज़रूर। आपका ऑर्डर नंबर क्या है?',
      '2048। पता सही करना है।',
      'मैं बदलाव तैयार करके सपोर्ट टीम को समीक्षा के लिए भेजती हूँ।',
    ],
    steps: [
      'Identify the support request',
      'Collect the order reference',
      'Prepare a support ticket',
      'Draft the requested change',
      'Hand over with the transcript',
    ],
    stepsHi: [
      'सपोर्ट अनुरोध समझें',
      'ऑर्डर नंबर लें',
      'सपोर्ट टिकट तैयार करें',
      'बदलाव का ड्राफ़्ट बनाएँ',
      'ट्रांसक्रिप्ट के साथ हैंडऑफ़',
    ],
  },
  {
    id: 'finance',
    title: 'AI Finance Assistant',
    hindi: 'AI फ़ाइनेंस असिस्टेंट',
    description:
      'Handle payment-link requests and reminders with approval controls. Your payment provider confirms every transaction.',
    descriptionHi:
      'अप्रूवल के साथ पेमेंट लिंक और रिमाइंडर सँभालें। भुगतान की पुष्टि आपका पेमेंट प्रोवाइडर ही करता है।',
    caller: 'Invoice enquiry',
    agent: 'Nia · Payment support',
    dialogue: [
      'Could you send me the link for my invoice?',
      'Certainly. Please share your invoice reference.',
      'INV-104. Please send it to my WhatsApp.',
      'I’ll prepare the link request. No payment is taken on this call.',
    ],
    dialogueHi: [
      'मेरे इनवॉइस का पेमेंट लिंक मिलेगा?',
      'ज़रूर। इनवॉइस नंबर बताइए।',
      'INV-104। मेरे WhatsApp पर भेजिए।',
      'मैं लिंक की रिक्वेस्ट तैयार करती हूँ। इस कॉल पर भुगतान नहीं लिया जाएगा।',
    ],
    steps: [
      'Capture the invoice reference',
      'Confirm the requested channel',
      'Prepare a payment-link request',
      'Wait for required approval',
      'Let the provider confirm payment',
    ],
    stepsHi: [
      'इनवॉइस नंबर दर्ज करें',
      'चैनल की पुष्टि करें',
      'पेमेंट लिंक की रिक्वेस्ट',
      'ज़रूरी अप्रूवल की प्रतीक्षा',
      'प्रोवाइडर से भुगतान की पुष्टि',
    ],
  },
  {
    id: 'hiring',
    title: 'AI Hiring Assistant',
    hindi: 'AI हायरिंग असिस्टेंट',
    description:
      'Collect candidate preferences and interview availability. Recruiters stay in charge of screening and hiring decisions.',
    descriptionHi:
      'उम्मीदवार की पसंद और इंटरव्यू का समय लें। स्क्रीनिंग और भर्ती के निर्णय रिक्रूटर के नियंत्रण में रहें।',
    caller: 'Candidate follow-up',
    agent: 'Ira · Recruitment',
    dialogue: [
      'I applied for the customer success role.',
      'Thank you. Are you available for an introductory interview?',
      'Thursday afternoon works for me.',
      'I’ll share that with the recruiter along with your application context.',
    ],
    dialogueHi: [
      'मैंने कस्टमर सक्सेस रोल में अप्लाई किया था।',
      'धन्यवाद। शुरुआती इंटरव्यू के लिए कब उपलब्ध हैं?',
      'गुरुवार दोपहर ठीक है।',
      'मैं आवेदन की जानकारी के साथ यह समय रिक्रूटर को बताती हूँ।',
    ],
    steps: [
      'Recognise candidate intent',
      'Capture role & preferences',
      'Collect interview availability',
      'Prepare a recruiter summary',
      'Queue the scheduling request',
    ],
    stepsHi: [
      'उम्मीदवार का इरादा समझें',
      'रोल और पसंद दर्ज करें',
      'इंटरव्यू का समय लें',
      'रिक्रूटर के लिए सारांश',
      'शेड्यूलिंग की रिक्वेस्ट',
    ],
  },
] as const;

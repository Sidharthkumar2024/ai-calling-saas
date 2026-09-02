export type VaaniVoice = {
  id: string;
  publicName: string;
  language: string;
  languageLabel: string;
  country: string;
  countryLabel: string;
  style:
    | 'friendly'
    | 'consultative'
    | 'supportive'
    | 'energetic'
    | 'calm'
    | 'seasonal';
  presentation: 'feminine' | 'masculine' | 'neutral';
  bestFor: string[];
  previewText: string;
};

export const VAANI_VOICES: VaaniVoice[] = [
  {
    id: 'vaani_tara_in_hi',
    publicName: 'Vaani Tara',
    language: 'hi-IN',
    languageLabel: 'Hindi / Hinglish',
    country: 'IN',
    countryLabel: 'India',
    style: 'friendly',
    presentation: 'feminine',
    bestFor: ['Sales', 'Appointments', 'Commerce'],
    previewText: 'नमस्ते, मैं तारा बोल रही हूँ। बताइए मैं आपकी क्या मदद कर सकती हूँ?',
  },
  {
    id: 'vaani_kabir_in_en',
    publicName: 'Vaani Kabir',
    language: 'en-IN',
    languageLabel: 'Indian English',
    country: 'IN',
    countryLabel: 'India',
    style: 'consultative',
    presentation: 'masculine',
    bestFor: ['B2B', 'SaaS demos', 'Advisory'],
    previewText:
      'Hello, this is Kabir. I will keep this quick and focus on what you need.',
  },
  {
    id: 'vaani_meera_in_hi',
    publicName: 'Vaani Meera',
    language: 'hi-IN',
    languageLabel: 'Hindi / Hinglish',
    country: 'IN',
    countryLabel: 'India',
    style: 'supportive',
    presentation: 'feminine',
    bestFor: ['Support', 'Education', 'Healthcare'],
    previewText: 'नमस्ते, मैं मीरा हूँ। आप आराम से बताइए, मैं पूरी बात समझकर मदद करूँगी।',
  },
  {
    id: 'vaani_arjun_in_hi',
    publicName: 'Vaani Arjun',
    language: 'hi-IN',
    languageLabel: 'Hindi',
    country: 'IN',
    countryLabel: 'India',
    style: 'calm',
    presentation: 'masculine',
    bestFor: ['Collections', 'Verification', 'Support'],
    previewText:
      'नमस्ते, मैं अर्जुन बोल रहा हूँ। आपकी सुविधा के अनुसार हम संक्षेप में बात करेंगे।',
  },
  {
    id: 'vaani_riya_in_en',
    publicName: 'Vaani Riya',
    language: 'en-IN',
    languageLabel: 'Indian English',
    country: 'IN',
    countryLabel: 'India',
    style: 'energetic',
    presentation: 'feminine',
    bestFor: ['Lead qualification', 'Retail', 'Events'],
    previewText:
      'Hi, this is Riya. I am excited to understand what you are looking for today.',
  },
  {
    id: 'vaani_veer_in_hry',
    publicName: 'Vaani Veer',
    language: 'haryanvi',
    languageLabel: 'Haryanvi',
    country: 'IN-HR',
    countryLabel: 'India · Haryana',
    style: 'friendly',
    presentation: 'masculine',
    bestFor: ['Local sales', 'Rural commerce', 'Follow-up'],
    previewText: 'राम राम जी, मैं वीर बोलूँ सूँ। बताओ, थारी के मदद करूँ?',
  },
  {
    id: 'vaani_ananya_in_bn',
    publicName: 'Vaani Ananya',
    language: 'bn-IN',
    languageLabel: 'Bengali',
    country: 'IN-WB',
    countryLabel: 'India · West Bengal',
    style: 'supportive',
    presentation: 'feminine',
    bestFor: ['Support', 'Education', 'Commerce'],
    previewText: 'নমস্কার, আমি অনন্যা বলছি। বলুন, আমি কীভাবে সাহায্য করতে পারি?',
  },
  {
    id: 'vaani_kavin_in_ta',
    publicName: 'Vaani Kavin',
    language: 'ta-IN',
    languageLabel: 'Tamil',
    country: 'IN-TN',
    countryLabel: 'India · Tamil Nadu',
    style: 'consultative',
    presentation: 'masculine',
    bestFor: ['Sales', 'Advisory', 'Appointments'],
    previewText: 'வணக்கம், நான் கவின் பேசுகிறேன். உங்களுக்கு எப்படி உதவலாம்?',
  },
  {
    id: 'vaani_noor_gulf_en',
    publicName: 'Vaani Noor',
    language: 'en-AE',
    languageLabel: 'Gulf English',
    country: 'AE',
    countryLabel: 'United Arab Emirates',
    style: 'calm',
    presentation: 'feminine',
    bestFor: ['Real estate', 'Hospitality', 'Support'],
    previewText:
      'Hello, this is Noor. I am here to make the next step simple for you.',
  },
  {
    id: 'vaani_utsav_in_hi',
    publicName: 'Vaani Utsav',
    language: 'hi-IN',
    languageLabel: 'Hindi / Hinglish',
    country: 'IN',
    countryLabel: 'India',
    style: 'seasonal',
    presentation: 'neutral',
    bestFor: ['Festive campaigns', 'Offers', 'Reactivation'],
    previewText: 'नमस्ते! आपके लिए एक खास festive offer है—क्या मैं तीस सेकंड में बता दूँ?',
  },
];

export function voiceFilters() {
  return {
    countries: Array.from(
      new Map(
        VAANI_VOICES.map((voice) => [voice.country, voice.countryLabel]),
      ).entries(),
    ).map(([value, label]) => ({ value, label })),
    languages: Array.from(
      new Map(
        VAANI_VOICES.map((voice) => [voice.language, voice.languageLabel]),
      ).entries(),
    ).map(([value, label]) => ({ value, label })),
    styles: Array.from(new Set(VAANI_VOICES.map((voice) => voice.style))),
  };
}

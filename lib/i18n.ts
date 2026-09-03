/**
 * Portal localisation.
 *
 * The AI speaks thirteen languages; the dashboard spoke only English. This is
 * the translation layer for the portal chrome — navigation, section headers,
 * shared actions and empty states — which is what a user reads on every screen.
 *
 * A missing key falls back to English rather than rendering a raw key, and
 * `missingKeys()` reports the gap honestly instead of hiding it.
 */

export const PORTAL_LOCALES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
] as const;

export type PortalLocale = (typeof PORTAL_LOCALES)[number]['code'];
export const DEFAULT_LOCALE: PortalLocale = 'en';

export function isPortalLocale(value: unknown): value is PortalLocale {
  return PORTAL_LOCALES.some((locale) => locale.code === value);
}

/** English is the source of truth: every key exists here. */
const en = {
  // Navigation groups
  'nav.group.workspace': 'Workspace',
  'nav.group.build': 'Build',
  'nav.group.operate': 'Operate',
  'nav.group.grow': 'Grow',
  'nav.group.manage': 'Manage',

  // Navigation items
  'nav.overview': 'Overview',
  'nav.crm': 'Advanced CRM',
  'nav.agents': 'AI agents',
  'nav.voice_profiles': 'Voice profiles',
  'nav.graph_agents': 'Graph agents',
  'nav.workflows': 'Workflows',
  'nav.knowledge': 'Knowledge base',
  'nav.campaigns': 'Campaigns',
  'nav.numbers': 'My numbers',
  'nav.sip_trunks': 'SIP trunks',
  'nav.call_history': 'Call history',
  'nav.live_monitor': 'Live monitoring',
  'nav.analytics': 'Analytics',
  'nav.quality': 'AI quality assurance',
  'nav.alerts': 'Alerts',
  'nav.reports': 'Reports',
  'nav.lead_capture': 'Lead capture',
  'nav.retargeting': 'Retargeting',
  'nav.commerce': 'AI commerce',
  'nav.integrations': 'Integrations & API',
  'nav.billing': 'Billing & credits',
  'nav.team': 'Team',
  'nav.org_structure': 'Org & routing',
  'nav.agent_desk': 'Agent desk',
  'nav.dialer': 'Dialer',
  'nav.diagnostics': 'Device & diagnostics',
  'nav.wallboard': 'Supervisor wallboard',
  'nav.approvals': 'Approvals & handoff',
  'nav.tickets': 'Support tickets',
  'nav.settings': 'Settings',

  // Shell
  'shell.credits': 'credits',
  'shell.signOut': 'Sign out',
  'shell.language': 'Language',
  'shell.searchPlaceholder': 'Search…',

  // Shared states
  'state.loading': 'Loading…',
  'state.error': 'Something went wrong.',
  'state.retry': 'Try again',
  'state.empty': 'Nothing here yet.',
  'state.notMeasured': 'not measured',
  'state.saving': 'Saving…',
  'state.saved': 'Saved.',

  // Shared actions
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.delete': 'Delete',
  'action.add': 'Add',
  'action.refresh': 'Refresh',
  'action.connect': 'Connect',
  'action.disconnect': 'Disconnect',
  'action.test': 'Test',
} as const;

export type TranslationKey = keyof typeof en;

/**
 * Hindi. Product nouns that Indian users say in English on the phone —
 * "campaign", "credits", "CRM" — are deliberately left as-is rather than
 * translated into words nobody uses.
 */
const hi: Partial<Record<TranslationKey, string>> = {
  'nav.group.workspace': 'वर्कस्पेस',
  'nav.group.build': 'बनाएँ',
  'nav.group.operate': 'संचालन',
  'nav.group.grow': 'बढ़ाएँ',
  'nav.group.manage': 'प्रबंधन',

  'nav.overview': 'अवलोकन',
  'nav.crm': 'एडवांस्ड CRM',
  'nav.agents': 'AI एजेंट',
  'nav.voice_profiles': 'आवाज़ प्रोफ़ाइल',
  'nav.graph_agents': 'ग्राफ़ एजेंट',
  'nav.workflows': 'वर्कफ़्लो',
  'nav.knowledge': 'नॉलेज बेस',
  'nav.campaigns': 'कैंपेन',
  'nav.numbers': 'मेरे नंबर',
  'nav.sip_trunks': 'SIP ट्रंक',
  'nav.call_history': 'कॉल इतिहास',
  'nav.live_monitor': 'लाइव निगरानी',
  'nav.analytics': 'एनालिटिक्स',
  'nav.quality': 'AI गुणवत्ता जाँच',
  'nav.alerts': 'अलर्ट',
  'nav.reports': 'रिपोर्ट',
  'nav.lead_capture': 'लीड कैप्चर',
  'nav.retargeting': 'रीटार्गेटिंग',
  'nav.commerce': 'AI कॉमर्स',
  'nav.integrations': 'इंटीग्रेशन और API',
  'nav.billing': 'बिलिंग और क्रेडिट',
  'nav.team': 'टीम',
  'nav.org_structure': 'संगठन और रूटिंग',
  'nav.agent_desk': 'एजेंट डेस्क',
  'nav.dialer': 'डायलर',
  'nav.diagnostics': 'डिवाइस और जाँच',
  'nav.wallboard': 'सुपरवाइज़र बोर्ड',
  'nav.approvals': 'अनुमति और हैंडऑफ़',
  'nav.tickets': 'सपोर्ट टिकट',
  'nav.settings': 'सेटिंग्स',

  'shell.credits': 'क्रेडिट',
  'shell.signOut': 'साइन आउट',
  'shell.language': 'भाषा',
  'shell.searchPlaceholder': 'खोजें…',

  'state.loading': 'लोड हो रहा है…',
  'state.error': 'कुछ गड़बड़ हो गई।',
  'state.retry': 'दोबारा कोशिश करें',
  'state.empty': 'अभी यहाँ कुछ नहीं है।',
  'state.notMeasured': 'मापा नहीं गया',
  'state.saving': 'सहेजा जा रहा है…',
  'state.saved': 'सहेज दिया गया।',

  'action.save': 'सहेजें',
  'action.cancel': 'रद्द करें',
  'action.close': 'बंद करें',
  'action.delete': 'हटाएँ',
  'action.add': 'जोड़ें',
  'action.refresh': 'ताज़ा करें',
  'action.connect': 'कनेक्ट करें',
  'action.disconnect': 'डिस्कनेक्ट करें',
  'action.test': 'जाँचें',
};

const CATALOGS: Record<PortalLocale, Partial<Record<TranslationKey, string>>> = {
  en,
  hi,
};

export function translate(locale: PortalLocale, key: TranslationKey) {
  return CATALOGS[locale]?.[key] ?? en[key] ?? key;
}

/** Which keys a locale has not translated yet. Coverage is reported, not hidden. */
export function missingKeys(locale: PortalLocale): TranslationKey[] {
  const catalog = CATALOGS[locale] ?? {};
  return (Object.keys(en) as TranslationKey[]).filter((key) => !catalog[key]);
}

export function coverage(locale: PortalLocale) {
  const total = Object.keys(en).length;
  const missing = missingKeys(locale).length;
  return {
    locale,
    total,
    translated: total - missing,
    percent: Math.round(((total - missing) / total) * 100),
  };
}

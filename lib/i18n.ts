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

  // Settings screen copy
  'settings.recording.consent': 'Record with consent',
  'settings.recording.disabled': 'Do not record',
  'settings.recording.always': 'Always record where lawful',
  'settings.languages.title': 'Languages the agents in this workspace may speak',
  'settings.languages.hint': 'The default language is always included.',
  'settings.languages.defaultSuffix': 'default',
  'settings.redact': 'Redact sensitive data in transcripts and analytics',
  'settings.saveButton': 'Save settings',
  'settings.compliance.title': 'Compliance ledger',
  'settings.compliance.hint': 'Tenant-scoped evidence used by the call gate',

  // Panel titles, hints and placeholders
  'panel.branches.title': 'Branches and teams',
  'panel.branches.hint': 'Group agents by office and function so routing and reporting can follow the real organisation.',
  'panel.branches.namePlaceholder': 'Branch name',
  'panel.branches.cityPlaceholder': 'City',
  'panel.branches.teamPlaceholder': 'Team name',
  'panel.shifts.title': 'Working hours',
  'panel.shifts.hint': 'Routing skips an agent outside their shift or on a break, even if they left themselves marked online.',
  'panel.shifts.breakStart': 'Break start',
  'panel.shifts.breakEnd': 'Break end',
  'panel.numberRoutes.title': 'Number routing',
  'panel.numberRoutes.hint': 'Each number can reach a different voice agent or queue. Without a route, a number is only a free-text label.',
  'panel.contacts.title': 'Contacts',
  'panel.contacts.hint': 'A person can exist here without being a sales lead — support callers, past customers, anyone you may call back.',
  'panel.contacts.namePlaceholder': 'Full name',
  'panel.contacts.languagePlaceholder': 'Preferred language…',

  // Form fields, stat labels and accessible names
  'field.aiAgent': 'AI agent',
  'field.activeConsent': 'Active consent records',
  'field.agent': 'Agent',
  'field.authentication': 'Authentication',
  'field.averageQa': 'Average QA',
  'field.avgDuration': 'Avg duration',
  'field.avgLatency': 'Avg latency',
  'field.callingNumber': 'Calling number',
  'field.calls': 'Calls',
  'field.campaignName': 'Campaign name',
  'field.codecs': 'Codecs',
  'field.concurrency': 'Concurrency',
  'field.contacts': 'Contacts · one E.164 number per line',
  'field.defaultLanguage': 'Default conversation language',
  'field.gatewayUri': 'Gateway URI',
  'field.intent': 'Intent',
  'field.kycDocuments': 'KYC documents',
  'field.knowledge': 'Knowledge',
  'field.latency': 'Latency',
  'field.leadsCreated': 'Leads created',
  'field.callingWindow': 'Legal calling window',
  'field.live': 'Live',
  'field.maxAttempts': 'Maximum attempts',
  'field.mediaEncryption': 'Media encryption',
  'field.natural': 'Natural',
  'field.objective': 'Objective',
  'field.openFindings': 'Open findings',
  'field.orderedSteps': 'Ordered steps',
  'field.outcome': 'Outcome',
  'field.overall': 'Overall',
  'field.password': 'Password',
  'field.policy': 'Policy',
  'field.provider': 'Provider',
  'field.qaSampleRate': 'QA sample rate (%)',
  'field.queues': 'Queues',
  'field.recordingPolicy': 'Recording policy',
  'field.recordingRetention': 'Recording retention (days)',
  'field.recordings': 'Recordings',
  'field.resolution': 'Resolution',
  'field.retryAfter': 'Retry after minutes',
  'field.reviewedCalls': 'Reviewed calls',
  'field.sentiment': 'Sentiment',
  'field.suppressedContacts': 'Suppressed contacts',
  'field.talkMinutes': 'Talk minutes',
  'field.timezone': 'Timezone',
  'field.totalCalls': 'Total calls',
  'field.transcriptRetention': 'Transcript retention (days)',
  'field.transferred': 'Transferred',
  'field.transport': 'Transport',
  'field.trigger': 'Trigger',
  'field.trunkName': 'Trunk name',
  'field.username': 'Username',
  'field.voiceAgents': 'Voice agents',
  'field.workflowPublished': 'Workflow + published version',
  'field.workflowName': 'Workflow name',
  'field.workflowVersion': 'Workflow version',
  'aria.closeCallDetail': 'Close call detail',
  'aria.deleteBranch': 'Delete branch',
  'aria.deleteRoute': 'Delete route',
  'aria.deleteShift': 'Delete shift',
  'state.noLiveCalls': 'No calls are active right now.',

  // Section headings — eyebrow, title and description per screen
  'screen.campaigns.eyebrow': 'Outbound execution',
  'screen.campaigns.title': 'Campaigns',
  'screen.campaigns.description':
    'Audience, consent, retry policy, calling windows and conversion outcomes.',
  'screen.campaigns.button': 'New campaign',
  'screen.sip_trunks.eyebrow': 'Custom telephony',
  'screen.sip_trunks.title': 'SIP trunks',
  'screen.sip_trunks.description':
    'Bring your own telephony with TLS, media encryption, codec checks and test-gated activation.',
  'screen.sip_trunks.button': 'Register trunk',
  'screen.knowledge.eyebrow': 'Grounded answers',
  'screen.knowledge.title': 'Knowledge bases',
  'screen.knowledge.description':
    'Product facts, FAQs and objection handling used during conversations and QA.',
  'screen.knowledge.button': 'New knowledge base',
  'screen.workflows.eyebrow': 'Durable automation',
  'screen.workflows.title': 'Workflows',
  'screen.workflows.description':
    'Trigger approved CRM, WhatsApp, payment, calendar and retargeting actions from call outcomes.',
  'screen.workflows.button': 'New workflow',
  'screen.graph_agents.eyebrow': 'Conversation orchestration',
  'screen.graph_agents.title': 'Graph agents',
  'screen.graph_agents.description':
    'Branching conversation nodes, tool execution, guardrails and warm transfer routes.',
  'screen.graph_agents.button': 'New graph',
  'screen.alerts.eyebrow': 'Operational guardrails',
  'screen.alerts.title': 'Alerts',
  'screen.alerts.description':
    'Watch failure rate, latency, QA score and balance thresholds through email and signed webhooks.',
  'screen.alerts.button': 'New alert',
  'screen.reports.eyebrow': 'Scheduled intelligence',
  'screen.reports.title': 'Reports',
  'screen.reports.description':
    'Reusable call, campaign, QA and revenue reports with saved filters and schedules.',
  'screen.reports.button': 'New report',
  'screen.call_history.eyebrow': 'Conversation system of record',
  'screen.call_history.title': 'Call history & recordings',
  'screen.call_history.description':
    'Tenant-scoped recordings, transcripts, summaries, costs, outcomes and disconnect reasons.',
  'screen.live_monitor.eyebrow': 'Realtime operations',
  'screen.live_monitor.title': 'Live monitoring',
  'screen.live_monitor.description':
    'Observe active calls, latency, sentiment and escalation signals without exposing other tenants.',
  'screen.analytics.eyebrow': 'Performance intelligence',
  'screen.analytics.title': 'Analytics',
  'screen.analytics.description':
    'Call, outcome, latency, language and conversion metrics aggregated across the whole window.',
  'screen.quality.eyebrow': 'AI quality assurance',
  'screen.quality.title': 'QA scorecards',
  'screen.quality.description':
    'Resolution, knowledge accuracy, naturalness, policy compliance, hallucination and overlap checks.',
  'screen.settings.eyebrow': 'Workspace controls',
  'screen.settings.title': 'Settings & compliance',
  'screen.settings.description':
    'Languages, consent evidence, recording retention, suppression and sensitive-data redaction.',
  'screen.dialer.eyebrow': 'Agent workstation',
  'screen.dialer.title': 'Dialer',
  'screen.dialer.description':
    'Talk to your AI agent from this tab. Your microphone is the call audio.',
  'screen.diagnostics.eyebrow': 'Agent workstation',
  'screen.diagnostics.title': 'Device & diagnostics',
  'screen.diagnostics.description':
    'Check the microphone, speaker and connection before taking calls.',
  'screen.agent_desk.eyebrow': 'Human handoff',
  'screen.agent_desk.title': 'Agent desk',
  'screen.agent_desk.description':
    'Conversations the AI escalated to a human, with the AI summary attached.',
  'screen.wallboard.eyebrow': 'Operations',
  'screen.wallboard.title': 'Supervisor wallboard',
  'screen.wallboard.description':
    'Queues, staffing and SLA pressure across the workspace.',
  'screen.org_structure.eyebrow': 'Workspace structure',
  'screen.org_structure.title': 'Org & number routing',
  'screen.org_structure.description':
    'Branches, teams, working hours and which agent or queue each number reaches.',

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

  'settings.recording.consent': 'सहमति के साथ रिकॉर्ड करें',
  'settings.recording.disabled': 'रिकॉर्ड न करें',
  'settings.recording.always': 'जहाँ वैध हो, हमेशा रिकॉर्ड करें',
  'settings.languages.title': 'इस वर्कस्पेस के एजेंट कौन-सी भाषाएँ बोल सकते हैं',
  'settings.languages.hint': 'डिफ़ॉल्ट भाषा हमेशा शामिल रहती है।',
  'settings.languages.defaultSuffix': 'डिफ़ॉल्ट',
  'settings.redact': 'ट्रांसक्रिप्ट और एनालिटिक्स में संवेदनशील जानकारी छिपाएँ',
  'settings.saveButton': 'सेटिंग्स सहेजें',
  'settings.compliance.title': 'अनुपालन रजिस्टर',
  'settings.compliance.hint': 'कॉल गेट जिस सबूत पर चलता है, आपके ही खाते का',

  'panel.branches.title': 'शाखाएँ और टीमें',
  'panel.branches.hint': 'एजेंट्स को दफ़्तर और काम के हिसाब से बाँटिए, ताकि रूटिंग और रिपोर्ट असली संगठन के अनुसार चलें।',
  'panel.branches.namePlaceholder': 'शाखा का नाम',
  'panel.branches.cityPlaceholder': 'शहर',
  'panel.branches.teamPlaceholder': 'टीम का नाम',
  'panel.shifts.title': 'काम के घंटे',
  'panel.shifts.hint': 'शिफ़्ट के बाहर या ब्रेक पर होने पर रूटिंग उस एजेंट को छोड़ देती है — चाहे उन्होंने खुद को online छोड़ रखा हो।',
  'panel.shifts.breakStart': 'ब्रेक शुरू',
  'panel.shifts.breakEnd': 'ब्रेक ख़त्म',
  'panel.numberRoutes.title': 'नंबर रूटिंग',
  'panel.numberRoutes.hint': 'हर नंबर अलग आवाज़ एजेंट या क़तार तक जा सकता है। रूट न हो तो नंबर सिर्फ़ एक लेबल है।',
  'panel.contacts.title': 'संपर्क',
  'panel.contacts.hint': 'कोई व्यक्ति यहाँ बिना sales lead बने भी रह सकता है — सपोर्ट कॉलर, पुराने ग्राहक, कोई भी जिसे आप वापस कॉल कर सकते हैं।',
  'panel.contacts.namePlaceholder': 'पूरा नाम',
  'panel.contacts.languagePlaceholder': 'पसंदीदा भाषा…',

  'field.aiAgent': 'AI एजेंट',
  'field.activeConsent': 'मान्य सहमति रिकॉर्ड',
  'field.agent': 'एजेंट',
  'field.authentication': 'प्रमाणीकरण',
  'field.averageQa': 'औसत QA',
  'field.avgDuration': 'औसत अवधि',
  'field.avgLatency': 'औसत latency',
  'field.callingNumber': 'कॉल करने वाला नंबर',
  'field.calls': 'कॉल',
  'field.campaignName': 'कैंपेन का नाम',
  'field.codecs': 'कोडेक',
  'field.concurrency': 'एक साथ कॉल',
  'field.contacts': 'संपर्क · हर पंक्ति में एक E.164 नंबर',
  'field.defaultLanguage': 'बातचीत की डिफ़ॉल्ट भाषा',
  'field.gatewayUri': 'गेटवे URI',
  'field.intent': 'मंशा',
  'field.kycDocuments': 'KYC दस्तावेज़',
  'field.knowledge': 'जानकारी',
  'field.latency': 'Latency',
  'field.leadsCreated': 'बनी लीड',
  'field.callingWindow': 'वैध कॉल समय',
  'field.live': 'लाइव',
  'field.maxAttempts': 'अधिकतम कोशिशें',
  'field.mediaEncryption': 'मीडिया एन्क्रिप्शन',
  'field.natural': 'स्वाभाविकता',
  'field.objective': 'उद्देश्य',
  'field.openFindings': 'खुली टिप्पणियाँ',
  'field.orderedSteps': 'क्रम में चरण',
  'field.outcome': 'नतीजा',
  'field.overall': 'कुल',
  'field.password': 'पासवर्ड',
  'field.policy': 'नीति',
  'field.provider': 'प्रोवाइडर',
  'field.qaSampleRate': 'QA नमूना दर (%)',
  'field.queues': 'क़तारें',
  'field.recordingPolicy': 'रिकॉर्डिंग नीति',
  'field.recordingRetention': 'रिकॉर्डिंग कितने दिन (days)',
  'field.recordings': 'रिकॉर्डिंग',
  'field.resolution': 'समाधान',
  'field.retryAfter': 'कितने मिनट बाद दोबारा',
  'field.reviewedCalls': 'जाँची गई कॉल',
  'field.sentiment': 'भावना',
  'field.suppressedContacts': 'सप्रेस किए संपर्क',
  'field.talkMinutes': 'बातचीत के मिनट',
  'field.timezone': 'समय-क्षेत्र',
  'field.totalCalls': 'कुल कॉल',
  'field.transcriptRetention': 'ट्रांसक्रिप्ट कितने दिन (days)',
  'field.transferred': 'ट्रांसफ़र',
  'field.transport': 'ट्रांसपोर्ट',
  'field.trigger': 'ट्रिगर',
  'field.trunkName': 'ट्रंक का नाम',
  'field.username': 'यूज़रनेम',
  'field.voiceAgents': 'आवाज़ एजेंट',
  'field.workflowPublished': 'वर्कफ़्लो + प्रकाशित संस्करण',
  'field.workflowName': 'वर्कफ़्लो का नाम',
  'field.workflowVersion': 'वर्कफ़्लो संस्करण',
  'aria.closeCallDetail': 'कॉल विवरण बंद करें',
  'aria.deleteBranch': 'शाखा हटाएँ',
  'aria.deleteRoute': 'रूट हटाएँ',
  'aria.deleteShift': 'शिफ़्ट हटाएँ',
  'state.noLiveCalls': 'अभी कोई कॉल चालू नहीं है।',

  'screen.campaigns.eyebrow': 'आउटबाउंड संचालन',
  'screen.campaigns.title': 'कैंपेन',
  'screen.campaigns.description':
    'ऑडियंस, सहमति, दोबारा कोशिश की नीति, कॉल का समय और नतीजे।',
  'screen.campaigns.button': 'नया कैंपेन',
  'screen.sip_trunks.eyebrow': 'अपनी टेलीफ़ोनी',
  'screen.sip_trunks.title': 'SIP ट्रंक',
  'screen.sip_trunks.description':
    'अपनी टेलीफ़ोनी जोड़िए — TLS, मीडिया एन्क्रिप्शन, कोडेक जाँच और टेस्ट पास होने पर ही चालू।',
  'screen.sip_trunks.button': 'ट्रंक जोड़ें',
  'screen.knowledge.eyebrow': 'भरोसेमंद जवाब',
  'screen.knowledge.title': 'नॉलेज बेस',
  'screen.knowledge.description':
    'प्रोडक्ट की जानकारी, आम सवाल और आपत्तियों के जवाब — बातचीत और QA में इस्तेमाल होते हैं।',
  'screen.knowledge.button': 'नया नॉलेज बेस',
  'screen.workflows.eyebrow': 'भरोसेमंद ऑटोमेशन',
  'screen.workflows.title': 'वर्कफ़्लो',
  'screen.workflows.description':
    'कॉल के नतीजे से CRM, WhatsApp, पेमेंट, कैलेंडर और रीटार्गेटिंग की मंज़ूर कार्रवाइयाँ चलाइए।',
  'screen.workflows.button': 'नया वर्कफ़्लो',
  'screen.graph_agents.eyebrow': 'बातचीत का ढाँचा',
  'screen.graph_agents.title': 'ग्राफ़ एजेंट',
  'screen.graph_agents.description':
    'शाखाओं वाले बातचीत नोड, टूल चलाना, सुरक्षा नियम और वॉर्म ट्रांसफ़र के रास्ते।',
  'screen.graph_agents.button': 'नया ग्राफ़',
  'screen.alerts.eyebrow': 'संचालन की सुरक्षा',
  'screen.alerts.title': 'अलर्ट',
  'screen.alerts.description':
    'फ़ेल दर, latency, QA स्कोर और बैलेंस की सीमाएँ ईमेल और signed webhook से देखिए।',
  'screen.alerts.button': 'नया अलर्ट',
  'screen.reports.eyebrow': 'निर्धारित रिपोर्ट',
  'screen.reports.title': 'रिपोर्ट',
  'screen.reports.description':
    'कॉल, कैंपेन, QA और रेवेन्यू की दोबारा इस्तेमाल होने वाली रिपोर्ट, सहेजे फ़िल्टर और शेड्यूल के साथ।',
  'screen.reports.button': 'नई रिपोर्ट',
  'screen.call_history.eyebrow': 'बातचीत का पूरा रिकॉर्ड',
  'screen.call_history.title': 'कॉल इतिहास और रिकॉर्डिंग',
  'screen.call_history.description':
    'आपके ही रिकॉर्डिंग, ट्रांसक्रिप्ट, सारांश, लागत, नतीजे और कॉल कटने के कारण।',
  'screen.live_monitor.eyebrow': 'रियल-टाइम संचालन',
  'screen.live_monitor.title': 'लाइव निगरानी',
  'screen.live_monitor.description':
    'चालू कॉल, latency, भावना और एस्केलेशन के संकेत देखिए — किसी और के डेटा के बिना।',
  'screen.analytics.eyebrow': 'प्रदर्शन की समझ',
  'screen.analytics.title': 'एनालिटिक्स',
  'screen.analytics.description':
    'पूरी अवधि पर कॉल, नतीजे, latency, भाषा और कन्वर्ज़न के आँकड़े।',
  'screen.quality.eyebrow': 'AI गुणवत्ता जाँच',
  'screen.quality.title': 'QA स्कोरकार्ड',
  'screen.quality.description':
    'समाधान, जानकारी की सटीकता, स्वाभाविकता, नीति पालन, गलत जानकारी और ओवरलैप की जाँच।',
  'screen.settings.eyebrow': 'वर्कस्पेस नियंत्रण',
  'screen.settings.title': 'सेटिंग्स और अनुपालन',
  'screen.settings.description':
    'भाषाएँ, सहमति का सबूत, रिकॉर्डिंग कितने दिन रखें, सप्रेशन और संवेदनशील जानकारी छिपाना।',
  'screen.dialer.eyebrow': 'एजेंट वर्कस्टेशन',
  'screen.dialer.title': 'डायलर',
  'screen.dialer.description':
    'इसी टैब से अपने AI एजेंट से बात कीजिए। आपका माइक्रोफ़ोन ही कॉल की आवाज़ है।',
  'screen.diagnostics.eyebrow': 'एजेंट वर्कस्टेशन',
  'screen.diagnostics.title': 'डिवाइस और जाँच',
  'screen.diagnostics.description':
    'कॉल लेने से पहले माइक्रोफ़ोन, स्पीकर और कनेक्शन जाँच लीजिए।',
  'screen.agent_desk.eyebrow': 'इंसान को सौंपना',
  'screen.agent_desk.title': 'एजेंट डेस्क',
  'screen.agent_desk.description':
    'जो बातचीत AI ने इंसान को सौंपी है, AI के सारांश के साथ।',
  'screen.wallboard.eyebrow': 'संचालन',
  'screen.wallboard.title': 'सुपरवाइज़र बोर्ड',
  'screen.wallboard.description':
    'पूरे वर्कस्पेस की क़तारें, स्टाफ़ और SLA का दबाव।',
  'screen.org_structure.eyebrow': 'वर्कस्पेस का ढाँचा',
  'screen.org_structure.title': 'संगठन और नंबर रूटिंग',
  'screen.org_structure.description':
    'शाखाएँ, टीमें, काम के घंटे, और कौन-सा नंबर किस एजेंट या क़तार तक जाता है।',

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

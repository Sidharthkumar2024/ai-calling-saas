import type { LucideIcon } from 'lucide-react';
import {
  BrainCircuit,
  Gauge,
  PhoneCall,
  Radio,
  Repeat2,
  Workflow,
} from 'lucide-react';

export type VaaniEngine = {
  name: string;
  role: string;
  description: string;
  icon: LucideIcon;
};

/**
 * Public product names only. Infrastructure vendors and adapter credentials
 * belong in server-side operations, never in customer-facing bundles or UI.
 */
export const VAANI_ENGINES: VaaniEngine[] = [
  {
    name: 'Vaani Ira',
    role: 'Conversation intelligence',
    description:
      'Natural multilingual conversations that understand intent, context and business goals.',
    icon: BrainCircuit,
  },
  {
    name: 'Vaani Pulse',
    role: 'Realtime voice',
    description:
      'Low-latency turn taking, interruption handling and live call orchestration.',
    icon: Radio,
  },
  {
    name: 'Vaani Sense',
    role: 'Lead intelligence',
    description:
      'Intent, sentiment, qualification, summaries and next-best-action scoring.',
    icon: Gauge,
  },
  {
    name: 'Vaani Flow',
    role: 'Revenue automation',
    description:
      'Campaigns, callbacks, appointments, CRM updates and post-call actions.',
    icon: Workflow,
  },
  {
    name: 'Vaani Reach',
    role: 'Audience recovery',
    description:
      'Consent-aware Meta and Google retargeting loops built from real call outcomes.',
    icon: Repeat2,
  },
  {
    name: 'Vaani Connect',
    role: 'Calling network',
    description:
      'Numbers, inbound routing, outbound delivery and network health in one layer.',
    icon: PhoneCall,
  },
];

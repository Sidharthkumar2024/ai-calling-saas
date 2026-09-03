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
  /** Catalog key prefix; `.role` and `.description` hold the localised copy. */
  key: string;
  icon: LucideIcon;
};

/**
 * Public product names only. Infrastructure vendors and adapter credentials
 * belong in server-side operations, never in customer-facing bundles or UI.
 */
export const VAANI_ENGINES: VaaniEngine[] = [
  { name: 'Vaani Sara', key: 'engine.sara', icon: BrainCircuit },
  { name: 'Vaani Pulse', key: 'engine.pulse', icon: Radio },
  { name: 'Vaani Sense', key: 'engine.sense', icon: Gauge },
  { name: 'Vaani Flow', key: 'engine.flow', icon: Workflow },
  { name: 'Vaani Reach', key: 'engine.reach', icon: Repeat2 },
  { name: 'Vaani Connect', key: 'engine.connect', icon: PhoneCall },
];

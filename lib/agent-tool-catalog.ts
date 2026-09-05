/**
 * The agent tool catalogue and the rules for reading `tools_json` (§7).
 *
 * Split out of `lib/agent-tools.ts` because that module imports the D1 binding
 * and cannot be loaded in a browser bundle or under bare Node — and both need
 * this: the agent studio renders the picker from `SELECTABLE_TOOLS`, and the
 * selection rules are exactly the kind of thing that should be under test.
 *
 * Pure: names, labels and resolution only. The tool definitions and their
 * handlers stay in `lib/agent-tools.ts`.
 */

/**
 * Tools a workspace cannot switch off.
 *
 * `tools_json` used to be decorative: the picker wrote a list and the model was
 * handed all fifteen tools regardless. Making the list actually filter is
 * correct, and naively it is dangerous — these three are ordered by the system
 * prompt itself.
 *
 * `<action_safety>` tells the model to call `transfer_to_human` on the turn a
 * caller asks for a person, in any language or wording, and to call
 * `request_refund` on the turn they ask for their money back. A workspace that
 * unticked those would produce a prompt commanding a tool the model does not
 * have — the model would either hallucinate the call or, worse, tell the caller
 * it had transferred them. `end_call` is how a conversation terminates cleanly.
 *
 * So the escalation path and the exit are not configuration. Everything a
 * business genuinely chooses is in SELECTABLE_TOOLS below.
 */
export const MANDATORY_TOOL_NAMES = [
  'transfer_to_human',
  'request_refund',
  'end_call',
] as const;

/**
 * The tools a workspace chooses between, with the copy the picker shows.
 *
 * One list, shared by the agent studio and the server. The studio used to
 * hardcode its own seven entries, and three of them were not real tools:
 * `send_email` and `create_ticket` had no definition and no handler at all,
 * and `transfer_human` was a near-miss for `transfer_to_human` — so ticking
 * "Transfer to human" wrote a name that matched nothing. It never showed,
 * because nothing read the list. It would have shown the moment it did.
 */
export const SELECTABLE_TOOLS: Array<{
  name: string;
  label: string;
  note: string;
}> = [
  {
    name: 'send_whatsapp',
    label: 'Send WhatsApp',
    note: 'Approved product details and templates',
  },
  {
    name: 'send_listing_media',
    label: 'Send listing media',
    note: 'Images and brochures for published records only, subject to the send policy',
  },
  {
    name: 'request_document',
    label: 'Ask for a document',
    note: 'Send a real upload link for a PAN card, proof or signed form',
  },
  {
    name: 'create_payment_link',
    label: 'Create payment link',
    note: 'Amount, expiry and customer mapping',
  },
  {
    name: 'schedule_follow_up',
    label: 'Schedule follow-up',
    note: 'Remember "send it at 8 PM" safely',
  },
  {
    name: 'book_appointment',
    label: 'Book appointment',
    note: 'Reserve a slot the agent has checked',
  },
  {
    name: 'get_available_slots',
    label: 'Check availability',
    note: 'Read open slots before offering a time',
  },
  {
    name: 'create_callback',
    label: 'Request a callback',
    note: 'Queue the caller for a person later',
  },
  {
    name: 'lookup_customer',
    label: 'Look up the caller',
    note: 'Recognise an existing customer by number',
  },
  {
    name: 'create_lead',
    label: 'Create a lead',
    note: 'Capture a new enquiry into the CRM',
  },
  {
    name: 'search_catalog',
    label: 'Search the catalogue',
    note: 'Answer from real inventory, not from the prompt',
  },
  {
    name: 'get_catalog_item',
    label: 'Read a catalogue item',
    note: 'Full details of one product, unit or plan',
  },
  {
    name: 'check_availability',
    label: 'Check stock',
    note: 'Confirm something is available before promising it',
  },
  {
    name: 'place_order',
    label: 'Place an order',
    note: 'Create the order; delivery still waits on payment',
  },
];

/**
 * Names that were once written into `tools_json` and are not tool names.
 *
 * `transfer_human` is repaired rather than dropped: every agent in the product
 * carries it, and dropping it would read as "this workspace turned transfer
 * off" when what actually happened is that the picker had a typo.
 * `send_email` and `create_ticket` map to nothing because they never existed —
 * there is no behaviour to preserve, only a checkbox that did nothing.
 */
export const TOOL_ALIASES: Record<string, string | null> = {
  transfer_human: 'transfer_to_human',
  transfer_to_agent: 'transfer_to_human',
  send_email: null,
  create_ticket: null,
};

export type ToolSelection = {
  /** Real tool names, mandatory ones included. */
  selected: string[];
  /** Names that were corrected, for the audit trail and the studio's notice. */
  repaired: Array<{ from: string; to: string }>;
  /** Names that mean nothing and were dropped. */
  dropped: string[];
  /** True when the agent had no usable selection and got the full set. */
  defaulted: boolean;
};

/**
 * Turns a stored `tools_json` into the tools an agent may actually call.
 *
 * **An empty selection means every selectable tool, not none.** The column
 * defaults to `'[]'`, so "nobody has opened the picker" and "somebody
 * deselected everything" are the same value in the database, and only one of
 * those is plausible: an agent with no business tools cannot do anything a
 * voice agent is for. Reading empty as none would quietly lobotomise every
 * agent still on the default the moment this filter went live.
 */
export function resolveToolSelection(raw: unknown): ToolSelection {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = null;
    }
  }
  const mandatory = [...MANDATORY_TOOL_NAMES];
  const selectable = new Set(SELECTABLE_TOOLS.map((tool) => tool.name));
  if (!Array.isArray(list) || list.length === 0)
    return {
      selected: [...selectable, ...mandatory],
      repaired: [],
      dropped: [],
      defaulted: true,
    };

  const repaired: Array<{ from: string; to: string }> = [];
  const dropped: string[] = [];
  const chosen = new Set<string>();
  for (const entry of list) {
    const name = typeof entry === 'string' ? entry.trim() : '';
    if (!name) continue;
    if (
      selectable.has(name) ||
      (MANDATORY_TOOL_NAMES as readonly string[]).includes(name)
    ) {
      chosen.add(name);
      continue;
    }
    if (name in TOOL_ALIASES) {
      const target = TOOL_ALIASES[name];
      if (target) {
        chosen.add(target);
        repaired.push({ from: name, to: target });
      } else dropped.push(name);
      continue;
    }
    dropped.push(name);
  }
  // Mandatory tools are added last so they cannot be excluded by omission.
  for (const name of mandatory) chosen.add(name);
  return {
    selected: [...chosen],
    repaired,
    dropped,
    defaulted: false,
  };
}

/**
 * Filters tool definitions down to what one agent may call.
 *
 * Takes the definitions rather than importing them, so this — the function that
 * actually decides what the model is handed — lives in the module that can be
 * loaded under bare Node and put under test. `lib/agent-tools.ts` holds the
 * definitions and cannot be imported outside the worker.
 */
export function filterToolDefinitions<T extends { name?: unknown }>(
  definitions: readonly T[],
  raw: unknown,
): T[] {
  const allowed = new Set(resolveToolSelection(raw).selected);
  return (definitions ?? []).filter((definition) =>
    // Named rather than stringified: a definition whose `name` is not a string
    // must be excluded, not coerced into '[object Object]'.
    typeof definition.name === 'string' ? allowed.has(definition.name) : false,
  );
}

/**
 * The embeddable web voice widget (§8).
 *
 * §8 makes a browser conversation a first-class call type: the customer drops
 * a script on their own site and visitors talk to the same agent, over
 * WebRTC/WebSocket instead of the phone network.
 *
 * Which means a **public, unauthenticated endpoint that starts calls**. Every
 * call costs the workspace credits and provider minutes, so that endpoint is
 * the most attackable thing in the product: without a gate, one person with
 * curl empties a customer's wallet overnight and the customer finds out from
 * their invoice.
 *
 * So the gate is the feature, and it lives here where it can be tested
 * exhaustively rather than inside a route handler:
 *
 *   **The request must come from an origin the workspace listed. The widget
 *   must be within its own daily and hourly caps. A mode nobody enabled cannot
 *   be started.**
 *
 * Three details in origin matching are where this normally goes wrong, and all
 * three are covered below: `https://example.com` and `https://www.example.com`
 * are different origins; a `*.example.com` entry must not match
 * `https://example.com.attacker.net`; and a missing Origin header is a refusal
 * rather than a pass, because a browser always sends one on a cross-origin
 * POST and anything that does not is not the browser this is for.
 *
 * Pure: origin matching, caps, modes. No database.
 */

export const WIDGET_MODES = ['voice', 'text', 'callback'] as const;
export type WidgetMode = (typeof WIDGET_MODES)[number];

export function isWidgetMode(value: unknown): value is WidgetMode {
  return (
    typeof value === 'string' &&
    (WIDGET_MODES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ *
 * Origins
 * ------------------------------------------------------------------ */

export type OriginRule = {
  /** The entry as the workspace typed it. */
  value: string;
  /** Null when usable; the reason when it is not. */
  problem: string | null;
};

/**
 * Checks an allowed-origin entry at the point it is saved, so a typo is
 * refused while somebody is looking at it rather than at 2am when the widget
 * silently stops answering.
 */
export function checkOriginRule(raw: string): OriginRule {
  const value = raw.trim();
  if (!value) return { value, problem: 'Empty.' };
  if (value === '*')
    return {
      value,
      // The one entry that would make every other check pointless.
      problem:
        'A bare * would let any website on the internet start calls on your account. List the sites you actually embed on.',
    };

  const wildcard = value.startsWith('*.') || value.includes('://*.');
  const probe = wildcard ? value.replace('*.', 'wildcard-probe.') : value;
  let url: URL;
  try {
    url = new URL(probe.includes('://') ? probe : `https://${probe}`);
  } catch {
    return { value, problem: 'Not a web address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return {
      value,
      problem: 'Only http and https origins can embed the widget.',
    };
  if (url.pathname !== '/' || url.search || url.hash)
    return {
      value,
      // An origin is scheme + host + port. A path here reads as if it
      // restricts the widget to one page, and it does not.
      problem: 'An origin is just the scheme and domain — drop the path.',
    };
  return { value, problem: null };
}

/**
 * Does this request's Origin match one of the workspace's entries?
 *
 * An entry with no scheme is treated as https only. A wildcard matches exactly
 * one level of subdomain and never the bare domain, because "*.example.com"
 * covering "example.com" is a surprise, and a workspace that wants both can
 * list both.
 */
export function originAllowed(
  origin: string | null,
  allowed: string[],
): boolean {
  if (!origin) return false;
  let request: URL;
  try {
    request = new URL(origin);
  } catch {
    return false;
  }
  const host = request.hostname.toLowerCase();
  const scheme = request.protocol;
  const port = request.port;

  return allowed.some((entry) => {
    const trimmed = entry.trim();
    if (!trimmed || trimmed === '*') return false;
    const wildcard = trimmed.includes('*.');
    const probe = wildcard ? trimmed.replace('*.', 'wildcard-probe.') : trimmed;
    let rule: URL;
    try {
      rule = new URL(probe.includes('://') ? probe : `https://${probe}`);
    } catch {
      return false;
    }
    if (rule.protocol !== scheme) return false;
    if (rule.port !== port) return false;
    const ruleHost = rule.hostname.toLowerCase();
    if (!wildcard) return ruleHost === host;

    // The classic hole: a suffix check would let example.com.attacker.net
    // through. The match is on the label boundary, and exactly one label.
    const base = ruleHost.replace('wildcard-probe.', '');
    if (host === base) return false;
    if (!host.endsWith(`.${base}`)) return false;
    const label = host.slice(0, host.length - base.length - 1);
    return label.length > 0 && !label.includes('.');
  });
}

/* ------------------------------------------------------------------ *
 * Caps
 * ------------------------------------------------------------------ */

export const DEFAULT_DAILY_CAP = 200;
export const DEFAULT_HOURLY_CAP = 40;
/** Nobody's site needs more than this, and it bounds the damage of a typo. */
export const MAX_DAILY_CAP = 5000;

export type StartDecision = {
  allowed: boolean;
  /** A machine-readable reason, for the widget to branch on. */
  code:
    | 'ok'
    | 'widget_disabled'
    | 'origin_not_allowed'
    | 'mode_disabled'
    | 'hourly_cap'
    | 'daily_cap'
    | 'no_credit';
  /** What the visitor is told. Never mentions caps or credits by name. */
  visitorMessage: string;
  /** What the workspace sees in its own logs. The full reason. */
  operatorMessage: string;
};

/**
 * Whether this visitor may start a session right now.
 *
 * The two messages are deliberately different. A visitor on somebody's website
 * must not be told "this workspace is out of credits" or "the hourly cap is
 * 40" — that is the customer's business, and the second one is a map for
 * whoever is probing. They get an apology and the fallback the widget still
 * offers. The workspace gets the real reason in its own logs.
 */
export function canStartSession(input: {
  status: string;
  origin: string | null;
  allowedOrigins: string[];
  mode: WidgetMode;
  enabledModes: WidgetMode[];
  sessionsToday: number;
  sessionsThisHour: number;
  dailyCap?: number;
  hourlyCap?: number;
  walletBalance: number;
}): StartDecision {
  const fallback =
    'Sorry — the voice assistant is not available right now. You can leave your number and we will call you back.';

  if (input.status !== 'active')
    return {
      allowed: false,
      code: 'widget_disabled',
      visitorMessage: fallback,
      operatorMessage: 'The widget is not active.',
    };

  if (!originAllowed(input.origin, input.allowedOrigins))
    return {
      allowed: false,
      code: 'origin_not_allowed',
      visitorMessage: fallback,
      operatorMessage: `A session was refused from ${input.origin ?? 'a request with no Origin header'}, which is not on this widget's list of sites.`,
    };

  if (!input.enabledModes.includes(input.mode))
    return {
      allowed: false,
      code: 'mode_disabled',
      visitorMessage: fallback,
      operatorMessage: `${input.mode} is switched off for this widget.`,
    };

  const hourlyCap = input.hourlyCap ?? DEFAULT_HOURLY_CAP;
  if (input.sessionsThisHour >= hourlyCap)
    return {
      allowed: false,
      code: 'hourly_cap',
      visitorMessage: fallback,
      operatorMessage: `This widget has started ${input.sessionsThisHour} sessions this hour, at its cap of ${hourlyCap}.`,
    };

  const dailyCap = input.dailyCap ?? DEFAULT_DAILY_CAP;
  if (input.sessionsToday >= dailyCap)
    return {
      allowed: false,
      code: 'daily_cap',
      visitorMessage: fallback,
      operatorMessage: `This widget has started ${input.sessionsToday} sessions today, at its cap of ${dailyCap}.`,
    };

  // The same floor the browser dialer uses. A public endpoint must not be the
  // one place a call starts on an empty wallet.
  if (input.walletBalance < 10)
    return {
      allowed: false,
      code: 'no_credit',
      visitorMessage: fallback,
      operatorMessage:
        'The workspace wallet is below the 10 credits a call needs to start.',
    };

  return {
    allowed: true,
    code: 'ok',
    visitorMessage: '',
    operatorMessage: '',
  };
}

/* ------------------------------------------------------------------ *
 * Branding
 * ------------------------------------------------------------------ */

export type WidgetBranding = {
  name: string;
  greeting: string;
  accent: string;
  logoUrl: string | null;
  position: 'bottom_right' | 'bottom_left';
};

const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Normalises what the workspace configured into something safe to inject.
 *
 * The accent colour and logo end up inside a `<style>` and an `<img src>` on
 * somebody else's page. A colour that is not a colour is dropped rather than
 * escaped-and-hoped, and a logo URL must be https — an http image on an https
 * site is blocked by the browser anyway and looks like the widget is broken.
 */
export function normaliseBranding(
  raw: unknown,
  fallbackName: string,
): WidgetBranding {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const text = (key: string, max: number) => {
    const value = input[key];
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  };
  const accent = text('accent', 20);
  const logo = text('logoUrl', 400);
  return {
    name: text('name', 60) || fallbackName,
    greeting: text('greeting', 160) || 'Talk to us',
    accent: HEX.test(accent) ? accent : '#2563EB',
    logoUrl: logo.startsWith('https://') ? logo : null,
    position: input.position === 'bottom_left' ? 'bottom_left' : 'bottom_right',
  };
}

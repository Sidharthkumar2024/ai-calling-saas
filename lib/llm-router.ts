/**
 * LLM Router (architecture §9): pick the cheapest model that can handle the
 * turn. Routine conversation and tool calls stay on the fast model; complex
 * objections, policy questions and repeated confusion escalate to a stronger
 * model. Never run two models serially on the same turn.
 */
export type RouteTier = 'fast' | 'strong';

export type RouteDecision = {
  tier: RouteTier;
  /** null means "use the workspace's configured model". */
  model: string | null;
  reason: string;
  /** True when the caller has been misunderstood repeatedly. */
  suggestHumanHandoff: boolean;
};

// Objection, policy and dispute language — the turns worth paying more for.
const COMPLEX_PATTERNS = [
  /refund|रिफंड|वापस\s*पैसे/i,
  /cancel(lation)?\s*(policy|charge)|कैंसिल.*(policy|चार्ज)/i,
  /legal|lawyer|वकील|कोर्ट|court|notice|RERA|dispute|विवाद/i,
  /complain|complaint|शिकायत|escalate|manager|मैनेजर|senior/i,
  /terms|agreement|contract|अनुबंध|policy\s*(kya|क्या)/i,
  /too\s*expensive|बहुत\s*महंगा|discount\s*(chahiye|चाहिए)|negotiat/i,
  /why\s*should\s*i|क्यों\s*लूँ|भरोसा\s*कैसे|guarantee|वारंटी|warranty/i,
  /compare|तुलना|competitor|दूसरी\s*कंपनी/i,
];

// The agent saying it did not understand — repeated, that means escalate/handoff.
const CONFUSION_PATTERNS = [
  /साफ़?\s*नहीं\s*आई|समझ\s*नहीं|फिर\s*बोल|दोहरा|repeat\s*(that|please)/i,
  /माफ\s*कीजिए.*नहीं|sorry.*didn'?t\s*(catch|understand)/i,
];

export function routeTurn(input: {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  configuredModel?: string | null;
  escalationModel?: string | null;
}): RouteDecision {
  const message = input.message ?? '';
  const history = input.history ?? [];
  const strongModel = input.escalationModel?.trim() || 'claude-sonnet-5';

  // How often did the agent recently say it did not understand?
  const confusionTurns = history
    .filter((turn) => turn.role === 'assistant')
    .slice(-4)
    .filter((turn) => CONFUSION_PATTERNS.some((rx) => rx.test(turn.content)))
    .length;

  if (confusionTurns >= 2) {
    return {
      tier: 'strong',
      model: strongModel,
      reason: 'repeated_recognition_failure',
      suggestHumanHandoff: confusionTurns >= 3,
    };
  }

  const complex = COMPLEX_PATTERNS.some((rx) => rx.test(message));
  if (complex) {
    return {
      tier: 'strong',
      model: strongModel,
      reason: 'objection_or_policy',
      suggestHumanHandoff: false,
    };
  }

  // Long, multi-question turns rarely answer well on the fastest model.
  const questionMarks = (message.match(/[?？]/g) || []).length;
  if (message.length > 220 || questionMarks >= 3) {
    return {
      tier: 'strong',
      model: strongModel,
      reason: 'long_multi_question_turn',
      suggestHumanHandoff: false,
    };
  }

  return {
    tier: 'fast',
    model: input.configuredModel?.trim() || null,
    reason: 'routine',
    suggestHumanHandoff: false,
  };
}

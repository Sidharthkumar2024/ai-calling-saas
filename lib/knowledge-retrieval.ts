/**
 * Knowledge retrieval (§36 Knowledge/RAG).
 *
 * The agent's system prompt has always said "use only the workspace
 * instructions and approved knowledge". Nothing ever gave it any. Ingestion
 * worked — sources fetched, text chunked, rows written — and `knowledge_chunks`
 * had exactly one reader in the whole repository: a search box. So the sentence
 * in the prompt was aspirational, and the model answered from whatever it
 * already believed.
 *
 * The search that did exist was `content LIKE '%<the whole question>%'`, which
 * matches a customer's question only if somebody wrote the document in exactly
 * those words. "What's your refund policy?" matches nothing.
 *
 * This scores per term instead. It is not vector search — there are no
 * embeddings in this runtime — and it does not pretend to be: `method` is
 * returned with every result so a caller can say which kind of retrieval
 * produced an answer, and swapping in embeddings later means changing
 * `rankChunks` and nothing else.
 *
 * Pure: ranking and assembly only.
 */

/**
 * Words carrying no topic. Kept deliberately short: an over-eager stopword list
 * throws away terms that matter in this domain — "call", "number" and "plan"
 * are all common words *and* the subject of most questions.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'am',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'i',
  'you',
  'we',
  'they',
  'it',
  'he',
  'she',
  'me',
  'my',
  'your',
  'our',
  'their',
  'this',
  'that',
  'these',
  'those',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'as',
  'so',
  'than',
  'then',
  'there',
  'here',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'when',
  'where',
  'why',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'not',
  'no',
  'yes',
  'please',
  'kya',
  'hai',
  'ka',
  'ki',
  'ke',
  'me',
  'aur',
  'ko',
]);

export function tokenize(text: string): string[] {
  return (
    String(text ?? '')
      .toLowerCase()
      // Keep Devanagari and other scripts: a Hindi question must be searchable in
      // Hindi. \w would drop every character of it — and \p{L}\p{N} alone is not
      // enough either, because matras and the anusvara are combining *marks*
      // (\p{M}), not letters. Without \p{M} here, "रिफंड" splits at its own
      // anusvara into "रिफ" and "ड" and matches nothing.
      .split(/[^\p{L}\p{N}\p{M}]+/u)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
  );
}

export type Chunk = {
  id: string;
  content: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
};

export type ScoredChunk = Chunk & {
  score: number;
  /** Which query terms this passage actually contains. */
  matched: string[];
};

/**
 * Scores one passage against the query terms.
 *
 * Term frequency with diminishing returns and a length penalty, which together
 * stop one long document that repeats a word from burying a short passage that
 * answers the question. Coverage — how many *distinct* query terms appear — is
 * weighted hardest, because a passage mentioning both "refund" and "policy"
 * is more likely to be the policy than one mentioning "refund" ten times.
 */
export function scoreChunk(chunk: Chunk, terms: string[]): ScoredChunk {
  const haystack = ` ${chunk.content.toLowerCase()} `;
  const matched: string[] = [];
  let score = 0;
  for (const term of terms) {
    let occurrences = 0;
    let index = haystack.indexOf(term);
    while (index !== -1 && occurrences < 20) {
      occurrences += 1;
      index = haystack.indexOf(term, index + term.length);
    }
    if (!occurrences) continue;
    matched.push(term);
    // sqrt so the tenth mention counts for much less than the second.
    score += Math.sqrt(occurrences);
  }
  if (!matched.length) return { ...chunk, score: 0, matched };
  const coverage = matched.length / terms.length;
  const lengthPenalty = Math.log10(Math.max(10, chunk.content.length));
  return {
    ...chunk,
    score: (score * (0.4 + coverage)) / lengthPenalty,
    matched,
  };
}

export type Ranking = {
  chunks: ScoredChunk[];
  /** How the ranking was produced, so a caller never implies more than it did. */
  method: 'keyword';
  terms: string[];
};

export function rankChunks(chunks: Chunk[], query: string, limit = 4): Ranking {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return { chunks: [], method: 'keyword', terms };
  const scored = (chunks ?? [])
    .map((chunk) => scoreChunk(chunk, terms))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    chunks: scored.slice(0, Math.max(1, limit)),
    method: 'keyword',
    terms,
  };
}

export type KnowledgeContext = {
  /** Ready to drop into the system prompt, or empty when nothing matched. */
  text: string;
  passages: ScoredChunk[];
  method: 'keyword';
  truncated: boolean;
};

/**
 * Assembles ranked passages into a prompt block, within a character budget.
 *
 * Each passage is labelled with its source so the agent can say where an answer
 * came from, and the block carries an explicit instruction that these passages
 * are the *only* approved knowledge — without which the model treats them as
 * background reading rather than the boundary they are meant to be.
 */
export function buildKnowledgeContext(
  ranking: Ranking,
  budget = 3000,
): KnowledgeContext {
  if (!ranking.chunks.length)
    return { text: '', passages: [], method: ranking.method, truncated: false };

  const parts: string[] = [];
  const used: ScoredChunk[] = [];
  let spent = 0;
  let truncated = false;
  for (const chunk of ranking.chunks) {
    const label = chunk.sourceName ? ` source="${chunk.sourceName}"` : '';
    const body = chunk.content.trim().replace(/\s+/g, ' ');
    const entry = `<passage${label}>${body}</passage>`;
    if (spent + entry.length > budget) {
      truncated = true;
      break;
    }
    parts.push(entry);
    used.push(chunk);
    spent += entry.length;
  }
  if (!used.length)
    return { text: '', passages: [], method: ranking.method, truncated: true };

  return {
    text: `<approved_knowledge>These passages are the workspace's approved knowledge, and the only source you may answer factual questions from. If they do not cover what the caller asked, say you will check and follow up — never fill the gap yourself.
${parts.join('\n')}</approved_knowledge>`,
    passages: used,
    method: ranking.method,
    truncated,
  };
}

/**
 * Fetches candidate passages and ranks them.
 *
 * Candidates are narrowed in SQL by any single query term — cheap and broad —
 * and then ranked properly in JS. Doing the ranking in SQLite would mean one
 * LIKE per term with no scoring, which is what the old search did and why it
 * only worked when the document happened to use the caller's words.
 */
export async function retrieveKnowledge(input: {
  organizationId: string;
  query: string;
  limit?: number;
  budget?: number;
}): Promise<KnowledgeContext> {
  const terms = [...new Set(tokenize(input.query))].slice(0, 8);
  if (!terms.length)
    return { text: '', passages: [], method: 'keyword', truncated: false };

  const { getRawDb } = await import('@/db/index');
  const where = terms.map(() => `c.content LIKE ? ESCAPE '\\'`).join(' OR ');
  const bindings = terms.map(
    (term) => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`,
  );
  let rows: { results?: Chunk[] };
  try {
    rows = await getRawDb()
      .prepare(
        `SELECT c.id, c.content, s.name AS sourceName, s.source_url AS sourceUrl
         FROM knowledge_chunks c
         INNER JOIN knowledge_sources s ON s.id = c.source_id
         WHERE c.organization_id = ? AND s.status = 'ready' AND (${where})
         LIMIT 60`,
      )
      .bind(input.organizationId, ...bindings)
      .all<Chunk>();
  } catch {
    // Retrieval failing must not take the call down. An answer without
    // knowledge is worse than one with it, but a dropped call is worse still.
    return { text: '', passages: [], method: 'keyword', truncated: false };
  }
  return buildKnowledgeContext(
    rankChunks(rows.results ?? [], input.query, input.limit ?? 4),
    input.budget,
  );
}

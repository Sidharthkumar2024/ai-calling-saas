import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { enqueueJob } from '@/lib/job-queue';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const query = new URL(request.url).searchParams
    .get('q')
    ?.trim()
    .slice(0, 120);
  const organizationId = auth.session.organizationId!;
  if (query) {
    const chunks = await getRawDb()
      .prepare(`SELECT c.id, c.content, s.name AS source_name, s.source_url
      FROM knowledge_chunks c INNER JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.organization_id = ? AND lower(c.content) LIKE lower(?) LIMIT 20`)
      .bind(organizationId, `%${query.replaceAll('%', '')}%`)
      .all();
    return NextResponse.json({ results: chunks.results });
  }
  const sources = await getRawDb()
    .prepare(`SELECT s.*, k.name AS knowledge_base_name,
      (SELECT count(*) FROM knowledge_chunks c WHERE c.source_id = s.id) AS chunk_count
    FROM knowledge_sources s
    INNER JOIN knowledge_bases k ON k.id = s.knowledge_base_id WHERE s.organization_id = ?
    ORDER BY s.created_at DESC`)
    .bind(organizationId)
    .all();
  return NextResponse.json({ sources: sources.results });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    knowledgeBaseId?: string;
    name?: string;
    text?: string;
    url?: string;
  };
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const knowledgeBase = await db
    .prepare(
      'SELECT id FROM knowledge_bases WHERE id = ? AND organization_id = ?',
    )
    .bind(body.knowledgeBaseId, organizationId)
    .first();
  if (!knowledgeBase || !body.name?.trim())
    return NextResponse.json(
      { error: 'Knowledge base and source name are required.' },
      { status: 400 },
    );
  let content = body.text?.trim() || '';
  let sourceUrl: string | null = null;
  if (!content && body.url) {
    const parsed = safePublicUrl(body.url);
    if (!parsed)
      return NextResponse.json(
        { error: 'Only public HTTPS URLs are accepted.' },
        { status: 400 },
      );
    const response = await fetch(parsed, {
      headers: { 'user-agent': 'Vaani-Knowledge-Ingest/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      return NextResponse.json(
        { error: `Source returned HTTP ${response.status}.` },
        { status: 422 },
      );
    const html = (await response.text()).slice(0, 500_000);
    content = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    sourceUrl = parsed.toString();
  }
  if (content.length < 20)
    return NextResponse.json(
      { error: 'Provide at least 20 characters of approved content.' },
      { status: 400 },
    );
  content = content.slice(0, 500_000);
  const sourceId = `source_${crypto.randomUUID()}`;
  const chunks = chunkText(content);
  const statements = [
    db
      .prepare(`INSERT INTO knowledge_sources
      (id, organization_id, knowledge_base_id, type, name, source_url, content_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'indexing')`)
      .bind(
        sourceId,
        organizationId,
        body.knowledgeBaseId,
        sourceUrl ? 'url' : 'text',
        body.name.trim().slice(0, 140),
        sourceUrl,
        await sha256(content),
      ),
    ...chunks.map((chunk, index) =>
      db
        .prepare(`INSERT INTO knowledge_chunks
      (id, organization_id, source_id, ordinal, content, token_estimate, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          `chunk_${crypto.randomUUID()}`,
          organizationId,
          sourceId,
          index,
          chunk,
          Math.ceil(chunk.length / 4),
          JSON.stringify({ sourceName: body.name }),
        ),
    ),
    db
      .prepare(`UPDATE knowledge_bases SET source_count = source_count + 1,
      chunk_count = chunk_count + ?, status = 'indexing' WHERE id = ? AND organization_id = ?`)
      .bind(chunks.length, body.knowledgeBaseId, organizationId),
  ];
  for (let index = 0; index < statements.length; index += 80)
    await db.batch(statements.slice(index, index + 80));
  await enqueueJob({
    organizationId,
    queue: 'knowledge',
    type: 'knowledge.ingest_text',
    idempotencyKey: `knowledge:${sourceId}`,
    payload: { sourceId },
  });
  return NextResponse.json(
    { id: sourceId, chunks: chunks.length, status: 'indexing' },
    { status: 202 },
  );
}

function chunkText(value: string) {
  const chunks: string[] = [];
  for (
    let start = 0;
    start < value.length && chunks.length < 500;
    start += 1200
  )
    chunks.push(value.slice(start, start + 1400).trim());
  return chunks.filter(Boolean);
}

function safePublicUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

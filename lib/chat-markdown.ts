/**
 * The little bit of Markdown a chat answer actually uses.
 *
 * Models answer in headings, bullets, numbered steps and the occasional code
 * block, and the chat rendered all of it as one pre-wrapped paragraph — so a
 * seven-step plan arrived as a wall with literal asterisks in it.
 *
 * This returns a structure, not HTML. Nothing here is ever handed to
 * `dangerouslySetInnerHTML`: the component renders these blocks as elements,
 * so a model that emits `<img onerror=…>` produces those characters on screen
 * and nothing else. That is the whole reason for parsing to data.
 *
 * Deliberately small — no links, tables or blockquotes yet. Adding a rule here
 * is cheap; a half-parsed one that swallows text is not.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string };

export type Block =
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'heading'; level: 2 | 3; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; language: string | null; text: string };

/** Splits `**bold**` and `` `code` `` out of one line. */
export function parseInline(line: string): Inline[] {
  const spans: Inline[] = [];
  // One pass over both markers: matching them separately let a `**` inside a
  // code span open a bold that never closed, and the rest of the answer
  // rendered bold.
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let index = 0;
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > index) spans.push({ kind: 'text', text: line.slice(index, at) });
    if (match[2] !== undefined) spans.push({ kind: 'bold', text: match[2] });
    else if (match[3] !== undefined)
      spans.push({ kind: 'code', text: match[3] });
    index = at + match[0].length;
  }
  if (index < line.length)
    spans.push({ kind: 'text', text: line.slice(index) });
  return spans.length ? spans : [{ kind: 'text', text: line }];
}

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,2})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const lines = String(source ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ kind: 'paragraph', spans: parseInline(text) });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      flushParagraph();
      const language = line.replace(/^\s*```/, '').trim() || null;
      const body: string[] = [];
      index += 1;
      // An unterminated fence runs to the end rather than eating the answer:
      // a stream that is still arriving has exactly that shape.
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', language, text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1].length <= 2 ? 2 : 3,
        spans: parseInline(heading[2].trim()),
      });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushParagraph();
      const ordered = !BULLET.test(line);
      const items: Inline[][] = [];
      while (index < lines.length) {
        const bullet = BULLET.exec(lines[index]);
        const numbered = ORDERED.exec(lines[index]);
        if (ordered && numbered) items.push(parseInline(numbered[2].trim()));
        else if (!ordered && bullet) items.push(parseInline(bullet[1].trim()));
        else break;
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

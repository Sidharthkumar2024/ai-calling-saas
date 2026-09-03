/**
 * CSV / TSV / XLSX parsing for bulk calling imports (§10-11).
 *
 * No spreadsheet dependency: CSV is parsed to RFC 4180, and XLSX is read
 * directly — it is a ZIP of XML, and the runtime provides DecompressionStream.
 * Keeping this pure means every parsing rule is testable without an upload.
 */

export type SheetTable = {
  headers: string[];
  rows: string[][];
  /** Which parser handled the file, for the import job's audit trail. */
  format: 'csv' | 'tsv' | 'xlsx';
  truncated: boolean;
};

export const MAX_IMPORT_ROWS = 50_000;

/** Splits one delimited line, honouring quotes and escaped quotes. */
function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      // Swallow CRLF as one break.
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseDelimited(
  text: string,
  format: 'csv' | 'tsv' = 'csv',
): SheetTable {
  // A UTF-8 BOM would otherwise become part of the first header name.
  const clean = text.replace(/^﻿/, '');
  const all = splitDelimited(clean, format === 'tsv' ? '\t' : ',').filter(
    (row) => row.some((cell) => cell.trim().length),
  );
  if (!all.length)
    return { headers: [], rows: [], format, truncated: false };
  const [headers, ...rest] = all;
  return {
    headers: headers.map((cell) => cell.trim()),
    rows: rest.slice(0, MAX_IMPORT_ROWS),
    format,
    truncated: rest.length > MAX_IMPORT_ROWS,
  };
}

/* ------------------------------ XLSX ------------------------------ */

async function inflateRaw(bytes: Uint8Array) {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Copy the subarray: a view onto a larger buffer is not accepted as a
  // BufferSource by the stream types.
  void writer.write(Uint8Array.from(bytes) as unknown as BufferSource);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Reads a ZIP archive's entries by walking its central directory. */
async function readZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // The end-of-central-directory record is at the tail, after an optional
  // comment, so scan backwards for its signature.
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-directory).');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const files = new Map<string, Uint8Array>();
  for (let entry = 0; entry < count; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    // Jump to the local header to find where the data actually starts.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    files.set(
      name,
      method === 0 ? raw : await inflateRaw(raw),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replaceAll('&amp;', '&');
}

/** "BC12" -> 54 (zero-based column index). */
export function columnIndex(reference: string) {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase())?.[1] ?? '';
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<SheetTable> {
  const files = await readZip(buffer);
  const decoder = new TextDecoder();
  const sharedRaw = files.get('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedRaw) {
    const xml = decoder.decode(sharedRaw);
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // A cell's string can be split across several <t> runs.
      const text = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((run) => run[1])
        .join('');
      shared.push(decodeXmlEntities(text));
    }
  }
  // Take the first worksheet; a bulk-calling list is not multi-sheet.
  const sheetName =
    [...files.keys()]
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort()[0] ?? '';
  if (!sheetName) throw new Error('The workbook has no worksheet.');
  const sheet = decoder.decode(files.get(sheetName)!);

  const grid: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(
      /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g,
    )) {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? '';
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((run) => run[1])
          .join('');
        value = decodeXmlEntities(value);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        value =
          type === 's'
            ? (shared[Number(raw)] ?? '')
            : decodeXmlEntities(raw);
      }
      // Honour the cell reference so a sparse row keeps its columns aligned.
      const target = reference ? columnIndex(reference) : cells.length;
      while (cells.length < target) cells.push('');
      cells[target] = value;
    }
    grid.push(cells);
  }
  const filled = grid.filter((row) => row.some((cell) => cell.trim().length));
  if (!filled.length)
    return { headers: [], rows: [], format: 'xlsx', truncated: false };
  const [headers, ...rest] = filled;
  return {
    headers: headers.map((cell) => cell.trim()),
    rows: rest.slice(0, MAX_IMPORT_ROWS),
    format: 'xlsx',
    truncated: rest.length > MAX_IMPORT_ROWS,
  };
}

/** Chooses a parser from the filename and the file's own magic bytes. */
export async function parseSpreadsheet(
  filename: string,
  buffer: ArrayBuffer,
): Promise<SheetTable> {
  const bytes = new Uint8Array(buffer);
  const isZip =
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  if (isZip) return parseXlsx(buffer);
  const name = filename.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm'))
    // Named like a workbook but not a ZIP: say so instead of parsing garbage.
    throw new Error(
      'This file is named .xlsx but is not a valid workbook. Re-export it, or save it as CSV.',
    );
  if (name.endsWith('.xls'))
    throw new Error(
      'Legacy .xls is not supported. Save the file as .xlsx or .csv and upload again.',
    );
  const text = new TextDecoder().decode(bytes);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return parseDelimited(text, tabs > commas ? 'tsv' : 'csv');
}

/* --------------------------- normalisation --------------------------- */

/**
 * Normalises a phone number to E.164.
 * `defaultCountryCode` is applied to a local number, which is the common case
 * in an Indian contact list where numbers are stored as ten digits.
 */
export function normalisePhone(
  raw: string,
  defaultCountryCode = '91',
): { phone: string | null; reason?: string } {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { phone: null, reason: 'missing' };
  // Spreadsheets love turning long numbers into 9.1988e+11.
  if (/e\+?\d+$/i.test(trimmed))
    return {
      phone: null,
      reason: 'scientific_notation — format the column as text before exporting',
    };
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return { phone: null, reason: 'no_digits' };
  let candidate = digits;
  if (!hadPlus) {
    // 0-prefixed trunk code, then a bare local number.
    if (candidate.startsWith('0')) candidate = candidate.replace(/^0+/, '');
    if (candidate.length === 10) candidate = `${defaultCountryCode}${candidate}`;
    else if (candidate.startsWith('00')) candidate = candidate.slice(2);
  }
  if (candidate.length < 8 || candidate.length > 15)
    return { phone: null, reason: `implausible_length_${candidate.length}` };
  return { phone: `+${candidate}` };
}

/** Guesses which uploaded column holds which field, so mapping starts sensible. */
export const IMPORT_FIELDS = [
  { key: 'phone', label: 'Phone number', required: true },
  { key: 'name', label: 'Name', required: false },
  { key: 'language', label: 'Language', required: false },
  { key: 'timezone', label: 'Timezone', required: false },
  { key: 'company', label: 'Company', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];

const HINTS: Record<ImportField, RegExp> = {
  phone: /(phone|mobile|contact|number|msisdn|whats)/i,
  name: /(^name|full[_ ]?name|customer|person|first)/i,
  language: /(lang|bhasha)/i,
  timezone: /(timezone|tz)/i,
  company: /(company|organisation|organization|firm|business)/i,
  notes: /(note|remark|comment|detail)/i,
};

export function suggestMapping(headers: string[]) {
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const index = headers.findIndex(
      (header, position) =>
        !used.has(position) && HINTS[field.key].test(header.trim()),
    );
    if (index >= 0) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  return mapping;
}

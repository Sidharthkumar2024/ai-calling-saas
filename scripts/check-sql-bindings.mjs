/**
 * Guards against D1_ERROR "Wrong number of parameter bindings".
 *
 * A statement whose `?` placeholders do not match its .bind() arguments fails
 * only at runtime, as a 500 with an empty body. Campaign creation shipped
 * broken this way: eight placeholders, seven values, every attempt failing.
 *
 * Statements whose SQL is built with ${...} have a dynamic placeholder count
 * and are reported as skipped rather than guessed at.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  "grep -rl '\\.prepare(' app lib db --include='*.ts' 2>/dev/null",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

/** Removes // line comments that are not inside a string or template. */
function stripLineComments(source) {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '`' || ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          out += source[i];
          i += 1;
        }
        out += source[i];
        i += 1;
      }
      out += source[i] ?? '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

let flagged = 0;
let checked = 0;
let skipped = 0;
for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const src = stripLineComments(raw);
  const re = /\.prepare\(\s*`([^`]*)`\s*,?\s*\)\s*\.bind\(/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const sql = match[1];
    if (sql.includes('${')) {
      skipped += 1;
      continue;
    }
    const placeholders = (sql.match(/\?/g) || []).length;
    checked += 1;
    let i = re.lastIndex;
    let depth = 1;
    let commas = 0;
    let nonSpace = false;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '`' || ch === "'" || ch === '"') {
        const quote = ch;
        i += 1;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\') i += 1;
          i += 1;
        }
      } else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1;
        if (!depth) break;
      } else if (ch === ',' && depth === 1) commas += 1;
      if (depth === 1 && ch !== ',' && !/\s/.test(ch)) nonSpace = true;
      i += 1;
    }
    const inner = src.slice(re.lastIndex, i);
    const bindings = nonSpace ? commas + (/,\s*$/.test(inner) ? 0 : 1) : 0;
    if (bindings !== placeholders) {
      flagged += 1;
      const line = src.slice(0, match.index).split('\n').length;
      console.log(
        `  ❌ ${file}:${line} — ${placeholders} placeholders, ${bindings} bindings`,
      );
      console.log(`     ${sql.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
}
console.log(
  `\n${checked} statements checked, ${skipped} dynamic skipped, ${flagged} mismatched`,
);
process.exit(flagged ? 1 : 0);

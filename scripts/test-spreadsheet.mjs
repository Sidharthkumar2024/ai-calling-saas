import { readFileSync } from 'node:fs';

import {
  MAX_IMPORT_ROWS,
  columnIndex,
  normalisePhone,
  parseDelimited,
  parseSpreadsheet,
  parseXlsx,
  suggestMapping,
} from '../lib/spreadsheet.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('CSV parsing:');
ok(
  'headers and rows separate',
  (() => {
    const t = parseDelimited('name,phone\nRahul,9876543210\n');
    return (
      t.headers.join('|') === 'name|phone' &&
      t.rows.length === 1 &&
      t.rows[0][1] === '9876543210'
    );
  })(),
);
ok(
  'a quoted field containing a comma stays one field',
  parseDelimited('name,note\n"Sharma, Rahul",vip\n').rows[0][0] ===
    'Sharma, Rahul',
);
ok(
  'escaped quotes are unescaped',
  parseDelimited('name\n"Priya ""P"" Patel"\n').rows[0][0] ===
    'Priya "P" Patel',
);
ok(
  'a newline inside a quoted field does not split the row',
  (() => {
    const t = parseDelimited('name,note\n"Rahul","line one\nline two"\n');
    return t.rows.length === 1 && t.rows[0][1].includes('\n');
  })(),
);
ok(
  'CRLF line endings are handled',
  parseDelimited('name,phone\r\nRahul,999\r\n').rows.length === 1,
);
ok(
  'a UTF-8 BOM does not corrupt the first header',
  parseDelimited('﻿name,phone\nA,1\n').headers[0] === 'name',
);
ok('blank lines are skipped', parseDelimited('a\n\n\nb\n').rows.length === 1);
ok(
  'TSV is parsed on tabs',
  parseDelimited('name\tphone\nRahul\t999\n', 'tsv').rows[0][1] === '999',
);
ok(
  'an empty file yields no headers rather than throwing',
  parseDelimited('').headers.length === 0,
);

console.log('column references:');
ok('A is column 0', columnIndex('A1') === 0);
ok('Z is column 25', columnIndex('Z9') === 25);
ok('AA is column 26', columnIndex('AA100') === 26);
ok('BC is column 54', columnIndex('BC12') === 54);

console.log('XLSX parsing (against a real generated workbook):');
const workbook = readFileSync('scripts/fixtures/import-sample.xlsx');
const table = await parseXlsx(
  workbook.buffer.slice(
    workbook.byteOffset,
    workbook.byteOffset + workbook.byteLength,
  ),
);
ok(
  'shared-string headers are read',
  table.headers.join('|') === 'Name|Phone Number|Language|Notes',
);
ok('every data row is returned', table.rows.length === 4);
ok('a numeric cell keeps its digits', table.rows[0][1] === '9876543210');
ok(
  'a sparse row keeps its columns aligned by cell reference',
  (() => {
    const row = table.rows[1];
    // Row 3 has B and D only: name empty, phone in 1, notes in 3.
    return row[0] === '' && row[1] === '919812345678' && row[3] === 'Amit & Sons';
  })(),
);
ok(
  'an XML entity is decoded, not left escaped',
  table.rows[1][3] === 'Amit & Sons',
);
ok(
  'an inline string cell is read',
  table.rows[2][1] === '+91 98111 22333',
);
ok('non-ASCII text survives', table.rows[3][0] === 'सुनीता');

console.log('format detection:');
ok(
  'a ZIP is routed to the XLSX parser regardless of name',
  (await parseSpreadsheet(
    'contacts.txt',
    workbook.buffer.slice(
      workbook.byteOffset,
      workbook.byteOffset + workbook.byteLength,
    ),
  )).format === 'xlsx',
);
ok(
  'plain text named .csv is parsed as CSV',
  (await parseSpreadsheet(
    'x.csv',
    new TextEncoder().encode('a,b\n1,2\n').buffer,
  )).format === 'csv',
);
ok(
  'a file named .xlsx that is not a workbook is refused with a real reason',
  await (async () => {
    try {
      await parseSpreadsheet(
        'broken.xlsx',
        new TextEncoder().encode('name,phone\n').buffer,
      );
      return false;
    } catch (error) {
      return /not a valid workbook/i.test(error.message);
    }
  })(),
);
ok(
  'legacy .xls names a fix instead of failing cryptically',
  await (async () => {
    try {
      await parseSpreadsheet('old.xls', new TextEncoder().encode('x').buffer);
      return false;
    } catch (error) {
      return /save the file as/i.test(error.message);
    }
  })(),
);

console.log('phone normalisation:');
ok('a ten-digit local number gets the country code', normalisePhone('9876543210').phone === '+919876543210');
ok('spaces and dashes are stripped', normalisePhone('98765 43210').phone === '+919876543210');
ok('an existing + is respected', normalisePhone('+14155552671').phone === '+14155552671');
ok('a leading zero trunk code is dropped', normalisePhone('09876543210').phone === '+919876543210');
ok('00 international prefix becomes +', normalisePhone('00919876543210').phone === '+919876543210');
ok('an already-prefixed 91 number is left alone', normalisePhone('919876543210').phone === '+919876543210');
ok('a different default country code is honoured', normalisePhone('5551234567', '1').phone === '+15551234567');
ok('an empty cell is reported as missing', normalisePhone('').reason === 'missing');
ok('letters are rejected', normalisePhone('not-a-number').reason === 'no_digits');
ok(
  'a too-short number is rejected with its length',
  /implausible_length_5/.test(normalisePhone('12345').reason ?? ''),
);
ok(
  'a spreadsheet turning the number into 9.87e+11 is caught and explained',
  /scientific_notation/.test(normalisePhone('9.876543210e+11').reason ?? ''),
);

console.log('column mapping:');
ok(
  'obvious headers map themselves',
  (() => {
    const m = suggestMapping(['Full Name', 'Mobile Number', 'Language', 'City']);
    return m.phone === 1 && m.name === 0 && m.language === 2;
  })(),
);
ok(
  'a header is never mapped to two fields',
  (() => {
    const m = suggestMapping(['contact', 'contact']);
    return m.phone === 0 && Object.values(m).filter((v) => v === 0).length === 1;
  })(),
);
ok(
  'nothing is invented when no header matches',
  suggestMapping(['col1', 'col2']).phone === undefined,
);

console.log('limits:');
ok('a row cap exists', MAX_IMPORT_ROWS > 0 && MAX_IMPORT_ROWS <= 200_000);
ok(
  'exceeding the cap truncates and says so',
  (() => {
    const csv = `phone\n${Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => 9000000000 + i).join('\n')}`;
    const t = parseDelimited(csv);
    return t.truncated === true && t.rows.length === MAX_IMPORT_ROWS;
  })(),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

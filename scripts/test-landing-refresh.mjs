import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  introFrame,
  INTRO_LAST_FRAME_SECONDS,
  INTRO_OPENING_SECONDS,
} from '../lib/landing-intro.ts';
import { displayBrand } from '../lib/display-brand.ts';
import { WORKFORCE_DEMOS } from '../lib/landing-workforce.ts';

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions++;
};
const end = introFrame(1, 8.52);
check(
  end.time === 6.36 && end.reveal === 1,
  'Replace the white tail with the persistent phone scene',
);
const opening = introFrame(0, 8.52);
check(
  opening.time === 2 &&
    opening.time === INTRO_OPENING_SECONDS &&
    opening.reveal === 0,
  'Hold the requested full-height robot frame before scroll',
);
check(
  introFrame(0.85, 8.52).reveal === 1,
  'Finish the reveal before the pinned stage ends',
);
let previous = { time: 0, reveal: 0 };
for (let i = 0; i <= 100; i++) {
  const frame = introFrame(i / 100, 8.52);
  check(
    frame.time >= previous.time && frame.reveal >= previous.reveal,
    `Forward scroll is monotonic at ${i}%`,
  );
  check(
    frame.time <= INTRO_LAST_FRAME_SECONDS && frame.reveal <= 1,
    `Never seek into the white tail at ${i}%`,
  );
  previous = frame;
}
for (const duration of [0, 0.1, 0.6, 8.52, NaN, Infinity, -5]) {
  for (const progress of [-1, 0, 0.7, 1, 2, NaN, Infinity]) {
    const frame = introFrame(progress, duration);
    check(
      Number.isFinite(frame.time) && frame.time >= 0 && frame.time <= 6.36,
      'Invalid and short media remain safe',
    );
    check(
      Number.isFinite(frame.reveal) && frame.reveal >= 0 && frame.reveal <= 1,
      'Reveal always stays finite and bounded',
    );
  }
}
check(
  displayBrand('VANI · V-A-N-I · Vaani') ===
    'Call Vani · Call Vani · Call Vani',
  'All previous display spellings migrate',
);
check(
  displayBrand('Call Vaani') === 'Call Vani',
  'Existing new branding remains unchanged',
);
check(
  displayBrand(displayBrand('Vaani Sense')) === 'Call Vani Sense',
  'Migration is idempotent',
);
check(
  displayBrand('vaani_sense /vani-platform') === 'vaani_sense /vani-platform',
  'Lowercase internal identifiers remain intact',
);
check(
  new Set(WORKFORCE_DEMOS.map((demo) => demo.id)).size === 5,
  'Five distinct role tabs',
);
for (const demo of WORKFORCE_DEMOS) {
  check(
    demo.steps.length === 5 && demo.stepsHi.length === 5,
    `${demo.id}: both languages have five workflow steps`,
  );
  check(
    demo.dialogue.length === 4 && demo.dialogueHi.length === 4,
    `${demo.id}: both languages have four conversation turns`,
  );
  check(
    [
      demo.title,
      demo.hindi,
      demo.description,
      demo.descriptionHi,
      ...demo.steps,
      ...demo.stepsHi,
      ...demo.dialogue,
      ...demo.dialogueHi,
    ].every((value) => value.trim().length > 0),
    `${demo.id}: no blank content`,
  );
}
const png = readFileSync(
  new URL('../public/media/call-vani-phone.png', import.meta.url),
);
check(
  png.subarray(1, 4).toString() === 'PNG' &&
    png.readUInt32BE(16) === 1024 &&
    png.readUInt32BE(20) === 1536,
  'The authored phone asset exists at its declared dimensions',
);
const avif = readFileSync(
  new URL('../public/media/call-vani-phone.avif', import.meta.url),
);
check(
  avif.subarray(4, 12).toString() === 'ftypavif' && avif.length < 100_000,
  'The landing page uses a compact AVIF phone asset',
);
const google = readFileSync(
  new URL('../public/brands/google-g.png', import.meta.url),
);
check(
  google.subarray(1, 4).toString() === 'PNG',
  'The official Google raster mark is bundled locally',
);
const intro = readFileSync(
  new URL('../components/landing-video-intro.tsx', import.meta.url),
  'utf8',
);
check(
  intro.includes("error.name === 'AbortError'"),
  'Intentional playback interruptions do not permanently fail the film',
);
check(
  intro.includes('holdOpeningFrame') &&
    intro.includes('element.currentTime = openingTime'),
  'Coarse Safari playback is clamped to the authored opening frame',
);
check(
  intro.includes('inert={!showingProduct}') &&
    !intro.includes('className="cv-intro-product" aria-hidden'),
  'Obscured controls are inert without hiding the semantic heading',
);
console.log(
  `Landing refresh: ${assertions} assertions passed. No network or live provider actions.`,
);

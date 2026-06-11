// Data integrity tests for the Ogden 850 word list.
// Run: node tests/validate-words.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'words.js'), 'utf8'), sandbox);
const WORD_DATA = vm.runInContext('WORD_DATA', sandbox);

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ok  ' + msg);
  } else {
    failures++;
    console.error('FAIL  ' + msg);
  }
}

const EXPECTED = { operations: 100, general: 400, picturable: 200, qualities: 100, opposites: 50 };

assert(WORD_DATA && Array.isArray(WORD_DATA.categories), 'WORD_DATA.categories is an array');
assert(WORD_DATA.categories.length === 5, 'exactly 5 categories');

let total = 0;
for (const cat of WORD_DATA.categories) {
  total += cat.words.length;
  assert(EXPECTED[cat.id] === cat.words.length,
    `category ${cat.id} has ${cat.words.length} words (expected ${EXPECTED[cat.id]})`);
  assert(typeof cat.name === 'string' && cat.name && typeof cat.nameZh === 'string' && cat.nameZh,
    `category ${cat.id} has name/nameZh`);
}
assert(total === 850, `total word count is ${total} (expected exactly 850)`);

const allWords = WORD_DATA.categories.flatMap(c => c.words);

// Field integrity
const badFields = allWords.filter(w =>
  typeof w.en !== 'string' || !w.en.trim() ||
  typeof w.zh !== 'string' || !w.zh.trim());
assert(badFields.length === 0, `every word has non-empty en and zh (${badFields.length} bad)`);

// en: lowercase ascii letters/hyphen only, unique ("I" is the one legitimate capital)
const badEn = allWords.filter(w => w.en !== 'I' && !/^[a-z][a-z-]*$/.test(w.en));
assert(badEn.length === 0,
  `every en is lowercase ascii (${badEn.map(w => w.en).join(', ') || 'none'})`);

const enSeen = new Map();
const enDup = [];
for (const w of allWords) {
  if (enSeen.has(w.en)) enDup.push(w.en);
  enSeen.set(w.en, true);
}
assert(enDup.length === 0, `en is unique across 850 (dups: ${enDup.join(', ') || 'none'})`);

// zh: unique across 850 (prevents double-correct quiz answers / ambiguous spelling prompts)
const zhSeen = new Map();
const zhDup = [];
for (const w of allWords) {
  if (zhSeen.has(w.zh)) zhDup.push(`${w.zh} (${zhSeen.get(w.zh)} / ${w.en})`);
  else zhSeen.set(w.zh, w.en);
}
assert(zhDup.length === 0, `zh is unique across 850 (dups: ${zhDup.join('; ') || 'none'})`);

// zh: no stray ascii letters / whitespace weirdness
const badZh = allWords.filter(w => /[A-Za-z]/.test(w.zh) || w.zh !== w.zh.trim());
assert(badZh.length === 0,
  `zh has no ascii letters or stray whitespace (${badZh.map(w => w.en).join(', ') || 'none'})`);

// Emoji coverage for picturable words (best-effort file; only validated when present)
const emojiPath = path.join(__dirname, '..', 'emoji-data.js');
if (fs.existsSync(emojiPath)) {
  const esb = {};
  vm.createContext(esb);
  vm.runInContext(fs.readFileSync(emojiPath, 'utf8'), esb);
  const WORD_EMOJI = vm.runInContext('typeof WORD_EMOJI === "undefined" ? {} : WORD_EMOJI', esb);
  const picturable = WORD_DATA.categories.find(c => c.id === 'picturable').words;
  const missing = picturable.filter(w => !WORD_EMOJI[w.en] || typeof WORD_EMOJI[w.en] !== 'string');
  assert(missing.length === 0,
    `every picturable word has an emoji (missing: ${missing.map(w => w.en).join(', ') || 'none'})`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app');

const HORIZON_STEP = 3;

// Runs one horizon answer the way landingSend does: interpretInput first, then parse()
function horizonFor(app, text) {
  const fi = app.interpretInput(text.toLowerCase().trim(), HORIZON_STEP);
  if (fi.type === 'clarify') return { clarify: fi.message };
  if (fi.type === 'fallback') return { horizon: fi.value };
  app.LANDING_QUESTIONS[HORIZON_STEP].parse(text);
  return { horizon: app.collectedState.horizon };
}

test('normaliseNumber reads Norwegian number formats', () => {
  const { normaliseNumber } = loadApp();
  const cases = {
    '5 000 kr/mnd': 5000,
    '1 000 000': 1000000,
    '1.000.000 kr': 1000000,
    '50k': 50000,
    '1,5 mill': 1500000,
    '1,5 millioner': 1500000,
    '2 tusen': 2000,
    'Jeg kan spare 3000 i måneden': 3000,
    'ca. 4%': 4,
    '4,5': 4.5,
    '0,045': 0.045,
    'ingen tall her': null,
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normaliseNumber(input), expected, input);
  }
});

test('amount parser keeps monthly, lump sum or both', () => {
  const app = loadApp();
  const cases = [
    ['5 000 kr/mnd', 5000, 0],
    ['200 000 kr engangsbeløp', 0, 200000],
    ['Jeg kan spare 3000 i måneden', 3000, 0],
    ['50k/mnd', 50000, 0],
    ['1,5 mill engangsbeløp', 0, 1500000],
    ['5 000 kr/mnd og 100 000 kr engangsbeløp', 5000, 100000],
    ['100k engangs + 2000 i måneden', 2000, 100000],
  ];
  for (const [input, monthly, lump] of cases) {
    app.LANDING_QUESTIONS[0].parse(input);
    assert.equal(app.collectedState.monthly, monthly, `${input} (monthly)`);
    assert.equal(app.collectedState.lumpSum, lump, `${input} (lump)`);
  }
});

test('amount without any number asks again instead of moving on', () => {
  const app = loadApp();
  assert.equal(app.interpretInput('begge deler', 0).type, 'clarify');
  assert.equal(app.interpretInput('5 000 kr/mnd', 0).type, 'understood');
});

test('every horizon quick button is accepted and lands in its own bucket', () => {
  const app = loadApp();
  const expected = { 'Under 3 år': 1, '3–6 år': 2, '6–10 år': 3, '10–15 år': 4, 'Over 15 år': 5 };
  for (const [label, bucket] of Object.entries(expected)) {
    const r = horizonFor(app, label);
    assert.equal(r.clarify, undefined, `${label} must not trigger a clarify loop`);
    assert.equal(app.hBucket(r.horizon), bucket, label);
  }
});

test('typed horizons are read as numbers', () => {
  const app = loadApp();
  const cases = {
    '20 år': 20,
    '5 år': 5,
    'ca. 20 år': 20,
    'om 7 år': 7,
    '12': 12,
    '18 måneder': 2,
    '60 år': 40, // clamped to the 40-year MC data
    'mellom 5 og 10 år': 8,
    '5-8 år': 7,
    'jeg er 30 og vil pensjonere meg ved 67': 37,
  };
  for (const [input, years] of Object.entries(cases)) {
    assert.deepEqual(horizonFor(app, input), { horizon: years }, input);
  }
});

test('vague or age-only horizons ask a follow-up', () => {
  const app = loadApp();
  for (const input of ['vet ikke', 'jeg er 30 år', 'lenge', 'snart', 'ikke bestemt meg']) {
    assert.ok(horizonFor(app, input).clarify, input);
  }
});

const LANDING_ANSWERS = [
  '5 000 kr/mnd',
  'Ja, godt over 3 måneder',
  'Nei, ingen gjeld',
  'Over 15 år',
  'Høy — jeg vil ha maksimal vekst over tid',
  'Holde på og vente',
];
const recCount = bubbles => bubbles.filter(b => b.innerHTML.includes('rec-box')).length;

test('landing flow completes with quick buttons and delivers exactly one recommendation', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  assert.equal(app.collectedState.horizon, 20);
  assert.equal(recCount(app.landingBubbles()), 1);

  app.sayLanding('Nei, dette er nok');
  app.sayLanding('noe annet');
  assert.equal(recCount(app.landingBubbles()), 1, 'follow-up input must not re-deliver');
});

test('"Ja, vis meg full analyse" opens the advisory tool', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');
  assert.equal(app.advMode, 'ai');
  assert.equal(recCount(app.landingBubbles()), 1);
});

test('advisory chat delivers exactly one recommendation', () => {
  const app = loadApp();
  app.chooseMode('ai');
  [
    'Nei, nybegynner',
    '10 000 kr/mnd',
    'Ca. 1–2 måneder',
    'Ja, boliglån',
    'Ca. 4%',
    'Lønn 600 000, utgifter 350 000',
    'Under 3 år',
    'Middels — litt svingninger er ok',
    'Selge noe for å redusere risiko',
  ].forEach(a => app.sayAdv(a));
  assert.equal(app.collectedState.horizon, 2);
  assert.equal(app.collectedState.mortgageRate, 0.04);
  assert.equal(recCount(app.advBubbles()), 1);

  app.sayAdv('hva nå?');
  assert.equal(recCount(app.advBubbles()), 1, 'follow-up input must not re-deliver');
});

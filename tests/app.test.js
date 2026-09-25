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

const lastChart = app => app.charts[app.charts.length - 1];
const datasetLabels = chart => chart.data.datasets.map(d => d.label);
const LOW_RISK_ANSWERS = [
  '100 000 kr engangsbeløp',
  'Ja, godt over 3 måneder',
  'Nei, ingen gjeld',
  'Under 3 år',
  'Lav — jeg vil ha stabilt og trygt',
  'Holde på og vente',
];

test('bank recommendation (0% aksjer) draws no Investering line', () => {
  const app = loadApp();
  LOW_RISK_ANSWERS.forEach(a => app.sayLanding(a));
  const rec = app.landingBubbles().find(b => b.innerHTML.includes('rec-box'));
  assert.match(rec.innerHTML, /0% aksjer · Høyrentekonto/);

  const chart = lastChart(app);
  assert.deepEqual(datasetLabels(chart), ['Bankkonto']);
  const note = app.el('landingChartWrap').innerHTML;
  assert.doesNotMatch(note, /forventet årlig avkastning/);
  assert.doesNotMatch(note, /Investering/);
});

test('equity recommendation still draws the Investering line', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  assert.deepEqual(datasetLabels(lastChart(app)), ['Investering', 'Bankkonto']);
});

test('bond part of the blended return is taxed 22% (bond funds are not ASK-eligible)', () => {
  const app = loadApp();
  const oneYear = stockFraction => {
    app.renderLandingChart({ lumpSum: 100000, monthly: 0, years: 1, stockFraction });
    return lastChart(app).data.datasets[0].data[0];
  };
  const STOCK = 0.07, BOND_NET = 0.04 * 0.78, CASH_NET = 0.025 * 0.78;
  for (const s of [1, 0.8, 0.5, 0.2]) {
    const r = s * STOCK + (1 - s) * 0.5 * BOND_NET + (1 - s) * 0.5 * CASH_NET;
    assert.equal(oneYear(s), Math.round(100000 * (1 + r)), `${s * 100}% aksjer`);
  }
  // 50/50: 3.5% + 0.78% + 0.4875% ≈ 4.8% (was 5.0% with untaxed bonds)
  app.renderLandingChart({ lumpSum: 100000, years: 1, stockFraction: 0.5 });
  assert.match(app.el('landingChartWrap').innerHTML, /4\.8% forventet årlig avkastning \(50% aksjer\)/);
});

test('advisory results label 0% aksjer as bank, not bonds', () => {
  const app = loadApp();
  // 1–3 år: Meget lav → "Bank", Lav → numeric 0; both are recommended as høyrentekonto
  for (const riskLabel of ['Meget lav', 'Lav']) {
    const r = app.renderResults({ horizon: 2, monthly: 5000, riskLabel });
    assert.equal(r.pAlloc, 0, riskLabel);
    assert.equal(app.el('profileName').textContent, 'Bankkonto', riskLabel);
    assert.equal(app.el('profileSub').textContent, '0% aksjer · 100% bankinnskudd', riskLabel);
    assert.equal(app.el('allocBLabel').textContent, 'Bankinnskudd', riskLabel);
    assert.doesNotMatch(app.el('allocStrip').innerHTML, /#c9a84c/, riskLabel);
  }
});

test('advisory results keep the bond label for mixed allocations', () => {
  const app = loadApp();
  app.renderResults({ horizon: 2, monthly: 5000, riskLabel: 'Lav' }); // bank first, then switch back
  app.renderResults({ horizon: 20, monthly: 5000, riskLabel: 'Middels' });
  assert.equal(app.el('profileSub').textContent, '65% aksjer · 35% obligasjoner');
  assert.equal(app.el('allocBLabel').textContent, 'Obligasjoner');
  assert.match(app.el('allocStrip').innerHTML, /#c9a84c/);
});

test('bank allocation is not charged fund fees', () => {
  const app = loadApp();
  const base = { horizon: 2, monthly: 5000, startCapital: 100000, riskLabel: 'Lav' };
  const cheap = app.renderResults({ ...base, costB: 0 });
  const pricey = app.renderResults({ ...base, costB: 0.02 });
  assert.equal(cheap.p50, pricey.p50);
});

test('advisory chart hides the dashed Bankkonto line when the recommendation is bank', () => {
  const app = loadApp();
  app.renderResults({ horizon: 2, monthly: 5000, riskLabel: 'Lav' });
  assert.deepEqual(datasetLabels(lastChart(app)), ['95%', 'Forventet', '5%']);
  assert.ok(app.el('legendBank').classList.contains('hidden'));

  app.renderResults({ horizon: 20, monthly: 5000, riskLabel: 'Middels' });
  assert.deepEqual(datasetLabels(lastChart(app)), ['95%', 'Forventet', '5%', 'Bankkonto']);
  assert.ok(!app.el('legendBank').classList.contains('hidden'));
});

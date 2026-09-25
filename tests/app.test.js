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

// ── Buffer først ──
const answersWith = changes => LANDING_ANSWERS.map((a, i) => changes[i] ?? a);
const recBubble = bubbles => bubbles.find(b => b.innerHTML.includes('rec-box')).innerHTML;

test('no buffer: recommendation is "bygg buffer først", then the full allocation', () => {
  const app = loadApp();
  // Høy + 6–10 år = 80%; no buffer used to step this down to 65%
  answersWith({ 1: 'Nei, ingen buffer', 3: '6–10 år' }).forEach(a => app.sayLanding(a));
  const rec = recBubble(app.landingBubbles());
  assert.match(rec, /Min anbefaling: bygg buffer først/);
  assert.match(rec, /Nå:<\/strong> 100% høyrentekonto — til du har minst én måneds utgifter i buffer/);
  assert.match(rec, /Deretter:<\/strong> 80% aksjer/);
  assert.match(rec, /Ikke begynn å investere før dette er på plass/);
  assert.match(rec, /Først når bufferen er på plass, anbefaler jeg å begynne å investere/);
  assert.match(app.el('landingChartWrap').innerHTML, /Investeringen gjelder først når bufferen er bygget opp/);
});

test('1–3 months buffer: invest now, with a tip to build the buffer', () => {
  const app = loadApp();
  answersWith({ 1: 'Ca. 1–2 måneder' }).forEach(a => app.sayLanding(a));
  const rec = recBubble(app.landingBubbles());
  assert.doesNotMatch(rec, /bygg buffer først/);
  assert.match(rec, /100% aksjer/);
  assert.match(rec, /Buffertips/);
});

test('no buffer with a bank recommendation keeps the normal box and buffer note', () => {
  const app = loadApp();
  answersWith({ 1: 'Nei, ingen buffer', 3: 'Under 3 år', 4: 'Lav — jeg vil ha stabilt og trygt' }).forEach(a => app.sayLanding(a));
  const rec = recBubble(app.landingBubbles());
  assert.doesNotMatch(rec, /bygg buffer først/);
  assert.match(rec, /0% aksjer · Høyrentekonto/);
  assert.match(rec, /nesten ingen buffer/);
});

test('manual form: 0 months buffer triggers buffer-first with amounts from expenses', () => {
  const app = loadApp();
  app.renderResults({ horizon: 20, monthly: 5000, bufferMonths: 0, expenses: 360000, riskLabel: 'Høy', showRecBox: true });
  const box = app.el('recBoxContent').innerHTML;
  assert.match(box, /bygg buffer først/);
  assert.match(box, /minst én måneds utgifter \(ca\. 30\s000 kr\)/);
  assert.match(box, /3 måneders utgifter \(ca\. 90\s000 kr\)/);
  assert.match(app.el('riskBanner').innerHTML, /Bygg buffer først/);
});

// ── Dybdeanalyse gjenbruker svarene fra forsiden ──
const AMOUNT_QUESTION = /Hvor mye penger snakker vi om/;
const aiText = bubbles => bubbles.map(b => b.innerHTML).join('\n');

test('full analysis reuses landing answers and only asks experience and income', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');

  const intro = app.advBubbles()[0].innerHTML;
  assert.match(intro, /svarene dine fra forsiden/);
  assert.match(intro, /Beløp:<\/strong> 5\s000 kr\/mnd/);
  assert.match(intro, /Tidshorisont:<\/strong> 20 år/);
  assert.match(intro, /Risikovilje:<\/strong> Høy/);

  app.sayAdv('Nei, nybegynner');
  app.sayAdv('Lønn 600 000, utgifter 360 000');
  const text = aiText(app.advBubbles());
  assert.doesNotMatch(text, AMOUNT_QUESTION);
  assert.doesNotMatch(text, /Når ser du for deg å bruke pengene/);
  assert.match(text, /Godt å vite før du starter/);
  assert.equal(recCount(app.advBubbles()), 1);
  assert.equal(app.collectedState.horizon, 20);
  assert.equal(app.collectedState.expenses, 360000);
});

test('mortgage rate from the landing page is not asked again', () => {
  const app = loadApp();
  const answers = answersWith({ 2: 'Ja, boliglån' });
  answers.splice(3, 0, 'Ca. 5%');
  answers.forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');
  assert.match(app.advBubbles()[0].innerHTML, /Boliglån:<\/strong> ja, ca\. 5% rente/);
  app.sayAdv('Ja, erfaring med fond/verdipapirer');
  app.sayAdv('Lønn 600 000, utgifter 360 000');
  assert.doesNotMatch(aiText(app.advBubbles()), /hvilken rente/);
  assert.equal(recCount(app.advBubbles()), 1);
});

test('"Endre svarene mine" restarts the full question flow', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');
  assert.doesNotMatch(aiText(app.advBubbles()), AMOUNT_QUESTION);
  app.sayAdv('Endre svarene mine');
  app.sayAdv('Nei, nybegynner');
  assert.match(aiText(app.advBubbles()), AMOUNT_QUESTION);
});

test('advisory without the landing flow still asks every question', () => {
  const app = loadApp();
  app.chooseMode('ai');
  app.sayAdv('Nei, nybegynner');
  assert.match(aiText(app.advBubbles()), AMOUNT_QUESTION);
});

test('buffer-first in the full analysis uses the given expenses', () => {
  const app = loadApp();
  answersWith({ 1: 'Nei, ingen buffer' }).forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');
  app.sayAdv('Nei, nybegynner');
  app.sayAdv('Lønn 600 000, utgifter 360 000');
  const rec = recBubble(app.advBubbles());
  assert.match(rec, /bygg buffer først/);
  assert.match(rec, /ca\. 30\s000 kr/);
  assert.match(app.el('riskBanner').innerHTML, /minst én måneds utgifter \(ca\. 30\s000 kr\)/);
});

test('opening the full analysis again keeps the finished advisory chat', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');
  app.sayAdv('Nei, nybegynner');
  app.sayAdv('Lønn 600 000, utgifter 360 000');
  app.sayLanding('Ja, vis meg full analyse');
  assert.equal(recCount(app.advBubbles()), 1);
});

// ── Sikkerhet ──
test('user input is shown as text, never parsed as HTML', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const landing = loadApp();
  landing.sayLanding(payload);
  const lb = landing.landingBubbles().find(b => b.className === 'bubble user');
  assert.equal(lb.textContent, payload);
  assert.equal(lb.innerHTML, '');

  const adv = loadApp();
  adv.chooseMode('ai');
  adv.sayAdv(payload);
  const ab = adv.advBubbles().find(b => b.className === 'bubble user');
  assert.equal(ab.textContent, payload);
  assert.equal(ab.innerHTML, '');
});

test('every external script is pinned with an integrity hash', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const tags = html.match(/<script\s[^>]*src=[^>]*>/g) || [];
  assert.ok(tags.length >= 2);
  assert.doesNotMatch(html, /<script[^>]*html2canvas/, 'html2canvas is no longer used');
  for (const tag of tags) {
    assert.match(tag, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/[^"@]+@\d+\.\d+\.\d+\//, tag); // exact version
    assert.match(tag, /integrity="sha384-[A-Za-z0-9+/]{64}"/, tag);
    assert.match(tag, /crossorigin="anonymous"/, tag);
  }
});

// ── PDF ──
const WIN1252 = /^[\n\x20-\x7E\xA1-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;
const fakeBtn = () => ({ disabled: false, textContent: '' });
function assertPrintable(pdf) {
  for (const t of pdf.texts) assert.match(t, WIN1252, `not printable with the built-in PDF font: ${JSON.stringify(t)}`);
}

test('pdfSafe/htmlToText keep Norwegian text and drop what the PDF font cannot print', () => {
  const app = loadApp();
  assert.equal(app.pdfSafe('💡 Min anbefaling: æøå ÆØÅ – « » ≈ 5\u00a0000 kr'), 'Min anbefaling: æøå ÆØÅ – « » ca. 5 000 kr');
  assert.equal(app.htmlToText('<strong>Nå:</strong> 100%<br>neste &amp; siste'), 'Nå: 100%\nneste & siste');
});

test('landing PDF contains recommendation, assumptions, values and the chart', () => {
  const app = loadApp();
  const answers = answersWith({ 0: '5 000 kr/mnd og 100 000 kr engangsbeløp', 2: 'Ja, boliglån' });
  answers.splice(3, 0, 'Ca. 4,5%');
  answers.forEach(a => app.sayLanding(a));
  const btn = fakeBtn();
  app.downloadLandingPDF(btn);
  const pdf = app.lastPdf();
  assert.equal(pdf.saved, 'kapitalkompasset-anbefaling.pdf');
  const text = pdf.allText();
  for (const s of ['Min anbefaling', '100% aksjer', 'Slik kommer du i gang', 'Forutsetninger',
    '5 000 kr/mnd + 100 000 kr engangsbeløp', 'ja, ca. 4,5% rente', '20 år', 'Høy', 'holde på og vente',
    '3 måneder eller mer', 'Beregningsgrunnlag', 'Verdi etter 20 år', 'Nedbetaling boliglån', 'Side 1 av 2', 'Side 2 av 2']) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
  assert.equal(pdf.images.length, 1, 'chart image');
  assertPrintable(pdf);
  assert.equal(btn.disabled, false);
});

test('buffer-first PDF shows both stages', () => {
  const app = loadApp();
  answersWith({ 1: 'Nei, ingen buffer' }).forEach(a => app.sayLanding(a));
  app.downloadLandingPDF(fakeBtn());
  const text = app.lastPdf().allText();
  assert.match(text, /Min anbefaling: bygg buffer først/);
  assert.match(text, /Nå: 100% høyrentekonto/);
  assert.match(text, /Deretter: 100% aksjer/);
  assert.match(text, /under 1 måned/);
});

test('advisory PDF (AI) includes income, costs and simulated results', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  app.sayLanding('Ja, vis meg full analyse');
  app.sayAdv('Nei, nybegynner');
  app.sayAdv('Lønn 600 000, utgifter 360 000');
  assert.ok(app.advBubbles().some(b => b.innerHTML.includes('downloadAdvisoryPDF')), 'PDF button in the chat');
  app.downloadAdvisoryPDF(fakeBtn());
  const pdf = app.lastPdf();
  assert.equal(pdf.saved, 'kapitalkompasset-analyse.pdf');
  const text = pdf.allText();
  for (const s of ['Din fullstendige analyse', 'Erfaring', 'Nybegynner', 'Inntekt etter skatt', '600 000 kr/år',
    '360 000 kr/år', 'Monte Carlo', 'aksjefond 0,7%', 'Forventet verdi (median)', 'Pessimistisk (5%)', 'Tidshorisont']) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
  assert.equal(pdf.images.length, 1);
  assertPrintable(pdf);
});

test('advisory PDF (manual form) lists the form values and the assumed behaviour', () => {
  const app = loadApp();
  const vals = { startCapital: '50000', monthlySavings: '3000', horizon: '12', income: '500000', expenses: '300000',
    bufferMonths: '4', costStocks: '0.5', costBonds: '0.2' };
  for (const [id, v] of Object.entries(vals)) app.el(id).value = v;
  app.chooseMode('manual');
  app.calculate();
  app.downloadAdvisoryPDF(fakeBtn());
  const text = app.lastPdf().allText();
  for (const s of ['Startkapital', '50 000 kr', '3 000 kr/mnd', '12 år', 'Offensiv', 'ikke spurt', '4 måneders utgifter',
    'aksjefond 0,5%', 'rentefond 0,2%', 'Resultat etter 12 år']) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
});

test('a chart that cannot be drawn is stated in the PDF instead of silently missing', () => {
  const app = loadApp();
  LANDING_ANSWERS.forEach(a => app.sayLanding(a));
  app.chartImage.url = '';
  app.downloadLandingPDF(fakeBtn());
  const pdf = app.lastPdf();
  assert.equal(pdf.images.length, 0);
  assert.match(pdf.allText(), /Grafen kunne ikke tegnes/);
});

test('PDF before any recommendation reports an error on the button instead of throwing', () => {
  const app = loadApp();
  const btn = fakeBtn();
  app.downloadAdvisoryPDF(btn);
  assert.equal(app.pdfs.length, 0);
  assert.equal(btn.disabled, false);  // re-enabled (timers run synchronously in tests)
});

// ── Tallformat, Nullstill, knapper og modell ──
test('amounts use Norwegian decimal comma', () => {
  const { fmt } = loadApp();
  assert.equal(fmt(2850000), '2,85 mill kr');
  assert.equal(fmt(1500000000), '1,50 mrd kr');
  assert.match(fmt(30000), /^30\s000 kr$/);
});

test('Nullstill cancels chat messages still on their way', () => {
  const app = loadApp({ manualTimers: true });
  app.flushTimers();                     // greeting
  app.sayLanding('5 000 kr/mnd');        // queues the buffer question
  app.resetSession();
  app.flushTimers();
  const text = app.landingBubbles().map(b => b.innerHTML + b.textContent).join('\n');
  assert.doesNotMatch(text, /Har du en buffer/, 'old question must not appear after reset');
  assert.doesNotMatch(text, /5 000 kr\/mnd/, 'old answer is cleared');
  assert.equal(app.landingBubbles().length, 1, 'exactly one fresh greeting, no leftovers or duplicates');
  assert.match(text, /La oss finne ut hva som passer best/);
  assert.equal(app.landingStep, 0);
});

test('Nullstill clears stored results so no stale PDF can be made', () => {
  const app = loadApp();
  app.renderResults({ horizon: 20, monthly: 5000, riskLabel: 'Middels' });
  app.resetSession();
  app.downloadAdvisoryPDF(fakeBtn());
  assert.equal(app.pdfs.length, 0);
});

test('risk willingness and reaction to a fall accept the buttons only', () => {
  const app = loadApp();
  LANDING_ANSWERS.slice(0, 4).forEach(a => app.sayLanding(a));
  assert.equal(app.landingStep, 4);
  assert.equal(app.el('landingInput').disabled, true);
  assert.match(app.el('landingInput').placeholder, /Velg et av alternativene/);
  const before = app.landingBubbles().length;
  app.sayLanding('ganske høy');         // typed text is ignored
  assert.equal(app.landingStep, 4);
  assert.equal(app.landingBubbles().length, before);
  app.sayLanding(LANDING_ANSWERS[4]);   // a button label is accepted
  assert.equal(app.landingStep, 5);
  assert.equal(app.el('landingInput').disabled, true);
  app.sayLanding(LANDING_ANSWERS[5]);
  assert.equal(app.el('landingInput').disabled, false, 'input is back after the recommendation');
});

test('amounts, buffer and horizon can still be typed', () => {
  const app = loadApp();
  for (const a of ['Jeg sparer 4000 i måneden', '2 måneder', 'Nei, ingen gjeld']) {
    assert.equal(app.el('landingInput').disabled, false, a);
    app.sayLanding(a);
  }
  assert.equal(app.el('landingInput').disabled, false);
  app.sayLanding('12 år');
  assert.equal(app.collectedState.monthly, 4000);
  assert.equal(app.collectedState.horizon, 12);
});

test('advisory chat: risk steps are buttons only too', () => {
  const app = loadApp();
  app.chooseMode('ai');
  ['Nei, nybegynner', '10 000 kr/mnd', 'Ja, godt over 3 måneder', 'Nei, ingen gjeld', 'Lønn 600 000, utgifter 350 000', '20 år']
    .forEach(a => app.sayAdv(a));
  assert.equal(app.advStep, 6);
  assert.equal(app.el('advInput').disabled, true);
  app.sayAdv('offensiv tror jeg');
  assert.equal(app.advStep, 6);
});

test('a 65% allocation is charted between the 50% and 80% profiles, not as 50%', () => {
  const app = loadApp();
  // 10–15 år row: Lav 50%, Middels 65%, Offensiv 80%
  const run = riskLabel => app.renderResults({ horizon: 12, monthly: 5000, startCapital: 100000, riskLabel, costS: 0, costB: 0 }).p50;
  const [p50, p65, p80] = ['Lav', 'Middels', 'Offensiv'].map(run);
  assert.ok(p65 > p50 * 1.02 && p65 < p80 * 0.98, `${p50} < ${p65} < ${p80}`);
  app.renderResults({ horizon: 20, monthly: 5000, riskLabel: 'Middels' });
  app.downloadAdvisoryPDF(fakeBtn());
  assert.match(app.lastPdf().allText(), /interpolert mellom Balansert \(50% aksjer\) og Vekst \(80% aksjer\)/);
});

test('bank in the full analysis is shown after 22% tax, like the landing chart', () => {
  const app = loadApp();
  const r = app.renderResults({ horizon: 2, monthly: 0, startCapital: 100000, riskLabel: 'Lav' });
  assert.equal(r.pAlloc, 0);
  // ~2.5% before tax → ~1.9% after tax per year (untaxed data gave ~104 900)
  assert.ok(r.p50 > 103500 && r.p50 < 104100, String(r.p50));
});

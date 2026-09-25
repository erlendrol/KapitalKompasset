// Loads the inline <script> from index.html into Node with a minimal fake DOM,
// so the parsing and flow logic can be tested without a browser.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];

class FakeEl {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.scrollTop = 0;
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); },
      contains: c => classes.has(c),
    };
  }
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  scrollIntoView() {}
  getContext() { return {}; }
}

function loadApp() {
  const els = {};
  const document = {
    getElementById: id => (els[id] ||= new FakeEl(id)),
    querySelector: () => new FakeEl(),
    querySelectorAll: () => [],
    createElement: () => new FakeEl(),
  };
  // Run timers synchronously so a chat turn completes within one call
  const setTimeout = fn => fn();
  // Records every chart config so tests can inspect the drawn datasets
  const charts = [];
  const chartImage = { url: 'data:image/png;base64,' + 'A'.repeat(8000) };  // set url to '' to simulate a failed chart
  class Chart {
    constructor(ctx, cfg) { charts.push(cfg); }
    destroy() {}
    toBase64Image() { return chartImage.url; }
  }
  // Fake jsPDF: records text, images and the saved filename of every PDF
  const pdfs = [];
  class FakePdf {
    constructor() { this.texts = []; this.images = []; this.pages = 1; this.saved = null; pdfs.push(this); }
    get internal() { return { pageSize: { getWidth: () => 210, getHeight: () => 297 } }; }
    text(t) { this.texts.push(...[].concat(t)); }
    splitTextToSize(t) { return [t]; }
    getTextWidth(t) { return t.length * 1.5; }
    addImage(img) { this.images.push(img); }
    addPage() { this.pages++; }
    getNumberOfPages() { return this.pages; }
    save(name) { this.saved = name; }
    allText() { return this.texts.join('\n'); }
  }
  for (const m of ['setFont', 'setFontSize', 'setTextColor', 'setDrawColor', 'setFillColor', 'setLineWidth',
    'setLineDashPattern', 'line', 'rect', 'setPage']) FakePdf.prototype[m] = () => {};
  const window = { jspdf: { jsPDF: FakePdf } };

  const exportsSrc = `
    return {
      normaliseNumber, interpretInput, hBucket, LANDING_QUESTIONS,
      landingSend, advSend, chooseMode, renderLandingChart, renderResults, calculate,
      downloadLandingPDF, downloadAdvisoryPDF, pdfSafe, htmlToText,
      get collectedState() { return collectedState; },
      get landingStep() { return landingStep; },
      get advStep() { return advStep; },
      get advMode() { return advMode; },
    };`;
  const app = new Function('document', 'setTimeout', 'Chart', 'window', script + exportsSrc)(document, setTimeout, Chart, window);

  const bubbles = id => els[id] ? els[id].children : [];
  // Object.create keeps the live getters (spreading would snapshot them)
  return Object.assign(Object.create(app), {
    charts, pdfs, chartImage,
    lastPdf: () => pdfs[pdfs.length - 1],
    el: id => document.getElementById(id),
    landingBubbles: () => bubbles('landingMsgs'),
    advBubbles: () => bubbles('advChatHistory'),
    sayLanding(text) { document.getElementById('landingInput').value = text; app.landingSend(); },
    sayAdv(text) { document.getElementById('advInput').value = text; app.advSend(); },
  });
}

module.exports = { loadApp };

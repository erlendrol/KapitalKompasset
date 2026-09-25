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
  class Chart { constructor(ctx, cfg) { charts.push(cfg); } destroy() {} }

  const exportsSrc = `
    return {
      normaliseNumber, interpretInput, hBucket, LANDING_QUESTIONS,
      landingSend, advSend, chooseMode, renderLandingChart,
      get collectedState() { return collectedState; },
      get landingStep() { return landingStep; },
      get advStep() { return advStep; },
      get advMode() { return advMode; },
    };`;
  const app = new Function('document', 'setTimeout', 'Chart', script + exportsSrc)(document, setTimeout, Chart);

  const bubbles = id => els[id] ? els[id].children : [];
  // Object.create keeps the live getters (spreading would snapshot them)
  return Object.assign(Object.create(app), {
    charts,
    el: id => document.getElementById(id),
    landingBubbles: () => bubbles('landingMsgs'),
    advBubbles: () => bubbles('advChatHistory'),
    sayLanding(text) { document.getElementById('landingInput').value = text; app.landingSend(); },
    sayAdv(text) { document.getElementById('advInput').value = text; app.advSend(); },
  });
}

module.exports = { loadApp };

# KapitalKompasset — Developer Context

This document describes the full architecture, data structures, logic, and design philosophy of `investering_v25.html`. Read this before making any changes.

---

## Overview

KapitalKompasset is a single-file Norwegian investment advisory web app. It helps users decide what to do with their savings — producing a concrete allocation recommendation (e.g. "100% aksjer") with product suggestions, a growth chart, and educational content.

**Single file, no backend, no API calls.** All logic runs client-side in vanilla JS. The only external dependency is Chart.js from cdnjs.

**Two screens:**
1. **Landing page** (`screenLanding`) — a quick 6-question chat flow that produces a recommendation in under a minute.
2. **Advisory tool** (`screenAdvisory`) — a deeper analysis with two modes: AI advisor (8-question chat) and manual form (all inputs visible at once).

---

## File Structure

```
investering_v25.html
├── <head>              Google Fonts, Chart.js CDN
├── <style>             All CSS (~530 lines)
├── <body>
│   ├── <header>        Nav bar (Hva skal jeg gjøre? | Dybdeanalyse | ↺ Nullstill)
│   ├── #screenLanding  Landing page HTML
│   ├── #screenAdvisory Advisory tool HTML (mode chooser, left panel, results panel)
│   ├── .info-fab       Floating "Info om fondssparing" button (bottom-right)
│   └── #infoDrawer     Bottom sheet with fund education content
└── <script>            All JS (~900 lines)
    ├── Monte Carlo data (const MC)
    ├── Model logic (ALLOC_TABLE, capacity, ENG engine)
    ├── Screen/mode navigation
    ├── Manual form logic
    ├── Landing chat flow
    └── Advisory chat flow
```

---

## Core Philosophy

The tool is built around a specific investment thesis:

> **Long-term index investing is the right answer for almost everyone.** The tool should be confident about this, not hedge unnecessarily. Only genuine risk factors cause a step-down in the recommendation.

Genuine step-down triggers:
- Buffer < 1 month (hard financial vulnerability)
- Horizon < 3 years (money may be needed soon)
- Risk-averse behaviour: "selge noe" = −1 column, "selge alt" = −2 columns

Things that do NOT step down:
- "Hold still" behaviour (rational long-term behaviour = full allocation)
- Low savings rate (not a useful signal for index investors)
- Buffer 1–2 months (advisory note only, no step-down)

---

## Allocation Matrix

```javascript
const ALLOC_TABLE = [
  ["Bank","Bank","Bank","Bank","Bank","Bank"],   // <1yr  (row 0)
  ["Bank","Bank",0,    0.2,  0.35, 0.5 ],        // 1-3yr (row 1)
  ["Bank",0,    0.2,  0.35, 0.5,  0.65],         // 3-6yr (row 2)
  ["Bank",0.2,  0.35, 0.5,  0.65, 0.8 ],         // 6-10yr (row 3)
  ["Bank",0.35, 0.5,  0.65, 0.8,  1.0 ],         // 10-15yr (row 4)
  ["Bank",0.35, 0.5,  0.65, 1.0,  1.0 ]          // 15+yr (row 5)
];
```

**Columns** map to `RISK_SCORE`:
```javascript
const RISK_SCORE = { "Ingen":0, "Meget lav":1, "Lav":2, "Middels":3, "Offensiv":4, "Høy":5 }
```

**Row selection** via `hBucket(years)`:
```javascript
// <1yr→0, ≤3yr→1, ≤6yr→2, ≤10yr→3, ≤15yr→4, >15yr→5
```

**Column selection formula** (landing and advisory AI):
```javascript
behaviourPenalty = riskComfort==='C' ? 2 : riskComfort==='S' ? 1 : 0
baseCol          = RISK_SCORE[riskWillingness]   // Lav=2, Middels=3, Offensiv=4, Høy=5
finalCol         = max(0, min(cap.cappedLevel, baseCol - behaviourPenalty))
alloc            = ALLOC_TABLE[hBucket(horizon)][finalCol]
```

**The 15+yr row** gives 100% for both Offensiv (col 4) and Høy (col 5) — this is intentional.

---

## Capacity System

`capacityFromInputs(income, expenses, bufferMonths)` returns:

```javascript
{
  cappedLevel,   // 0–5: max allowed risk column (5 = no cap, 4 = buffer penalty)
  displayLevel,  // 0–4: for the visual capacity bar
  label,         // "Ingen"/"Lav"/"Middels"/"God"/"Høy"
  bufferFlag,    // 'ok' | 'low' | 'critical'
  savingsRate,
  monthlySurplus
}
```

Rules:
- `bufferMonths < 1` → `cappedLevel = 4` (one step down)
- `bufferMonths 1–3` → `cappedLevel = 5`, `bufferFlag = 'low'` (note shown, no step-down)
- `bufferMonths >= 3` → `cappedLevel = 5`, `bufferFlag = 'ok'`

Savings rate does **not** cap equity — it was removed as it was the wrong signal for long-term investors.

---

## collectedState

Shared state object populated by both the landing flow and advisory chat. Reset by `resetSession()`.

```javascript
let collectedState = {
  lumpSum: 0,           // kr, one-time investment
  monthly: 0,           // kr/month savings
  horizon: 15,          // years
  bufferMonths: 3,      // months of expenses as buffer
  hasDebt: false,       // boolean (only mortgage is tracked)
  mortgageRate: 0.03,   // decimal (e.g. 0.04 = 4%)
  debtLabel: 'lån',     // 'boliglån' | 'lån' — used in chart legend
  riskWillingness: 'Offensiv',  // 'Lav'|'Middels'|'Offensiv'|'Høy'
  riskComfort: 'N',     // 'C'(sell all)|'S'(sell some)|'N'(hold)|'A'(buy more)
  income: 0,            // annual after-tax income (kr)
  expenses: 0,          // annual expenses (kr)
  suitability: 'beginner', // 'expert'|'beginner'
  q1Score: 2            // legacy field, not currently used
};
```

---

## Recommendation Engine (ENG)

A compact JSON object (~8kb inline). Keys are equity allocation percentages: `"0"`, `"20"`, `"35"`, `"50"`, `"65"`, `"80"`, `"100"`.

```javascript
const ENG = {
  titles: {            // per key × per riskComfort (C/S/N/A)
    "80": { C: "...", N: "...", A: "..." }
  },
  horizonNotes: {      // S/M/L/VL — shown after title
    "S": "Med kort tidshorisont...",
    "VL": "Svært lang horisont..."
  },
  bufferNotes: {       // L/M/H — legacy, not currently rendered
    "L": "⚠️ Bufferen din er lav...",
    "M": "Bufferen er OK...",
    "H": ""
  },
  products: {          // short alloc-line text (no "X% aksjer ·" prefix — added by buildRecHTML)
    "80": "Kombinasjonsfond med 80% aksjer i ASK",
    "100": "Globalt aksjeindeksfond i ASK"
  },
  nextSteps: {         // full "Slik kommer du i gang" HTML — self-contained, includes bank helper
    "80": "Opprett en <strong>ASK...</strong>..."
  },
  flipNotes: {         // legacy, not currently rendered
    "80": "..."
  }
}
```

**`allocToEngKey(fraction)`** — maps a float (0.0–1.0) to the nearest key string:
```javascript
keys = [0, 20, 35, 50, 65, 80, 100]
// e.g. 0.8 → "80", 1.0 → "100", 0.52 → "50"
```

**Important:** `ENG.products` keys do **not** include the percentage prefix. `buildRecHTML` adds `${pAllocPct}% aksjer · ` in front. Do not add the prefix to product strings.

---

## buildRecHTML

The single function that assembles the recommendation box HTML. Used by all three paths (landing, advisory AI, manual form).

```javascript
function buildRecHTML(engKey, hKey, bKey, rChar, bufferNoteHTML, horizNote, pAllocPct)
```

Parameters:
- `engKey` — "0"|"20"|"35"|"50"|"65"|"80"|"100"
- `hKey` — "S"|"M"|"L"|"VL" (horizon bucket, from `hKeyFromYears`)
- `bKey` — "L"|"M"|"H" (buffer bucket, from `bufKey`)
- `rChar` — "C"|"S"|"N"|"A" (risk behaviour character)
- `bufferNoteHTML` — output of `bufferAdvisoryNote()`, or empty string
- `horizNote` — legacy, pass `''`
- `pAllocPct` — integer 0–100 (the actual allocation percentage)

Output structure:
```html
<div class="rec-box">
  <div class="rec-title">💡 Min anbefaling</div>
  <div class="alloc-line">{pAllocPct}% aksjer · {ENG.products[engKey]}</div>
  <div class="next-step">📋 Slik kommer du i gang: {ENG.nextSteps[engKey]}</div>
  <div class="flip-note">📚 [info drawer link]</div>
</div>
{bufferNoteHTML}
{disclaimer}
```

---

## Landing Page Flow

6-step sequential chat. Questions are defined in `LANDING_QUESTIONS[0..5]`.

| Step | Question | Key output |
|------|----------|------------|
| 0 | Amount (lump/monthly/both) | `collectedState.lumpSum` / `.monthly` |
| 1 | Buffer (>3mnd / 1-2mnd / none) | `collectedState.bufferMonths` |
| 2 | Boliglån y/n (+ rate follow-up if yes) | `collectedState.hasDebt`, `.mortgageRate`, `.debtLabel` |
| 3 | Horizon (5 options) | `collectedState.horizon` |
| 4 | Risk willingness (Lav/Middels/Offensiv/Høy) | `collectedState.riskWillingness` |
| 5 | Risk behaviour (sell all/some/hold/buy) | `collectedState.riskComfort` |

After step 5: `deliverLandingRec()` computes allocation, builds rec-box, renders chart.

**Debt follow-up logic:** If user answers "Ja, boliglån" at step 2 and `!askedDebtRate`, an extra rate question fires. `landingStep` stays at 2 during this. After the rate is answered, `landingStep` increments to 3 normally.

---

## Advisory AI Flow

8-step chat. Steps 1–7 reuse `LANDING_QUESTIONS[n].parse()` for consistency.

| Step | Question | Key output |
|------|----------|------------|
| 0 | Suitability (expert/nybegynner) | `collectedState.suitability` |
| 1 | Amount | Same as landing step 0 |
| 2 | Buffer | Same as landing step 1 |
| 3 | Boliglån y/n (+ rate follow-up) | Same as landing step 2 |
| 4 | Income + expenses | `collectedState.income`, `.expenses` |
| 5 | Horizon | Same as landing step 3 |
| 6 | Risk willingness | Same as landing step 4 |
| 7 | Risk behaviour | Same as landing step 5 |

**Nybegynner flow:** After step 0, if `suitability==='beginner'`, a "Godt å vite" info box is injected before step 1's question.

**Debt follow-up:** Same logic as landing — `advAskedDebtRate` flag, fires between steps 3 and 4.

After step 7: `deliverAdvRec()` computes allocation using the same formula as `deliverLandingRec()`, builds rec-box HTML in the chat, and calls `renderResults()` to update the right-side panel.

---

## Advisory Manual Form

All inputs visible simultaneously. User adjusts and clicks "Beregn anbefaling".

Key inputs:
- Suitability pills (Erfaring / Utdanning / Ingen erfaring) — controls visibility of "Godt å vite" box
- Buffer, income, expenses, assets, debt number fields
- Risk pills (Lav / Middels / Offensiv / Høy / **Usikker — svar på spørsmål**)
  - "Usikker" shows the MC battery (4 questions) via `toggleMCBlock(true)`
  - MC battery computes a risk level and sets `selectedRisk`
- Horizon slider (1–40yr, **default 20yr**)
- Start capital, monthly savings
- Cost % inputs

`calculate()` → `renderResults({..., riskLabel: selectedRisk, showRecBox: true, riskComfort: 'N'})`.

When `showRecBox: true`, `renderResults` also injects `buildRecHTML(...)` into `#recBoxContent` below the chart.

**Important:** Manual mode has no risk behaviour question. `riskComfort` is assumed `'N'` (neutral/hold) — the risk willingness pill provides the full column selection without penalty.

---

## renderResults

The main MC chart renderer. Called by both `deliverAdvRec()` and `calculate()`.

```javascript
renderResults({
  startCapital,    // kr
  monthly,         // kr/month
  horizon,         // years
  income,          // kr/year (for capacity calculation)
  expenses,        // kr/year
  bufferMonths,    // months
  costS,           // e.g. 0.007 (0.7%)
  costB,           // e.g. 0.003 (0.3%)
  riskLabel,       // 'Lav'|'Middels'|'Offensiv'|'Høy' etc.
  skipBanner,      // boolean — suppress the risk-adjusted banner
  showRecBox,      // boolean — inject rec-box into #recBoxContent (manual mode only)
  riskComfort      // 'C'|'S'|'N'|'A' — used when showRecBox=true
})
```

Internally:
1. Runs `capacityFromInputs` to get `cap`
2. Runs `applyCapacity(riskLabel, cap)` to get `ar` (the actual risk label after capacity cap)
3. Looks up `ALLOC_TABLE[hBucket(horizon)][RISK_SCORE[ar]]`
4. Finds nearest MC profile via `profForAlloc(pAlloc)`
5. Computes p5/p50/p95 paths with cost drag
6. Renders Chart.js line chart into `#mainChart`
7. If `showRecBox`: builds and injects `buildRecHTML(...)` into `#recBoxContent`

**MC profiles used:** Forsiktig (0% stocks), Moderat (30%), Balansert (50%), Vekst (80%), Offensiv (100%), Bankkonto. These map via `profForAlloc()` which picks the nearest profile by stocks fraction.

---

## renderLandingChart

Landing-only growth illustration. No MC — uses flat expected returns.

```javascript
renderLandingChart({
  lumpSum, monthly, years,
  mortgageRate,     // nominal rate
  debtLabel,        // 'boliglån'|'lån' — used in legend
  stockFraction,    // 0.0–1.0 — drives blended expected return
  includeInvest,    // boolean
  includeMortgage   // boolean
})
```

**Return rates (tax-adjusted):**
- Stocks: 7.0% (unchanged — ASK defers capital gains tax)
- Bank: 2.5% nominal × (1 − 0.22) = **1.95% net**
- Mortgage: `mortgageRate × (1 − 0.22)` = net effective return from paying down
- Blended invest return: `stockFraction×7% + nonStock×0.5×4% + nonStock×0.5×1.95%`

Chart note states: "basert på X% forventet årlig avkastning etter kostnader. Bankkonto og nedbetaling av lån er vist netto etter 22% skatt..."

---

## Mode Toggle System

```
goScreen('advisory')
    └── modeChooser shown (centred card)
        ├── chooseMode('ai')   → _applyMode('ai')  + initAdvChat()
        └── chooseMode('manual') → _applyMode('manual') + prefillManualFromState()

switchMode('ai'|'manual')   (via top mode-switch bar, after initial choice)
    └── _applyMode(mode)
        ├── shows/hides #aiChatPane / #manualPane in #advLeftPanel
        └── updates pill styling
```

`prefillManualFromState()` copies `collectedState` values into the manual form inputs when switching from AI to manual mid-session.

---

## Info Drawer

Bottom sheet with fund education content. Triggered by:
- `.info-link` button inside every rec-box ("Mer informasjon om fondssparing her")
- `.info-fab` floating button (bottom-right, always visible)

Functions: `openInfoDrawer()` / `closeInfoDrawer()`. Backdrop click also closes.

Sections in order:
1. Hva er aksjer?
2. Hva er et aksjefond?
3. Indeksfond vs. aktivt forvaltede fond
4. Hva er et rentefond?
5. Hva er et kombinasjonsfond?
6. Om risiko og langsiktig sparing
7. Om ASK og fondskonto

---

## Session Reset

`resetSession()` (triggered by "↺ Nullstill" in nav bar):
- Resets `collectedState` to defaults
- Clears landing chat, destroys landing chart instance
- Resets advisory mode chooser, clears chat history
- Clears results panel to empty state, destroys MC chart instance
- Navigates to landing screen

---

## CSS Notes

Key CSS variables (defined in `:root`):
```css
--ink:        #1a1a2e   /* primary text */
--ink-soft:   #4a4a6a
--ink-muted:  #7a7a9a
--teal:       #2a7f7f   /* primary action colour */
--teal-light: #e8f4f4
--cream:      #f8f4ec   /* background */
--cream-dark: #ece8df
--shadow-lg:  0 8px 40px rgba(26,26,46,0.14)
```

Key layout classes:
- `.screen` / `.screen.active` — screen switching
- `.advisory-body` — flex row: `.adv-left-panel` (360px fixed) + `.advisory-results` (flex 1)
- `.landing-chat` — the chat message area on landing page
- `.rec-box` — recommendation output box (used on all three paths)
- `.buffer-note` — green advisory note (buffer warning)
- `.debt-tip` — amber inline tip (shown in debt question bubble)
- `.info-fab` — floating info button (bottom-right, fixed position)
- `.info-drawer` — bottom sheet (transform translateY for open/close)

Mobile breakpoint at `max-width: 680px`: advisory body stacks vertically, left panel gets `max-height: 55vh`.

---

## Known Quirks & Gotchas

**ENG products do not include the percentage prefix.** `buildRecHTML` prepends `${pAllocPct}% aksjer · ` automatically. If you add "80% aksjer · " to the product string you'll get a duplicate.

**15yr exactly → row 4, not row 5.** `hBucket(15) = 4` (10–15yr). At 15yr, Offensiv = 80%. Only `horizon > 15` gives Offensiv = 100%. The manual form slider defaults to 20yr to avoid confusion.

**LANDING_QUESTIONS[n] parsers are shared** with ADV_QUESTIONS where possible. If you change a landing question's parser, check whether it's also referenced by `LANDING_QUESTIONS[n].parse(txt)` in ADV_QUESTIONS.

**`deliverAdvRec` uses `riskWillingness + riskComfort`** for the allocation formula — same as `deliverLandingRec`. If you change one, change both.

**`renderResults` double-applies capacity** when called from `deliverAdvRec` — `ar` is already capacity-adjusted when passed in, then `applyCapacity` is called again inside. This is idempotent with the same inputs, so it's harmless but worth knowing.

**The `steps` field in ENG is no longer rendered.** `buildRecHTML` was updated to remove the `<ul>` steps list. The `steps` data still exists in `ENG` but is unused. You can safely delete it if you want to slim the file.

**`injectFundDisclaimer`** runs on every AI bubble. It checks for specific fund/bank names and appends a disclaimer if found. The names list is in the `FUND_NAMES` constant.

---

## What Not to Touch

- **`const MC = {...}`** — ~20kb of Monte Carlo simulation data. Do not modify. If you need to update it, replace the entire object.
- **`const ENG = {...}`** — large inline JSON. Edit targeted keys with string replacement, don't rewrite the whole block.
- **`ALLOC_TABLE`** — the core allocation matrix. Only change if the investment philosophy changes, and update this document if you do.
- **Chart.js CDN** — currently `4.4.1` from cdnjs. Don't upgrade without testing all charts.

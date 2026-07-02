// Characterization snapshots for the scheduling engine (Phase 0 of the unified-engine
// migration). Runs the real index.html script under the same DOM stubs as harness.test.js,
// but with a PINNED Date (injected via the factory param list) so every run of a fixture
// produces byte-identical output. Each fixture renders a schedule and canonicalizes
// _scheduleResult to JSON; snapshots live in snapshots/*.json and gate every refactor step:
// a pure refactor must produce a zero-byte diff on all fixtures.
//
// Usage:
//   node characterize.test.js            compare against snapshots/ (creates missing ones)
//   node characterize.test.js --update   regenerate all snapshots
//   node characterize.test.js --only=loaf-solo,bagel-solo   subset (compare/update)
//
// A titles.json snapshot inventories every emitted event title with its eventStageType
// classification — event titles are frozen API (anchors, done-marks, notes, bake-sheet
// classification all key off them), so any port that drifts a title shows up here.
const fs = require('fs');
const path = require('path');

const SNAP_DIR = path.join(__dirname, 'snapshots');
const UPDATE = process.argv.includes('--update');
const ONLY = (() => {
  const a = process.argv.find(x => x.startsWith('--only='));
  return a ? new Set(a.slice(7).split(',')) : null;
})();

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptBody = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(s => s.includes('SEED_RECIPES'));
if (!scriptBody) { console.error('Could not find main script'); process.exit(1); }

// ---- pinned clock: the app's `new Date()` / `Date.now()` return a fixed instant ----
// (Wed 2026-01-14 09:00 local — mid-winter, far from any DST transition.)
const RealDate = Date;
const FIXED_NOW = new RealDate(2026, 0, 14, 9, 0, 0, 0).getTime();
class PinnedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FIXED_NOW); else super(...args); }
  static now() { return FIXED_NOW; }
}

// ---- DOM stubs (copied from harness.test.js — kept separate so the harness is untouched) ----
function makeEl(presets = {}) {
  const store = Object.assign({ value: '', innerHTML: '', textContent: '', checked: false, disabled: false }, presets);
  const styleObj = new Proxy({ setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
    { get(t, p) { return (p in t) ? t[p] : ''; }, set(t, p, v) { t[p] = v; return true; } });
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; }, replace() {} };
  const dataset = {};
  const fn = function () { return proxy; };
  const VALUE_PROPS = ['value', 'innerHTML', 'textContent', 'checked', 'disabled'];
  const proxy = new Proxy(fn, {
    get(t, p) {
      if (VALUE_PROPS.includes(p)) return store[p];
      if (p === 'dataset') return dataset;
      if (p === 'style') return styleObj;
      if (p === 'classList') return classList;
      if (p === 'children' || p === 'childNodes' || p === 'options') return [];
      if (p === 'parentNode' || p === 'parentElement' || p === 'nextSibling' ||
          p === 'firstChild' || p === 'nextElementSibling' || p === 'previousSibling') return null;
      if (p === 'tagName') return 'DIV';
      if (p === 'nodeType') return 1;
      if (p === 'length') return 0;
      if (p === 'querySelector' || p === 'closest') return () => null;
      if (p === 'querySelectorAll') return () => [];
      if (p === 'getContext') return () => ({});
      if (p === 'getBoundingClientRect') return () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
      if (p === 'cloneNode') return () => makeEl();
      if (p === 'appendChild' || p === 'insertBefore') return (c) => c;
      if (p === Symbol.toPrimitive) return () => '';
      if (typeof p === 'symbol') return undefined;
      return proxy;
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return proxy; },
  });
  return proxy;
}

const els = {};
const presetInputs = {
  'bake-time-default-input': '',
  'coldproof-loaf-input': '',
  'coldproof-muffin-input': '',
  'coldproof-bagel-input': '',
  'build1-ratio-input': '',
  'build2-ratio-input': '',
  'deadline-default-input': '',
};
function getEl(id) {
  if (!els[id]) els[id] = makeEl(id in presetInputs ? { value: presetInputs[id] } : {});
  return els[id];
}
const documentStub = {
  getElementById: getEl,
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  createDocumentFragment: () => makeEl(),
  addEventListener() {}, removeEventListener() {},
  body: makeEl(), documentElement: makeEl(), head: makeEl(),
  title: '',
};
const localStorageStub = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    _map: m,
  };
})();
const windowStub = {
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeListener() {}, addListener() {} }),
  localStorage: localStorageStub,
  print() {}, scrollTo() {}, location: { href: '', reload() {}, hash: '' },
  requestAnimationFrame() {}, cancelAnimationFrame() {},
};

const PLAN_KEY = 'cottage-bakery-plan-v5';
const RECIPE_DEADLINES_KEY = 'whb-recipe-deadlines-v1';
function seedPlan(p) { localStorageStub.setItem(PLAN_KEY, JSON.stringify(p)); }

// Exports needed to drive fixtures — every name already exists in the app script.
const exportsTail = `
;return {
  renderSchedule,
  __sr: () => _scheduleResult,
  __setPlan: (p) => { plan = p; },
  __setRecipes: (r) => { recipes = r; },
  __recipes: () => recipes,
  __setOvens: (o) => { userOvens = o; },
  __setContainers: (c) => { userContainers = c; },
  __setBannetons: (b) => { userBannetons = b; },
  __setPans: (p) => { userPans = p; },
  __setMixers: (m) => { userMixers = m; },
  __setPots: (p) => { userPots = p; },
  __setPantry: (p) => { pantryItems = p; },
  SEED_RECIPES, SEED_PANTRY, stageTemplateFor, eventStageType, getEventStage,
  setProofingTempF, ratioSignature,
  loadBakeInstances, saveBakeInstances, addBakeInstance, setBakeInstanceField,
  setSplitShareCount, clearAllAnchors,
};`;

const factory = new Function(
  'document', 'window', 'self', 'localStorage', 'Chart', 'fetch', 'alert', 'confirm',
  'prompt', 'navigator', 'location', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'Image', 'console', 'Date',
  scriptBody + exportsTail
);

let api;
try {
  api = factory(
    documentStub, windowStub, windowStub, localStorageStub,
    function Chart() {}, () => Promise.reject(new Error('no fetch')),
    () => {}, () => true, () => null,
    { userAgent: 'characterize', clipboard: {} }, windowStub.location,
    () => ({ getPropertyValue: () => '' }), () => {}, () => {},
    function Image() {}, console, PinnedDate
  );
} catch (e) {
  console.error('INIT THREW:', e && e.stack || e);
  process.exit(1);
}

// ---- fixture context helpers ----
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Deadline helper: days after the pinned instant, at h:m local.
function D(days, h, m = 0) {
  const d = new RealDate(FIXED_NOW);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
}
const SEED = {
  batard: 'seed-sourdough-batard',
  boule: 'seed-sourdough-boule',
  muffin: 'seed-english-muffins',
  bagel: 'seed-sourdough-bagels',
  focaccia: 'seed-focaccia',
};
const deepCopy = (x) => JSON.parse(JSON.stringify(x));
const INITIAL_RECIPES = deepCopy(api.__recipes());
const INITIAL_PANTRY = deepCopy(api.SEED_PANTRY);

function resetAll() {
  localStorageStub.clear();
  Object.keys(els).forEach(k => { els[k].value = ''; els[k].innerHTML = ''; });
  api.__setRecipes(deepCopy(INITIAL_RECIPES));
  api.__setPlan({});
  api.__setOvens([]); api.__setContainers([]); api.__setBannetons([]);
  api.__setPans([]); api.__setMixers([]); api.__setPots([]);
  api.__setPantry(deepCopy(INITIAL_PANTRY));
  els['deadline-default-input'].value = fmtLocal(D(3, 10)); // default deadline: +3 days, 10:00
}
function setPlan(p) { seedPlan(p); api.__setPlan(p); }
function rec(id) { return api.__recipes().find(r => r.id === id); }
// Simple/enriched test recipes (the seeds don't include these processes).
function addSimple(count) {
  api.__recipes().push({ id: 'fx-simple', name: 'Test Cookies', processType: 'simple', unit: 'cookie',
    loafWeight: 40, leavening: 'none',
    ingredients: [{ name: 'All purpose flour', pct: 100, flourType: 'anchor' }, { name: 'Butter', pct: 60 }, { name: 'Sugar', pct: 55 }],
    stages: api.stageTemplateFor('simple') });
  return { 'fx-simple': count };
}
function addEnriched(count) {
  api.__recipes().push({ id: 'fx-enr', name: 'Test Rolls', processType: 'enriched', unit: 'roll',
    loafWeight: 90, leavening: 'commercial-yeast',
    ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }, { name: 'Milk', pct: 55 }, { name: 'Butter', pct: 20 }],
    stages: api.stageTemplateFor('enriched') });
  return { 'fx-enr': count };
}
function twoOvens() {
  api.__setOvens([
    { id: 'ov-a', name: 'Oven A', decks: 2, tempF: 500 },
    { id: 'ov-b', name: 'Oven B', decks: 1, tempF: 500 },
  ]);
}

// ---- fixtures ----
const FIXTURES = [
  { name: 'loaf-solo', setup() { setPlan({ [SEED.batard]: 8 }); } },
  { name: 'loaf-two-recipes-same-dough', setup() {
    rec(SEED.boule).ingredients = deepCopy(rec(SEED.batard).ingredients);
    setPlan({ [SEED.batard]: 20, [SEED.boule]: 8 });
  } },
  { name: 'loaf-two-doughs', setup() { setPlan({ [SEED.batard]: 12, [SEED.boule]: 8 }); } },
  { name: 'loaf-two-doughs-split-cols', setup() {
    localStorageStub.setItem('whb-split-loaf-cols-v1', '1');
    setPlan({ [SEED.batard]: 12, [SEED.boule]: 8 });
  } },
  { name: 'muffin-solo', setup() { setPlan({ [SEED.muffin]: 24 }); } },
  { name: 'bagel-solo', setup() { setPlan({ [SEED.bagel]: 12 }); } },
  { name: 'focaccia-solo', setup() { setPlan({ [SEED.focaccia]: 2 }); } },
  { name: 'simple-solo', setup() { setPlan(addSimple(24)); } },
  { name: 'enriched-solo', setup() { setPlan(addEnriched(12)); } },
  { name: 'all-six', setup() {
    const p = { [SEED.batard]: 8, [SEED.boule]: 6, [SEED.muffin]: 24, [SEED.bagel]: 12, [SEED.focaccia]: 1 };
    Object.assign(p, addSimple(24), addEnriched(12));
    setPlan(p);
  } },
  { name: 'loaf-muffin-shared-levain', setup() { setPlan({ [SEED.batard]: 8, [SEED.muffin]: 24 }); } },
  { name: 'loaf-muffin-separate-levain', setup() {
    // Muffins due far after the loaves → muffin mix falls outside the shared levain's ripe window.
    setPlan({ [SEED.batard]: 8, [SEED.muffin]: 24 });
    localStorageStub.setItem(RECIPE_DEADLINES_KEY, JSON.stringify({ [SEED.muffin]: fmtLocal(D(5, 16)) }));
  } },
  { name: 'loaf-two-deadlines', setup() {
    setPlan({ [SEED.batard]: 12, [SEED.boule]: 8 });
    localStorageStub.setItem(RECIPE_DEADLINES_KEY, JSON.stringify({ [SEED.boule]: fmtLocal(D(4, 16)) }));
  } },
  { name: 'muffin-two-deadlines', setup() {
    setPlan({ [SEED.muffin]: 24 });
    api.addBakeInstance(SEED.muffin, false);
    const inst = api.loadBakeInstances()[SEED.muffin][0];
    api.setBakeInstanceField(SEED.muffin, inst.id, 'count', 12);
    api.setBakeInstanceField(SEED.muffin, inst.id, 'deadline', fmtLocal(D(3, 15)));
  } },
  { name: 'bagel-two-deadlines', setup() {
    setPlan({ [SEED.bagel]: 12 });
    api.addBakeInstance(SEED.bagel, false);
    const inst = api.loadBakeInstances()[SEED.bagel][0];
    api.setBakeInstanceField(SEED.bagel, inst.id, 'count', 12);
    api.setBakeInstanceField(SEED.bagel, inst.id, 'deadline', fmtLocal(D(3, 15)));
  } },
  { name: 'focaccia-two-deadlines', setup() {
    setPlan({ [SEED.focaccia]: 2 });
    api.addBakeInstance(SEED.focaccia, false);
    const inst = api.loadBakeInstances()[SEED.focaccia][0];
    api.setBakeInstanceField(SEED.focaccia, inst.id, 'count', 1);
    api.setBakeInstanceField(SEED.focaccia, inst.id, 'deadline', fmtLocal(D(3, 15)));
  } },
  { name: 'split-bake', setup() {
    setPlan({ [SEED.batard]: 20, [SEED.boule]: 8 });
    api.addBakeInstance(SEED.batard, true);
    const inst = api.loadBakeInstances()[SEED.batard][0];
    api.setBakeInstanceField(SEED.batard, inst.id, 'count', 4);
    api.setBakeInstanceField(SEED.batard, inst.id, 'deadline', fmtLocal(D(3, 14)));
  } },
  { name: 'split-bake-split-cols', setup() {
    localStorageStub.setItem('whb-split-loaf-cols-v1', '1');
    setPlan({ [SEED.batard]: 20, [SEED.boule]: 8 });
    api.addBakeInstance(SEED.batard, true);
    const inst = api.loadBakeInstances()[SEED.batard][0];
    api.setBakeInstanceField(SEED.batard, inst.id, 'count', 4);
    api.setBakeInstanceField(SEED.batard, inst.id, 'deadline', fmtLocal(D(3, 14)));
  } },
  { name: 'split-bake-two-ovens', setup() {
    twoOvens();
    setPlan({ [SEED.batard]: 20 });
    api.addBakeInstance(SEED.batard, true);
    const inst = api.loadBakeInstances()[SEED.batard][0];
    api.setBakeInstanceField(SEED.batard, inst.id, 'count', 8);
    api.setBakeInstanceField(SEED.batard, inst.id, 'deadline', fmtLocal(D(3, 15)));
    api.setBakeInstanceField(SEED.batard, inst.id, 'ovenId', 'ov-b');
  } },
  { name: 'combine-same-dough-two-deadlines', setup() {
    rec(SEED.boule).ingredients = deepCopy(rec(SEED.batard).ingredients);
    setPlan({ [SEED.batard]: 12, [SEED.boule]: 8 });
    localStorageStub.setItem(RECIPE_DEADLINES_KEY, JSON.stringify({ [SEED.boule]: fmtLocal(D(3, 14)) }));
    localStorageStub.setItem('whb-combine-doughs-v1', JSON.stringify([api.ratioSignature(rec(SEED.batard))]));
  } },
  { name: 'three-ovens-all-processes', setup() {
    api.__setOvens([
      { id: 'ov-a', name: 'Oven A', decks: 2, tempF: 500 },
      { id: 'ov-b', name: 'Oven B', decks: 1, tempF: 500 },
      { id: 'ov-c', name: 'Oven C', decks: 1, tempF: 450 },
    ]);
    setPlan({ [SEED.batard]: 12, [SEED.muffin]: 24, [SEED.bagel]: 12 });
  } },
  { name: 'oven-prefs-required', setup() {
    twoOvens();
    rec(SEED.batard).ovenPrefs = { 'ov-b': 'required' };
    setPlan({ [SEED.batard]: 8, [SEED.muffin]: 24 });
  } },
  { name: 'milling', setup() {
    api.__setPantry([{ id: 'pan-rye', name: 'Rye flour', requiresMilling: true }]);
    const r = rec(SEED.batard);
    const rye = r.ingredients.find(i => /rye/i.test(i.name));
    if (rye) rye.pantryId = 'pan-rye';
    setPlan({ [SEED.batard]: 8 });
  } },
  { name: 'topping-loaf', setup() {
    const r = rec(SEED.batard);
    r.ingredients.push({ name: 'Sesame seeds', pct: 4 });
    r.stages = deepCopy(r.stages || api.stageTemplateFor('sourdough-loaf'));
    r.stages.push({ type: 'topping', ings: ['Sesame seeds'], duration: { kind: 'fixed', min: 3 } });
    setPlan({ [SEED.batard]: 8 });
  } },
  { name: 'heavy-loaf-deck-fallback', setup() {
    rec(SEED.batard).loafWeight = 1000;
    setPlan({ [SEED.batard]: 12 });
  } },
  { name: 'banneton-scarcity', setup() {
    api.__setBannetons([{ id: 'bn1', name: 'Oval banneton', quantity: 4, recipeIds: [] }]);
    setPlan({ [SEED.batard]: 12 });
  } },
  { name: 'container-scarcity', setup() {
    api.__setContainers([{ id: 'c1', name: 'Small tub', maxDoughGrams: 6000, quantity: 1, processTag: 'any' }]);
    setPlan({ [SEED.batard]: 16 });
  } },
  { name: 'all-overrides-loaf', setup() {
    Object.assign(rec(SEED.batard), {
      bakeMin: 45, ovenCapacity: 6, deckCapacity: 2, coldProofHr: '12-16',
      autolyseMin: 30, bulkMin: 300, foldsCount: 3, foldIntervalMin: 45, shapeMinPerUnit: 5,
    });
    setPlan({ [SEED.batard]: 8 });
  } },
  { name: 'overrides-muffin-bagel', setup() {
    Object.assign(rec(SEED.muffin), { bakeMin: 15, bulkMin: 150, warmupMin: 120, coldProofHr: '8' });
    Object.assign(rec(SEED.bagel), { bakeMin: 25, bulkMin: 90, shapeMinPerUnit: 3, coldProofHr: '10-12' });
    setPlan({ [SEED.muffin]: 24, [SEED.bagel]: 12 });
  } },
  { name: 'proofing-temp-64', setup() {
    api.setProofingTempF(64);
    setPlan({ [SEED.batard]: 8, [SEED.muffin]: 24 });
  } },
  { name: 'bake-time-preset-morning', setup() {
    els['bake-time-default-input'].value = 'morning';
    setPlan({ [SEED.batard]: 8 });
  } },
  { name: 'muffin-divergent', setup() {
    // Two muffin recipes in ONE deadline group with different proofing profiles →
    // the divergent per-recipe chain (per-recipe mix→bulk→shape→fridge, suffixed).
    const base = rec(SEED.muffin);
    const m2 = deepCopy(base);
    m2.id = 'fx-muffin2'; m2.name = 'Rye Muffins';
    m2.coldProofHr = '6'; m2.bulkMin = 90;
    const water = m2.ingredients.find(i => /water/i.test(i.name));
    if (water) water.pct = (Number(water.pct) || 70) + 5; // different dough too
    api.__recipes().push(m2);
    // Containers + pans so the bulk-container and pan claims (and their relabel path) emit.
    api.__setContainers([{ id: 'c1', name: 'Cambro', maxDoughGrams: 12000, quantity: 3, processTag: 'any' }]);
    api.__setPans([{ id: 'p1', name: 'Muffin tin', capacity: 12, quantity: 4, recipeIds: [] }]);
    setPlan({ [SEED.muffin]: 24, 'fx-muffin2': 12 });
  } },
  { name: 'bagel-divergent', setup() {
    const base = rec(SEED.bagel);
    const b2 = deepCopy(base);
    b2.id = 'fx-bagel2'; b2.name = 'Onion Bagels';
    b2.coldProofHr = '8'; b2.bulkMin = 60;
    const water = b2.ingredients.find(i => /water/i.test(i.name));
    if (water) water.pct = (Number(water.pct) || 60) + 5;
    api.__recipes().push(b2);
    api.__setContainers([{ id: 'c1', name: 'Cambro', maxDoughGrams: 12000, quantity: 3, processTag: 'any' }]);
    api.__setPans([{ id: 'p1', name: 'Sheet tray', capacity: 12, quantity: 4, recipeIds: [] }]);
    setPlan({ [SEED.bagel]: 12, 'fx-bagel2': 12 });
  } },
  { name: 'loaf-divergent-proofs', setup() {
    // Two distinct loaf doughs at one deadline with DIFFERENT cold proofs → the
    // per-container divergent prep path (proofingDivergent + ctTimeline).
    rec(SEED.batard).coldProofHr = '10';
    rec(SEED.boule).coldProofHr = '16';
    setPlan({ [SEED.batard]: 8, [SEED.boule]: 6 });
  } },
  { name: 'stages-vs-flat-diverged', setup() {
    // Stage list says bulk 300 min; flat field left '' (template default). Today the bread
    // engines read the FLAT spec (240); the Phase H stages-first flip changes this fixture.
    const r = rec(SEED.batard);
    r.stages = deepCopy(r.stages || api.stageTemplateFor('sourdough-loaf'));
    const bulk = r.stages.find(s => s.type === 'bulk');
    if (bulk) bulk.duration.min = 300;
    setPlan({ [SEED.batard]: 8 });
  } },
];

// ---- canonicalization ----
const iso = (d) => (d instanceof RealDate ? d.toISOString() : d == null ? null : String(d));
function canonEvents(events) {
  return (events || []).map(e => ({
    t: iso(e.time), tEnd: iso(e.timeEnd),
    title: e.title, detail: e.detail ?? null, process: e.process ?? null,
    columnKey: e.columnKey ?? null, colDetails: e.colDetails ?? null,
    stage: e.stage ?? null, stageType: e.stageType ?? null,
    equip: e.equip ?? null, equipStrip: e.equipStrip ?? null, equipStripTitle: e.equipStripTitle ?? null,
    container: e.container ?? null,
    activeStep: e.activeStep ?? null, activeMin: e.activeMin ?? null,
    mixBatchCount: e.mixBatchCount ?? null, mixBatchContents: e.mixBatchContents ?? null,
    batchIngredients: e.batchIngredients ?? null,
  }));
}
function canonResult(sr) {
  if (!sr) return null;
  return {
    totals: {
      totalLoaves: sr.totalLoaves ?? null, totalMuffins: sr.totalMuffins ?? null,
      totalBagels: sr.totalBagels ?? null, totalFocaccia: sr.totalFocaccia ?? null,
      totalSimple: sr.totalSimple ?? null, totalEnriched: sr.totalEnriched ?? null,
      batches: sr.batches ?? null, mixBatches: sr.mixBatches ?? null, bagelBatches: sr.bagelBatches ?? null,
    },
    events: canonEvents(sr.events),
    warnings: (sr.warnings || []).map(w => ({ msg: w.msg, issue: w.issue ?? null, kind: w.kind ?? null, type: w.type ?? null })),
    equipClaims: (sr.equipClaims || []).map(c => ({
      pool: c.pool, role: c.role, name: c.name, count: c.count,
      start: new RealDate(c.startMs).toISOString(), end: new RealDate(c.endMs).toISOString(),
      capacity: c.capacity ?? null,
    })),
    columns: {
      loaf: sr.loafColumns ?? null, muffin: sr.muffinColumns ?? null, bagel: sr.bagelColumns ?? null,
      focaccia: sr.focacciaColumns ?? null, side: sr.sideColumns ?? null,
    },
    levain: {
      build1Opt: sr.build1Opt ?? null, build2Opt: sr.build2Opt ?? null,
      useSeparateLevains: sr.useSeparateLevains ?? null,
      muffinBuild1Opt: sr.muffinBuild1Opt ?? null, muffinBuild2Opt: sr.muffinBuild2Opt ?? null,
      bagelBuild1Opt: sr.bagelBuild1Opt ?? null, bagelBuild2Opt: sr.bagelBuild2Opt ?? null,
      useBagelSeparateLevain: sr.useBagelSeparateLevain ?? null,
      levainContainerInfo: sr.levainContainerInfo ?? null,
    },
    loafContainerInfo: sr.loafContainerInfo ?? null,
    loafColdProofRange: sr.loafColdProofRange ?? null,
  };
}

// ---- run fixtures ----
if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR);
let pass = 0, fail = 0, created = 0, updated = 0;
const titleInventory = new Map(); // title pattern → stage type

for (const fx of FIXTURES) {
  if (ONLY && !ONLY.has(fx.name)) continue;
  resetAll();
  let snap;
  try {
    fx.setup();
    api.renderSchedule();
    snap = canonResult(api.__sr());
  } catch (e) {
    console.log(`  [${fx.name}] THREW: ${e && e.message}`);
    fail++;
    continue;
  }
  // Title inventory: numbers vary per fixture, so normalize digits for a stable pattern set.
  for (const ev of (snap && snap.events) || []) {
    const pattern = ev.title.replace(/\d+(\.\d+)?/g, 'N');
    let st;
    try { st = api.eventStageType({ title: ev.title, stageType: null }); }
    catch (e) { console.log(`  [${fx.name}] eventStageType THREW on "${ev.title}"`); fail++; st = '<ERROR>'; }
    titleInventory.set(pattern, st || '(substep/control)');
  }
  const file = path.join(SNAP_DIR, fx.name + '.json');
  const body = JSON.stringify(snap, null, 1) + '\n';
  if (UPDATE || !fs.existsSync(file)) {
    fs.writeFileSync(file, body);
    if (UPDATE && fs.existsSync(file)) updated++; else created++;
    console.log(`  [${fx.name}] ${UPDATE ? 'UPDATED' : 'CREATED'} (${(snap && snap.events || []).length} events)`);
  } else {
    const prev = fs.readFileSync(file, 'utf8');
    if (prev === body) { pass++; console.log(`  [${fx.name}] MATCH (${(snap && snap.events || []).length} events)`); }
    else {
      fail++;
      const a = prev.split('\n'), b = body.split('\n');
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      console.log(`  [${fx.name}] MISMATCH at line ${i + 1}:`);
      console.log(`     snapshot: ${(a[i] || '<end>').trim().slice(0, 160)}`);
      console.log(`     current:  ${(b[i] || '<end>').trim().slice(0, 160)}`);
    }
  }
}

// ---- title audit snapshot ----
if (!ONLY) {
  const titles = [...titleInventory.entries()].sort((x, y) => x[0].localeCompare(y[0]))
    .map(([pattern, stage]) => ({ pattern, stage }));
  const tFile = path.join(SNAP_DIR, 'titles.json');
  const tBody = JSON.stringify(titles, null, 1) + '\n';
  if (UPDATE || !fs.existsSync(tFile)) {
    fs.writeFileSync(tFile, tBody);
    console.log(`  [titles] ${UPDATE ? 'UPDATED' : 'CREATED'} (${titles.length} title patterns)`);
  } else if (fs.readFileSync(tFile, 'utf8') === tBody) {
    pass++; console.log(`  [titles] MATCH (${titles.length} title patterns)`);
  } else {
    fail++;
    console.log('  [titles] MISMATCH — an event title or its stage classification drifted (frozen API!)');
  }
}

console.log(`\n${fail === 0 ? 'ALL SNAPSHOTS OK' : 'SNAPSHOT FAILURES'} — ${pass} matched, ${created} created, ${updated} updated, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

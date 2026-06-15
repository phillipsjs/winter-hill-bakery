// DOM-stub harness: runs the real index.html script under fake DOM/localStorage,
// then exercises renderSchedule + the levain fallback across plan types and asserts
// the schedule and the levain card agree on the shared-vs-separate levain decision.
const fs = require('fs');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
// The main app script is the <script> block that defines SEED_RECIPES.
const scriptBody = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(s => s.includes('SEED_RECIPES'));
if (!scriptBody) { console.error('Could not find main script'); process.exit(1); }

// ---- universal fake DOM element (callable + navigable proxy) ----
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
      return proxy; // any other method/prop: chainable no-op
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return proxy; },
  });
  return proxy;
}

// Element registry so values persist across getElementById calls.
const els = {};
const presetInputs = {
  'bake-time-default-input': '',
  'coldproof-loaf-input': '',
  'coldproof-muffin-input': '',
  'coldproof-bagel-input': '',
  'build1-ratio-input': '',
  'build2-ratio-input': '',
  'batchsize-bagel-input': '',
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

// Seed plan BEFORE running the script (loadPlan reads it at module init).
const PLAN_KEY = 'cottage-bakery-plan-v5';
function seedPlan(p) { localStorageStub.setItem(PLAN_KEY, JSON.stringify(p)); }

// Build the runnable module: append exports so we can drive internals after init.
const exportsTail = `
;return {
  renderSchedule, getSelectedLevainRatios, effectiveLevainRatios, deriveScheduleInputs,
  buildScheduleAcrossLoafGroups, getEventStage,
  __sr: () => _scheduleResult,
  __setPlan: (p) => { plan = p; },
  __setBannetons: (b) => { userBannetons = b; },
  __recipes: () => recipes,
};`;

const factory = new Function(
  'document', 'window', 'self', 'localStorage', 'Chart', 'fetch', 'alert', 'confirm',
  'prompt', 'navigator', 'location', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'Image', 'console',
  scriptBody + exportsTail
);

let api;
try {
  api = factory(
    documentStub, windowStub, windowStub, localStorageStub,
    function Chart() {}, () => Promise.reject(new Error('no fetch in harness')),
    () => {}, () => true, () => null,
    { userAgent: 'harness', clipboard: {} }, windowStub.location,
    () => ({ getPropertyValue: () => '' }), () => {}, () => {},
    function Image() {}, console
  );
} catch (e) {
  console.error('INIT THREW:', e && e.stack || e);
  process.exit(1);
}

// ---- scenarios ----
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const SEED = {
  batard: 'seed-sourdough-batard',
  boule: 'seed-sourdough-boule',
  muffin: 'seed-english-muffins',
  bagel: 'seed-sourdough-bagels',
  focaccia: 'seed-focaccia',
};

const RECIPE_DEADLINES_KEY = 'whb-recipe-deadlines-v1';
function run(name, plan, deadlineDate, recipeDeadlines) {
  els['deadline-default-input'].value = fmtLocal(deadlineDate);
  // reset cold-proof/bake-time inputs to auto each run
  ['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input',
   'bake-time-default-input','build1-ratio-input','build2-ratio-input','batchsize-bagel-input']
    .forEach(id => { els[id].value = ''; });
  if (recipeDeadlines) localStorageStub.setItem(RECIPE_DEADLINES_KEY, JSON.stringify(recipeDeadlines));
  else localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  seedPlan(plan);
  api.__setPlan(plan);

  let ok = true, notes = [];
  try {
    api.renderSchedule();
  } catch (e) {
    console.error(`  [${name}] renderSchedule THREW:`, e && e.stack || e);
    return false;
  }
  const sr = api.__sr();
  if (!sr) { notes.push('no _scheduleResult (maybe nothing scheduled)'); }

  // Authoritative decision from the rendered schedule:
  const schedSep = sr ? !!sr.useSeparateLevains : null;
  const schedBagelSep = sr ? !!sr.useBagelSeparateLevain : null;

  // The fallback the levain card uses when no schedule exists — now on the shared path.
  let fb;
  try {
    fb = api.getSelectedLevainRatios();
  } catch (e) {
    console.error(`  [${name}] getSelectedLevainRatios THREW:`, e && e.stack || e);
    return false;
  }
  const fbSep = !!fb.useSeparateLevains;
  const fbBagelSep = !!fb.useBagelSeparateLevain;

  // effectiveLevainRatios should mirror the schedule (reads _scheduleResult).
  const eff = api.effectiveLevainRatios();
  const effSep = !!eff.useSeparateLevains;

  if (sr) {
    if (effSep !== schedSep) { ok = false; notes.push(`effectiveLevainRatios sep=${effSep} != schedule sep=${schedSep}`); }
    if (fbSep !== schedSep) { ok = false; notes.push(`fallback sep=${fbSep} != schedule sep=${schedSep}`); }
    if (fbBagelSep !== schedBagelSep) { ok = false; notes.push(`fallback bagelSep=${fbBagelSep} != schedule bagelSep=${schedBagelSep}`); }
  }

  console.log(`  [${name}] ${ok ? 'PASS' : 'FAIL'} — schedSep=${schedSep} bagelSep=${schedBagelSep}` +
    (notes.length ? ` :: ${notes.join('; ')}` : ''));
  return ok;
}

// ---- staging assertions: cold proof = chill, bulk ferment = its own proof step ----
function stageOf(title) {
  const ev = api.__sr().events.find(e => e.title === title || e.title.startsWith(title));
  return ev ? api.getEventStage(ev) : null;
}
function expectStage(name, title, want) {
  const got = stageOf(title);
  const ok = got === want;
  console.log(`  [${name}] ${ok ? 'PASS' : 'FAIL'} — "${title}" stage=${got} (want ${want})`);
  return ok;
}

const tomorrow8 = new Date(); tomorrow8.setDate(tomorrow8.getDate() + 1); tomorrow8.setHours(8, 0, 0, 0);

console.log('Running schedule/levain consistency scenarios:');
let allOk = true;
allOk &= run('loaves only', { [SEED.batard]: 8 }, tomorrow8);
allOk &= run('loaf + muffin (same deadline)', { [SEED.batard]: 8, [SEED.muffin]: 12 }, tomorrow8);
allOk &= run('loaf + muffin + bagel', { [SEED.batard]: 8, [SEED.muffin]: 12, [SEED.bagel]: 10 }, tomorrow8);
allOk &= run('muffin only', { [SEED.muffin]: 12 }, tomorrow8);
allOk &= run('two loaf doughs + muffin', { [SEED.batard]: 6, [SEED.boule]: 6, [SEED.muffin]: 12 }, tomorrow8);
allOk &= run('focaccia + loaf (mixed)', { [SEED.batard]: 6, [SEED.focaccia]: 2 }, tomorrow8);

// Force separation: muffins due ~2 days after the loaves (per-recipe override). The
// muffin mix should fall outside the shared Build 2 ripe window → useSeparateLevains.
const twoDaysLater8 = new Date(tomorrow8); twoDaysLater8.setDate(twoDaysLater8.getDate() + 2);
allOk &= run('loaf + muffin (far-apart deadlines → separate)',
  { [SEED.batard]: 8, [SEED.muffin]: 12 }, tomorrow8,
  { [SEED.muffin]: fmtLocal(twoDaysLater8) });

console.log('\nStaging assertions (loaf + muffin + bagel):');
seedPlan({ [SEED.batard]: 8, [SEED.muffin]: 12, [SEED.bagel]: 10 });
api.__setPlan({ [SEED.batard]: 8, [SEED.muffin]: 12, [SEED.bagel]: 10 });
els['deadline-default-input'].value = fmtLocal(tomorrow8);
['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
api.renderSchedule();
let stageOk = true;
stageOk &= expectStage('stage', 'Bulk ferment', 'proof');                 // loaf bulk ferment (own step)
stageOk &= expectStage('stage', 'Muffin dough bulk ferment', 'proof');    // muffin bulk ferment
stageOk &= expectStage('stage', 'Bagel dough bulk ferment', 'proof');     // bagel bulk ferment
stageOk &= expectStage('stage', 'Into fridge', 'chill');                  // loaf cold proof
stageOk &= expectStage('stage', 'Muffins into fridge', 'chill');          // muffin cold proof
stageOk &= expectStage('stage', 'Bagels into fridge', 'chill');           // bagel cold proof
stageOk &= expectStage('stage', 'Muffins out of fridge', 'proof');        // warm-up final proof

allOk &= stageOk;

// ---- weigh-step assertions: every process emits a weigh-ingredients step ----
console.log('\nWeigh-step assertions:');
function hasWeighFor(proc) {
  return api.__sr().events.some(e => e.process === proc && /^Weigh /.test(e.title));
}
function expectWeigh(plan, proc) {
  seedPlan(plan); api.__setPlan(plan);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const ok = hasWeighFor(proc);
  console.log(`  [weigh] ${ok ? 'PASS' : 'FAIL'} — ${proc} has a weigh step`);
  return ok;
}
let weighOk = true;
weighOk &= expectWeigh({ [SEED.batard]: 8 }, 'loaf');
weighOk &= expectWeigh({ [SEED.muffin]: 12 }, 'muffin');
weighOk &= expectWeigh({ [SEED.bagel]: 10 }, 'bagel');
weighOk &= expectWeigh({ [SEED.focaccia]: 2 }, 'focaccia');
allOk &= weighOk;

// ---- banneton assertions: loaves final-shape & cold-proof in bannetons, not the tub ----
console.log('\nBanneton assertions:');
function loafContainerFor(title) {
  const ev = api.__sr().events.find(e => e.process === 'loaf' && e.title.startsWith(title));
  return ev ? (ev.container || '') : null;
}
function setupLoafRun(bannetons) {
  api.__setBannetons(bannetons || []);
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
}
let bannetonOk = true;
function check(label, cond) { console.log(`  [banneton] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }

// Generic (no bannetons configured): label should say "Banneton…" and keep the recipe name.
setupLoafRun([]);
const fsGen = loafContainerFor('Final shape');
const frGen = loafContainerFor('Into fridge');
bannetonOk &= check(`final shape uses bannetons (got "${fsGen}")`, /banneton/i.test(fsGen) && /Batard/.test(fsGen));
bannetonOk &= check(`into fridge uses bannetons (got "${frGen}")`, /banneton/i.test(frGen) && /Batard/.test(frGen));

// Named banneton eligible for the loaf: its name should appear instead of the generic word.
setupLoafRun([{ id: 'b1', name: '9 inch round', quantity: 12, recipeIds: [] }]);
const fsNamed = loafContainerFor('Final shape');
bannetonOk &= check(`named banneton shown (got "${fsNamed}")`, fsNamed.includes('9 inch round'));
allOk &= bannetonOk;

// ---- contiguity assertions: same-recipe steps cluster within each displayed time ----
// _scheduleResult.events is already in display order (renderSchedule sorts in place).
console.log('\nContiguity assertions:');
function clusterContiguityOk(events) {
  const round5 = (t) => Math.round(t.getTime() / 300000) * 300000;
  let i = 0;
  while (i < events.length) {
    const day = events[i].time.toDateString(), rt = round5(events[i].time);
    let j = i;
    while (j < events.length && events[j].time.toDateString() === day && round5(events[j].time) === rt) j++;
    // Within this displayed-time bucket, each cluster key must form one contiguous run.
    const seen = new Set(); let last = null;
    for (let k = i; k < j; k++) {
      const key = events[k].columnKey || events[k].process || '';
      if (key !== last) { if (seen.has(key)) return false; seen.add(key); last = key; }
    }
    i = j;
  }
  return true;
}
function expectContiguous(name, plan, recipeDeadlines) {
  api.__setBannetons([]);
  seedPlan(plan); api.__setPlan(plan);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
  if (recipeDeadlines) localStorageStub.setItem(RECIPE_DEADLINES_KEY, JSON.stringify(recipeDeadlines));
  else localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const ok = clusterContiguityOk(api.__sr().events);
  console.log(`  [contig] ${ok ? 'PASS' : 'FAIL'} — ${name}`);
  return ok;
}
let contigOk = true;
contigOk &= expectContiguous('two loaf doughs (batard + boule)', { [SEED.batard]: 8, [SEED.boule]: 8 });
contigOk &= expectContiguous('loaf + muffin + bagel', { [SEED.batard]: 8, [SEED.muffin]: 12, [SEED.bagel]: 10 });
allOk &= contigOk;

// ---- container assertions: muffin/bagel mix + bulk-ferment steps surface a container ----
console.log('\nMix/proof container assertions:');
function eventContainer(title) {
  const ev = api.__sr().events.find(e => e.title === title || e.title.startsWith(title));
  return ev ? (ev.container || '') : null;
}
function expectContainer(name, plan, titles) {
  api.__setBannetons([]);
  seedPlan(plan); api.__setPlan(plan);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  let ok = true;
  titles.forEach(t => { const c = eventContainer(t); const good = !!c; ok = ok && good; console.log(`  [container] ${good ? 'PASS' : 'FAIL'} — ${name}: "${t}" → ${c || '(none)'}`); });
  return ok;
}
let contOk = true;
contOk &= expectContainer('muffin', { [SEED.muffin]: 24 }, ['Mix muffin dough', 'Muffin dough bulk ferment']);
contOk &= expectContainer('bagel', { [SEED.bagel]: 20 }, ['Mix bagel dough', 'Bagel dough bulk ferment']);
allOk &= contOk;

console.log(allOk ? '\nALL SCENARIOS PASSED' : '\nSOME SCENARIOS FAILED');
process.exit(allOk ? 0 : 1);

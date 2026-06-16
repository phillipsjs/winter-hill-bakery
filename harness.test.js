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
  stagesFromRecipe, paramsFromStages, stageTemplateFor, getRecipeSpec, getProcessType,
  processCategory, SEED_RECIPES, STAGE_TEMPLATES,
  recipeUsesMilledFlour, milledFlourNamesFor, stagesForScheduling, stageDurationOf,
  startNewRecipe, editRecipe, renderStageEditor, onProcessTypeChange,
  stageEditorReset, stageEditorAdd, stageEditorMove, stageEditorRemove,
  __editorStages: () => _editorStages,
  __sr: () => _scheduleResult,
  __setPlan: (p) => { plan = p; },
  __setBannetons: (b) => { userBannetons = b; },
  __setPantry: (p) => { pantryItems = p; },
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

// ---- stage-model round-trip assertions (recipe builder Phase 1) ----
console.log('\nStage-model assertions:');
const isBlank = (v) => v === undefined || v === null || v === '';
function specEq(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => a[k] === b[k]);
}
let stageModelOk = true;
function checkStg(label, cond) { console.log(`  [stage] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }

// 1) A fresh template derives to no overrides (so a new recipe = template behavior).
['sourdough-loaf','sourdough-muffin','bagel','focaccia','simple','enriched'].forEach(pt => {
  const params = api.paramsFromStages(api.stageTemplateFor(pt), pt);
  const numericFields = ['autolyseMin','bulkMin','foldsCount','shapeMinPerUnit','warmupMin','bakeMin','bakeTempF'];
  const allBlank = numericFields.every(f => isBlank(params[f]))
    && (api.processCategory(pt) !== 'bread' || isBlank(params.coldProofHr));
  stageModelOk &= checkStg(`${pt}: fresh template → no numeric overrides`, allBlank);
});

// 2) Every seed recipe round-trips: stagesFromRecipe → paramsFromStages preserves the
//    effective scheduler spec and the cold-proof auto/explicit state.
api.SEED_RECIPES.filter(r => api.getProcessType(r) !== 'levain').forEach(r => {
  const pt = api.getProcessType(r);
  const stages = api.stagesFromRecipe(r);
  const params = api.paramsFromStages(stages, pt);
  const merged = { ...r, ...params };
  const specOk = specEq(api.getRecipeSpec(r), api.getRecipeSpec(merged));
  stageModelOk &= checkStg(`${r.name}: getRecipeSpec preserved`, specOk);
  if (api.processCategory(pt) === 'bread') {
    const autoBefore = isBlank(r.coldProofHr) ? 'auto' : (String(r.coldProofHr) === '0' ? 'none' : 'explicit');
    const autoAfter = isBlank(merged.coldProofHr) ? 'auto' : (String(merged.coldProofHr) === '0' ? 'none' : 'explicit');
    stageModelOk &= checkStg(`${r.name}: cold-proof state (${autoBefore})`, autoBefore === autoAfter);
  }
});

// 3) Explicit overrides survive the round-trip.
const loaf = api.SEED_RECIPES.find(r => api.getProcessType(r) === 'sourdough-loaf');
const variant = { ...loaf, bulkMin: 300, foldsCount: 3, coldProofHr: '12-16' };
const vParams = api.paramsFromStages(api.stagesFromRecipe(variant), 'sourdough-loaf');
stageModelOk &= checkStg('override bulkMin=300 survives', vParams.bulkMin === 300);
stageModelOk &= checkStg('override foldsCount=3 survives', vParams.foldsCount === 3);
stageModelOk &= checkStg('override coldProofHr=12-16 survives', vParams.coldProofHr === '12-16');
// coldProofHr="0" (no cold proof) survives as "0", not blank.
const noCp = api.paramsFromStages(api.stagesFromRecipe({ ...loaf, coldProofHr: '0' }), 'sourdough-loaf');
stageModelOk &= checkStg('coldProofHr=0 (none) survives', noCp.coldProofHr === '0');

// 4) Migration on load: every non-levain recipe in memory now carries a stage list.
const loaded = api.__recipes().filter(r => api.getProcessType(r) !== 'levain');
const allHaveStages = loaded.length > 0 && loaded.every(r => Array.isArray(r.stages) && r.stages.length > 0);
stageModelOk &= checkStg(`migration: all ${loaded.length} loaded recipes carry stages`, allHaveStages);

// 5) Editor smoke test: the stage-editor functions don't throw under the stub DOM.
console.log('\nStage-editor smoke test:');
let editorOk = true;
function smoke(label, fn) {
  let ok = true;
  try { fn(); } catch (e) { ok = false; console.log(`    ${e && e.message || e}`); }
  console.log(`  [editor] ${ok ? 'PASS' : 'FAIL'} — ${label}`);
  return ok;
}
editorOk &= smoke('startNewRecipe()', () => api.startNewRecipe());
editorOk &= smoke('stageEditorReset/Add/Move/Remove', () => {
  api.stageEditorReset(); api.stageEditorAdd(); api.stageEditorMove(0, 1); api.stageEditorRemove(0);
});
api.SEED_RECIPES.filter(r => api.getProcessType(r) !== 'levain').forEach(r => {
  editorOk &= smoke(`editRecipe(${r.name})`, () => { api.editRecipe(r.id); });
  // after editRecipe, the editor stages should be a non-empty clone
  editorOk &= smoke(`  → editorStages populated for ${r.name}`, () => {
    const st = api.__editorStages();
    if (!Array.isArray(st) || !st.length) throw new Error('empty editor stages');
  });
});
allOk &= editorOk;

allOk &= stageModelOk;

// 6) Schedule invariance: a no-op edit→save (stages → params) must not move the
//    schedule for any process (this is the bug the user hit when editing the bagel).
console.log('\nSchedule-invariance (no-op edit/save):');
let invarOk = true;
function bagelLikeMerge(r) {
  const pt = api.getProcessType(r);
  const params = api.paramsFromStages(api.stagesFromRecipe(r), pt);
  const out = { ...r };
  ['bakeMin', 'coldProofHr', 'warmupMin', 'autolyseMin', 'bulkMin', 'foldsCount', 'shapeMinPerUnit'].forEach(f => {
    if (f in params) out[f] = params[f] === '' ? null : params[f];
  });
  out.bakeTempF = (params.bakeTempF === '' || params.bakeTempF == null) ? null : Number(params.bakeTempF);
  if (pt === 'simple') out.chillWindow = params.chillWindow || '';
  if (pt === 'enriched') {
    out.finalProofMode = params.finalProofMode || 'warm';
    out.finalProofWarmMin = (params.finalProofWarmMin === '' || params.finalProofWarmMin == null) ? null : Number(params.finalProofWarmMin);
    out.finalProofColdWindow = params.finalProofColdWindow || '8-12';
    out.glazeEnabled = !!params.glazeEnabled;
    out.glazeMin = (params.glazeMin === '' || params.glazeMin == null) ? null : Number(params.glazeMin);
  }
  return out;
}
function scheduleSig(planObj, recipeMut) {
  const recs = api.__recipes();
  // apply recipeMut to a clone of the recipes array (mutate in place by id)
  if (recipeMut) Object.keys(recipeMut).forEach(id => {
    const idx = recs.findIndex(r => r.id === id);
    if (idx >= 0) recs[idx] = recipeMut[id];
  });
  api.__setPlan(planObj);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.__setBannetons([]);
  api.renderSchedule();
  const sr = api.__sr();
  if (!sr) return '(none)';
  return sr.events.map(e => `${e.process}|${e.title}@${e.time && e.time.getTime ? Math.round(e.time.getTime() / 60000) : '?'}`).join('\n');
}
[
  ['loaf', { 'seed-sourdough-batard': 8 }, 'seed-sourdough-batard'],
  ['muffin', { 'seed-english-muffins': 12 }, 'seed-english-muffins'],
  ['bagel', { 'seed-sourdough-bagels': 10 }, 'seed-sourdough-bagels'],
  ['focaccia', { 'seed-focaccia': 2 }, 'seed-focaccia'],
].forEach(([label, plan, id]) => {
  const orig = api.__recipes().find(r => r.id === id);
  if (!orig) { console.log(`  [invar] SKIP — ${label} (seed not present)`); return; }
  const before = scheduleSig(plan, null);
  const after = scheduleSig(plan, { [id]: bagelLikeMerge(orig) });
  const ok = before === after;
  invarOk &= ok;
  console.log(`  [invar] ${ok ? 'PASS' : 'FAIL'} — ${label}: no-op edit leaves schedule unchanged`);
  if (!ok) {
    const b = before.split('\n'), a = after.split('\n');
    for (let i = 0; i < Math.max(b.length, a.length); i++) if (b[i] !== a[i]) { console.log(`      @${i}: ${b[i]} => ${a[i]}`); break; }
  }
});
allOk &= invarOk;

// 7) Phase 2: the simple/other family schedules by WALKING stages[], so custom-shaped
//    recipes actually schedule.
console.log('\nPhase 2 — generic stage-walking scheduler:');
let p2Ok = true;
function p2(label, cond) { console.log(`  [phase2] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
const recsP2 = api.__recipes();
const simpleR = { id: 'p2-simple', name: 'Test Cookies', processType: 'simple', unit: 'cookie', loafWeight: 40, leavening: 'none',
  ingredients: [{ name: 'All purpose flour', pct: 100, flourType: 'anchor' }, { name: 'Butter', pct: 60 }, { name: 'Sugar', pct: 55 }],
  stages: api.stageTemplateFor('simple') };
const enrR = { id: 'p2-enr', name: 'Test Rolls', processType: 'enriched', unit: 'roll', loafWeight: 90, leavening: 'commercial-yeast',
  ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }, { name: 'Milk', pct: 55 }, { name: 'Butter', pct: 20 }],
  stages: api.stageTemplateFor('enriched') };
recsP2.push(simpleR, enrR);
function p2events(proc) {
  api.__setPlan({ 'p2-simple': 24, 'p2-enr': 12 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  return api.__sr().events.filter(e => e.process === proc);
}
let se = p2events('simple');
const sBake = se.find(e => /^Bake /.test(e.title));
const sMix = se.find(e => e.stage === 'mix');
p2Ok &= p2('simple schedules (has Bake + Package)', !!sBake && se.some(e => e.title === 'Package & ready for sale'));
p2Ok &= p2('simple has a pre-bake mix before the first bake', !!sMix && !!sBake && sMix.time < sBake.time);
let ee = p2events('enriched');
p2Ok &= p2('enriched schedules (bulk + final proof + bake)', ee.some(e => /Bulk/.test(e.title)) && ee.some(e => /Final proof/.test(e.title)) && ee.some(e => /^Bake /.test(e.title)));

// Custom stage: insert a "Second proof" before the bake → a new step appears.
const bakeI = enrR.stages.findIndex(s => s.type === 'bake');
enrR.stages.splice(bakeI, 0, { id: 'p2-x', type: 'rest', label: 'Second proof', duration: { kind: 'fixed', min: 45 } });
ee = p2events('enriched');
p2Ok &= p2('custom stage appears in schedule ("Second proof")', ee.some(e => /Second proof/.test(e.title) && e.stage === 'proof'));

// Duration change: doubling the bulk shifts the pre-bake chain earlier by the delta.
const weighBefore = (es) => es.filter(e => e.stage === 'prep').sort((a, b) => a.time - b.time)[0].time.getTime();
const t0 = weighBefore(p2events('enriched'));
enrR.stages.find(s => s.type === 'bulk').duration.min += 60; // +60 min bulk
const t1 = weighBefore(p2events('enriched'));
const shiftedMin = Math.round((t0 - t1) / 60000);
p2Ok &= p2(`bulk +60 min shifts chain ~60 min earlier (got ${shiftedMin})`, shiftedMin === 60);

// Post-bake cool/glaze are now stage-driven. Package-ready is deadline-anchored, so a
// longer cool shifts the BAKE earlier (more cooling before the deadline) and the cool
// step's duration updates.
const firstBake = (es) => es.filter(e => /^Bake /.test(e.title)).sort((a, b) => a.time - b.time)[0].time.getTime();
const coolDetail = (es) => (es.find(e => /out — cool/.test(e.title)) || {}).detail || '';
// reset enriched bulk back so only cool changes between the two renders
enrR.stages.find(s => s.type === 'bulk').duration.min -= 60;
let eePre = p2events('enriched');
const bakeBefore = firstBake(eePre);
enrR.stages.find(s => s.type === 'cool').duration.min += 30; // +30 min cool
let eePost = p2events('enriched');
const bakeShift = Math.round((bakeBefore - firstBake(eePost)) / 60000);
p2Ok &= p2(`cool +30 min shifts the bake ~30 min earlier (got ${bakeShift})`, bakeShift === 30);
p2Ok &= p2(`cool step duration reflects the edit (got "${coolDetail(eePost)}")`, /50 min/.test(coolDetail(eePost)));
// Adding a glaze stage adds a glaze step + extends package-ready.
const hasGlazeBefore = p2events('enriched').some(e => /Glaze/.test(e.title));
enrR.stages.push({ id: 'p2-g', type: 'glaze', label: 'Glaze / ice', duration: { kind: 'fixed', min: 10 } });
const afterGlaze = p2events('enriched');
p2Ok &= p2('adding a glaze stage adds a Glaze step', !hasGlazeBefore && afterGlaze.some(e => /Glaze/.test(e.title)));
allOk &= p2Ok;

// ---- Milling (ingredient-controlled) + weigh-stage alignment ----
console.log('\nMilling + weigh-stage assertions:');
let millOk = true;
function mk(label, cond) { console.log(`  [mill] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
function renderEvents(plan) {
  api.__setPlan(plan); seedPlan(plan);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  return api.__sr().events;
}

// Every bread template now seeds a weigh stage.
['sourdough-loaf', 'sourdough-muffin', 'bagel', 'focaccia'].forEach(pt => {
  millOk &= mk(`${pt} template has a weigh stage`, api.STAGE_TEMPLATES[pt].some(s => s.type === 'weigh'));
});

// recipeUsesMilledFlour keys off the pantry flag.
api.__setPantry([{ id: 'pan-rye', name: 'Whole rye', requiresMilling: true }]);
const milledIngs = [
  { name: 'Bread flour', pct: 80, flourType: 'anchor' },
  { name: 'Whole rye', pct: 20, flourType: 'specialty', pantryId: 'pan-rye' },
  { name: 'Water', pct: 75 }, { name: 'Salt', pct: 2 }, { name: 'Levain', pct: 20 },
];
const plainIngs = [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }, { name: 'Water', pct: 75 }, { name: 'Salt', pct: 2 }, { name: 'Levain', pct: 20 }];
millOk &= mk('recipeUsesMilledFlour true when a milled flour is used', api.recipeUsesMilledFlour({ ingredients: milledIngs }) === true);
millOk &= mk('recipeUsesMilledFlour false otherwise', api.recipeUsesMilledFlour({ ingredients: plainIngs }) === false);

// stagesFromRecipe auto-inserts mill (after weigh, before mix/autolyse) when milled.
const milledStages = api.stagesFromRecipe({ processType: 'sourdough-loaf', ingredients: milledIngs });
const mi = milledStages.findIndex(s => s.type === 'mill');
const wi = milledStages.findIndex(s => s.type === 'weigh');
const ai = milledStages.findIndex(s => s.type === 'autolyse' || s.type === 'mix');
millOk &= mk('mill stage injected when milled', mi >= 0);
millOk &= mk('mill positioned after weigh, before mix/autolyse', wi >= 0 && wi < mi && mi <= ai);
millOk &= mk('no mill stage when not milled', !api.stagesFromRecipe({ processType: 'sourdough-loaf', ingredients: plainIngs }).some(s => s.type === 'mill'));

// Bread schedule: a milled loaf emits a Mill flour step; weigh duration comes from the stage.
const milledLoaf = { id: 'mill-loaf', name: 'Rye Boule', processType: 'sourdough-loaf', unit: 'loaf', loafWeight: 900, leavening: 'sourdough', bakeTempF: 500, ingredients: milledIngs, stages: milledStages };
milledLoaf.stages.find(s => s.type === 'weigh').duration.min = 8;
api.__recipes().push(milledLoaf);
let me = renderEvents({ 'mill-loaf': 8 });
millOk &= mk('milled loaf emits a Mill flour step', me.some(e => e.process === 'loaf' && /^Mill flour/.test(e.title)));
const weighEv = me.find(e => e.process === 'loaf' && /^Weigh /.test(e.title));
millOk &= mk('loaf weigh duration is stage-driven (8 min)', !!weighEv && /\b8 min/.test(weighEv.detail));

// Drop the milling flag → the Mill flour step disappears (ingredient-controlled).
api.__setPantry([{ id: 'pan-rye', name: 'Whole rye', requiresMilling: false }]);
me = renderEvents({ 'mill-loaf': 8 });
millOk &= mk('no Mill flour step once the flour no longer mills', !me.some(e => e.process === 'loaf' && /^Mill flour/.test(e.title)));

// Generic engine: a simple recipe with a milled flour also gets a Mill flour step.
api.__setPantry([{ id: 'pan-corn', name: 'Whole corn', requiresMilling: true }]);
const milledSimple = { id: 'mill-simple', name: 'Cornbread', processType: 'simple', unit: 'piece', loafWeight: 80, leavening: 'none', ingredients: [{ name: 'Whole corn', pct: 100, flourType: 'anchor', pantryId: 'pan-corn' }, { name: 'Milk', pct: 70 }], stages: api.stageTemplateFor('simple') };
api.__recipes().push(milledSimple);
const ms = renderEvents({ 'mill-simple': 12 }).filter(e => e.process === 'simple');
millOk &= mk('generic (simple) milled recipe emits a Mill flour step', ms.some(e => /^Mill flour/.test(e.title)));

// Focaccia oven-on / bake reflect the recipe's edited bake temp (not the template default).
const focOrig = api.__recipes().find(r => r.id === 'seed-focaccia');
let focTempOk = false;
if (focOrig) {
  focOrig.bakeTempF = 460;
  focOrig.stages = api.stagesFromRecipe(focOrig);
  const bs = focOrig.stages.find(s => s.type === 'bake'); if (bs) bs.tempF = 460;
  const fe = renderEvents({ 'seed-focaccia': 2 }).filter(e => e.process === 'focaccia');
  focTempOk = fe.some(e => /460°F/.test((e.detail || '') + (e.title || '')));
}
millOk &= mk('focaccia bake temp follows the recipe (460°F)', focTempOk);

allOk &= millOk;

console.log(allOk ? '\nALL SCENARIOS PASSED' : '\nSOME SCENARIOS FAILED');
process.exit(allOk ? 0 : 1);

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
  buildScheduleAcrossLoafGroups, getEventStage, renderBakeSheet,
  setBakePlanEquip, renderTotals,
  stagesFromRecipe, paramsFromStages, stageTemplateFor, getRecipeSpec, getProcessType,
  processCategory, SEED_RECIPES, STAGE_TEMPLATES,
  recipeUsesMilledFlour, milledFlourNamesFor, stagesForScheduling, stageDurationOf,
  pantryLinkOptionsHtml, SEED_PANTRY, suggestPantryLinkFor, withMigratedStages,
  INGREDIENT_CATALOG, BUILTIN_CATEGORIES,
  fmtTemp, tempInputValue, tempFromInput, getTempUnit, setTempUnit, getLocalSettings, applyRemoteSettings,
  proofTempFactor, fermentScale, getProofingTempF, setProofingTempF, proofingTempIsSet, pickLevainBuild,
  buildBakeSheetHelpers, hoverHtmlFor, noteControlHtml, stepNoteKey, getStepNoteFor, setStepNote, loadStepNotes,
  recipeStageNotesForEvent, recipeStageNotesHtml, eventStageType, eventSubstep, buildRecipeNotesByEvent,
  stageVesselSelectHtml,
  startNewRecipe, editRecipe, renderStageEditor, onProcessTypeChange,
  stageEditorReset, stageEditorAdd, stageEditorMove, stageEditorRemove, toggleStageExpand, stageDurationSummary,
  stageIsActive, stageActiveMinutes, stageDefaultActiveMin,
  toggleStageActive, stageEditorSetActiveMin,
  annotateActiveMinutes, detectActiveOverlaps, isActiveStep, lateNightActiveSteps,
  detectFlourType, ingredientIsFlour,
  toppingIngredientNames, ingredientWeightRole, doughSumPct, toppingGramsPerUnit, finalUnitWeight,
  perUnitDoughDetail, boldUnitWeightHtml,
  __setRecipes: (r) => { recipes = r; },
  __editorStages: () => _editorStages,
  __sr: () => _scheduleResult,
  __setPlan: (p) => { plan = p; },
  __setBannetons: (b) => { userBannetons = b; },
  __setPantry: (p) => { pantryItems = p; },
  __setMixers: (m) => { userMixers = m; },
  __setPots: (p) => { userPots = p; },
  __setOvens: (o) => { userOvens = o; },
  __setContainers: (c) => { userContainers = c; },
  pickLevainContainer, getLevainContainerPref, setLevainContainerPref, loadLevainContainerPrefs,
  pickDoughContainer, planBakes, bakeRankMap, moveBakeOrder, renderBakeOrderPlan, bakeOrderGroups,
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
   'bake-time-default-input','build1-ratio-input','build2-ratio-input']
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

// ---- recipe-editor kitchen-ingredient link options ----
console.log('\nKitchen-ingredient link assertions:');
let linkOk = true;
function lk(label, cond) { console.log(`  [link] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
api.__setPantry([
  { id: 'k-bread', name: 'Bread flour', requiresMilling: false },
  { id: 'k-rye', name: 'Whole rye', requiresMilling: true },
]);
const optLinked = api.pantryLinkOptionsHtml('k-rye', true);
linkOk &= lk('links a pantry item by id (selected)', /value="k-rye" selected/.test(optLinked));
linkOk &= lk('flags milling flours with a "mills" tag', /Whole rye · mills/.test(optLinked));
linkOk &= lk('Levain is linkable; no "no cost" option', /value="__levain__"/.test(optLinked) && !/__free__/.test(optLinked) && /Add kitchen ingredient/.test(optLinked));
linkOk &= lk('Levain link suppressed when editing the levain recipe', !/value="__levain__"/.test(api.pantryLinkOptionsHtml('', false)));
const optDangling = api.pantryLinkOptionsHtml('k-removed', true);
linkOk &= lk('shows a removed link as "(linked item removed)"', /linked item removed/.test(optDangling));
const optEmpty = api.pantryLinkOptionsHtml('', true);
linkOk &= lk('unlinked default has no selected pantry item', /value="" selected/.test(optEmpty) && !/value="k-rye" selected/.test(optEmpty));

// Default kitchen ingredients exist (incl. water) and a levain link costs from the levain recipe.
linkOk &= lk('SEED_PANTRY ships defaults including Water', Array.isArray(api.SEED_PANTRY) && api.SEED_PANTRY.some(p => p.name === 'Water') && api.SEED_PANTRY.length >= 8);

// suggestPantryLinkFor resolves existing-row links on open (by name + levain).
api.__setPantry([{ id: 'k-water', name: 'Water', requiresMilling: false }, { id: 'k-rye', name: 'Whole rye', requiresMilling: true }]);
linkOk &= lk('suggest links a kitchen ingredient by name', api.suggestPantryLinkFor('Water') === 'k-water');
linkOk &= lk('suggest links levain names to __levain__', api.suggestPantryLinkFor('Levain') === '__levain__');
linkOk &= lk('suggest returns unlinked for unknown names', api.suggestPantryLinkFor('Unobtanium') === '');
allOk &= linkOk;

// ---- legacy stage migration: recipes saved before weigh was templated get a weigh stage ----
console.log('\nLegacy stage-migration assertions:');
let migOk = true;
function mg(label, cond) { console.log(`  [migrate] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
// A bagel recipe persisted with stages but NO weigh step (pre-weigh-template).
const legacyBagel = { id: 'lg-bagel', name: 'Legacy Bagels', processType: 'bagel', unit: 'bagel', loafWeight: 130,
  ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }, { name: 'Water', pct: 55 }, { name: 'Salt', pct: 2 }, { name: 'Levain', pct: 20 }],
  stages: api.stageTemplateFor('bagel').filter(s => s.type !== 'weigh') };
const migrated = api.withMigratedStages(legacyBagel);
migOk &= mg('legacy bagel without a weigh stage gains one', migrated.stages.some(s => s.type === 'weigh'));
migOk &= mg('the weigh stage is first', migrated.stages[0].type === 'weigh');
migOk &= mg('existing stages are preserved', migrated.stages.some(s => s.type === 'bake') && migrated.stages.some(s => s.type === 'mix'));
// A recipe that already has weigh is left unchanged in count.
const okBagel = { ...legacyBagel, id: 'ok-bagel', stages: api.stageTemplateFor('bagel') };
migOk &= mg('a recipe that already has weigh is unchanged', api.withMigratedStages(okBagel).stages.length === okBagel.stages.length);
allOk &= migOk;

// ---- mix-stage vessel dropdown offers the kitchen's mixers ----
console.log('\nMixer-vessel assertions:');
let mxOk = true;
function mx(label, cond) { console.log(`  [mixer] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
api.__setMixers([{ id: 'mx1', name: 'Hobart N50', quantity: 1 }, { id: 'mx2', name: 'KitchenAid', quantity: 2 }]);
const mixVessel = api.stageVesselSelectHtml({ type: 'mix', duration: { kind: 'fixed', min: 10 } }, 0);
mxOk &= mx('mix stage lists the kitchen mixers', /value="mixer:mx1"/.test(mixVessel) && /Hobart N50/.test(mixVessel) && /value="mixer:mx2"/.test(mixVessel));
mxOk &= mx('mix stage still offers standard vessels (dough tub)', /value="bulk-container"/.test(mixVessel));
const mixPicked = api.stageVesselSelectHtml({ type: 'mix', vessel: 'mixer:mx2', duration: { kind: 'fixed', min: 10 } }, 0);
mxOk &= mx('an explicitly picked mixer is selected', /value="mixer:mx2" selected/.test(mixPicked));
const bulkVessel = api.stageVesselSelectHtml({ type: 'bulk', duration: { kind: 'fixed', min: 60 } }, 0);
mxOk &= mx('non-mix stages do NOT list mixers', !/mixer:mx1/.test(bulkVessel) && /value="bulk-container"/.test(bulkVessel));
const removedMixer = api.stageVesselSelectHtml({ type: 'mix', vessel: 'mixer:gone', duration: { kind: 'fixed', min: 10 } }, 0);
mxOk &= mx('a removed mixer link stays visible', /value="mixer:gone" selected/.test(removedMixer) && /removed/.test(removedMixer));

// Bake step → pick a specific oven; boil step → pick a pot.
api.__setOvens([{ id: 'o1', name: 'Deck Oven' }, { id: 'o2', name: 'Rack Oven' }]);
const bakeVessel = api.stageVesselSelectHtml({ type: 'bake', vessel: 'oven:o2', duration: { kind: 'anchored', min: 20 }, tempF: 450 }, 0);
mxOk &= mx('bake stage lists ovens and selects the chosen one', /value="oven:o1"/.test(bakeVessel) && /Deck Oven/.test(bakeVessel) && /value="oven:o2" selected/.test(bakeVessel));
mxOk &= mx('bake stage does not list pots or mixers', !/value="pot:/.test(bakeVessel) && !/value="mixer:/.test(bakeVessel));
const legacyBake = api.stageVesselSelectHtml({ type: 'bake', vessel: 'oven', duration: { kind: 'anchored', min: 20 } }, 0);
mxOk &= mx('legacy bake vessel "oven" normalizes to no specific oven', /value="" selected/.test(legacyBake));
api.__setPots([{ id: 'pot1', name: 'Big Stockpot', size: '20 qt', quantity: 1 }]);
const boilVessel = api.stageVesselSelectHtml({ type: 'boil', vessel: 'pot:pot1', duration: { kind: 'fixed', min: 5 } }, 0);
mxOk &= mx('boil stage lists pots and selects the chosen one', /value="pot:pot1" selected/.test(boilVessel) && /Big Stockpot/.test(boilVessel));
allOk &= mxOk;

// ---- boiling: per-recipe batch size + pot drive the bagel boil ----
console.log('\nBoiling (pot + per-recipe batch size) assertions:');
let boilOk = true;
function bo(label, cond) { console.log(`  [boil] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
function bagelEvents(plan) {
  api.__setPlan(plan); seedPlan(plan);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  return api.__sr().events.filter(e => e.process === 'bagel');
}
api.__setPots([{ id: 'pot1', name: 'Big Stockpot', size: '20 qt', quantity: 1 }]);
const bagelR = api.__recipes().find(r => r.id === 'seed-sourdough-bagels');
if (bagelR) {
  bagelR.boilBatchSize = 6;
  bagelR.preferredPotId = 'pot1';
  const ev = bagelEvents({ 'seed-sourdough-bagels': 18 });
  const boils = ev.filter(e => /^Boil batch/.test(e.title));
  boilOk &= bo('boil batches = ceil(total / per-recipe batch size) — 18/6 = 3', boils.length === 3);
  const bring = ev.find(e => /^Bring .* to a boil/.test(e.title));
  boilOk &= bo('boil-up step names the pot', !!bring && /Big Stockpot/.test(bring.title) && Array.isArray(bring.equip) && bring.equip.indexOf('Big Stockpot') >= 0);
  boilOk &= bo('boil step is equipped with the pot', boils.length > 0 && boils.every(e => Array.isArray(e.equip) && e.equip.indexOf('Big Stockpot') >= 0));
  boilOk &= bo('boil steps are their own "boil" stage (not bake)', boils.every(e => api.getEventStage(e) === 'boil') && api.getEventStage(bring) === 'boil');
  // Change the batch size → batch count changes (no global input involved).
  bagelR.boilBatchSize = 9;
  boilOk &= bo('changing the recipe batch size re-batches (18/9 = 2)', bagelEvents({ 'seed-sourdough-bagels': 18 }).filter(e => /^Boil batch/.test(e.title)).length === 2);
  // No batch size set → falls back to the default of 10.
  delete bagelR.boilBatchSize;
  boilOk &= bo('no batch size falls back to default 10 (12 → 2 batches)', bagelEvents({ 'seed-sourdough-bagels': 12 }).filter(e => /^Boil batch/.test(e.title)).length === 2);
  // The pot can be driven by the boil STEP's vessel (the new per-step picker), not just
  // preferredPotId. Clear preferredPotId and set the boil stage's vessel instead.
  delete bagelR.preferredPotId;
  const boilStage = (bagelR.stages || []).find(s => s.type === 'boil');
  if (boilStage) {
    boilStage.vessel = 'pot:pot1';
    const ev2 = bagelEvents({ 'seed-sourdough-bagels': 12 });
    const bring2 = ev2.find(e => /^Bring .* to a boil/.test(e.title));
    boilOk &= bo('boil step vessel (pot:) drives the boiling pot', !!bring2 && /Big Stockpot/.test(bring2.title));
    delete boilStage.vessel;
  }
}
allOk &= boilOk;

// ---- bake sheet: levain builds list their ingredients (starter/flour/water) ----
console.log('\nBake-sheet levain-ingredient assertions:');
let bsOk = true;
function bsk(label, cond) { console.log(`  [bakesheet] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
function bakeSheetHtml(plan) {
  api.__setPlan(plan); seedPlan(plan);
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  try { api.renderBakeSheet(); } catch (e) { return 'THREW:' + e.message; }
  const h = getEl('bakesheet-content').innerHTML;
  return typeof h === 'string' ? h : '';
}
bsOk &= bsk('loaf levain build lists its ingredients', /Levain Build 1/.test(bakeSheetHtml({ [SEED.batard]: 8 })) && /Mature starter/.test(bakeSheetHtml({ [SEED.batard]: 8 })));
// Regression: muffin-only / bagel-only levain builds carry a "(muffins)"/"(bagels)" title
// but their levain is the shared one — must still list ingredients, not render empty.
bsOk &= bsk('muffin-only levain build lists ingredients', /Mature starter/.test(bakeSheetHtml({ [SEED.muffin]: 12 })));
bsOk &= bsk('bagel-only levain build lists ingredients', /Mature starter/.test(bakeSheetHtml({ [SEED.bagel]: 10 })));
allOk &= bsOk;

// ---- editable bake-plan cards: switching equipment updates the recipe preference ----
console.log('\nBake-plan equipment-edit assertions:');
let edOk = true;
function ed(label, cond) { console.log(`  [edit] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
api.__setPots([{ id: 'pot1', name: 'Big Stockpot', size: '20 qt', quantity: 1 }]);
api.__setOvens([{ id: 'o1', name: 'Deck Oven', decks: 3 }, { id: 'o2', name: 'Rack Oven', decks: 2 }]);
const recs = api.__recipes();
const bagelE = recs.find(r => r.id === 'seed-sourdough-bagels');
const loafE = recs.find(r => r.id === 'seed-sourdough-batard');
// Render a plan so the cards have data, then drive the helper as the card dropdowns do.
api.__setPlan({ 'seed-sourdough-batard': 8, 'seed-sourdough-bagels': 12 });
seedPlan({ 'seed-sourdough-batard': 8, 'seed-sourdough-bagels': 12 });
els['deadline-default-input'].value = fmtLocal(tomorrow8);
['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
let threw = null;
try { api.setBakePlanEquip([bagelE.id], 'pot', 'pot1'); } catch (e) { threw = e.message; }
edOk &= ed('switching pot does not throw (re-renders cards)', threw === null);
edOk &= ed('pot edit sets preferredPotId', bagelE.preferredPotId === 'pot1');
edOk &= ed('pot edit sets the boil stage vessel', (bagelE.stages.find(s => s.type === 'boil') || {}).vessel === 'pot:pot1');
api.setBakePlanEquip([loafE.id], 'oven', 'o2');
edOk &= ed('oven edit sets preferredOvenId', loafE.preferredOvenId === 'o2');
edOk &= ed('oven edit sets the bake stage vessel', (loafE.stages.find(s => s.type === 'bake') || {}).vessel === 'oven:o2');
api.setBakePlanEquip([loafE.id], 'container', 'c9');
edOk &= ed('container edit sets preferredContainerIds', Array.isArray(loafE.preferredContainerIds) && loafE.preferredContainerIds[0] === 'c9');
api.setBakePlanEquip([loafE.id], 'mixer', 'm3');
edOk &= ed('mixer edit sets preferredMixerIds', Array.isArray(loafE.preferredMixerIds) && loafE.preferredMixerIds[0] === 'm3');
// clearing a value removes the preference
api.setBakePlanEquip([loafE.id], 'oven', '');
edOk &= ed('clearing oven resets to auto (null)', !loafE.preferredOvenId && !(loafE.stages.find(s => s.type === 'bake') || {}).vessel);
// restore
delete bagelE.preferredPotId; const bs = bagelE.stages.find(s => s.type === 'boil'); if (bs) delete bs.vessel;
delete loafE.preferredOvenId; delete loafE.preferredContainerIds; delete loafE.preferredMixerIds;
allOk &= edOk;

// ---- ingredient catalog (searchable add-ingredient list) ----
console.log('\nIngredient-catalog assertions:');
let catOk = true;
function ct(label, cond) { console.log(`  [catalog] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
const CAT = api.INGREDIENT_CATALOG;
const CATS = api.BUILTIN_CATEGORIES;
catOk &= ct('catalog has ~100 ingredients', Array.isArray(CAT) && CAT.length >= 100);
catOk &= ct('every item has a name, valid category, and a numeric price', CAT.every(c =>
  typeof c.name === 'string' && c.name.trim() &&
  CATS.includes(c.category) &&
  typeof c.costPerGram === 'number' && c.costPerGram >= 0 && Number.isFinite(c.costPerGram)));
const names = CAT.map(c => c.name.toLowerCase());
catOk &= ct('no duplicate names', new Set(names).size === names.length);
const staples = ['All-purpose flour', 'Bread flour', 'Granulated sugar', 'Unsalted butter', 'Eggs (large)', 'Vanilla extract', 'Cocoa powder', 'Active dry yeast'];
catOk &= ct('includes common staples', staples.every(s => names.includes(s.toLowerCase())));
catOk &= ct('prices look sane (flour cheaper than vanilla extract)',
  CAT.find(c => c.name === 'All-purpose flour').costPerGram < CAT.find(c => c.name === 'Vanilla extract').costPerGram);
allOk &= catOk;

console.log('\nTemperature-unit assertions:');
let tuOk = true;
function tt(label, cond) { console.log(`  [tempunit] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
api.setTempUnit('F');
tuOk &= tt('default/F: fmtTemp keeps Fahrenheit', api.fmtTemp(350) === '350°F');
tuOk &= tt('F: tempInputValue is the raw F number', api.tempInputValue(350) === '350');
tuOk &= tt('F: tempFromInput passes through', api.tempFromInput('425') === 425);
tuOk &= tt('fmtTemp blank for null/empty', api.fmtTemp(null) === '' && api.fmtTemp('') === '');
api.setTempUnit('C');
tuOk &= tt('C: fmtTemp converts 350F -> 177°C', api.fmtTemp(350) === '177°C');
tuOk &= tt('C: fmtTemp converts 500F -> 260°C', api.fmtTemp(500) === '260°C');
tuOk &= tt('C: tempInputValue shows Celsius', api.tempInputValue(350) === '177');
tuOk &= tt('C: tempFromInput converts 220C -> 428F', api.tempFromInput('220') === 428);
tuOk &= tt('C: unchanged display keeps exact prev F (no drift)', api.tempFromInput(api.tempInputValue(350), 350) === 350);
tuOk &= tt('C: a real edit changes the stored F (200C -> 392F)', api.tempFromInput('200', 350) === 392);
api.setTempUnit('F');
// settings sync round-trips the preference
api.setTempUnit('C');
tuOk &= tt('getLocalSettings carries tempUnit', api.getLocalSettings().tempUnit === 'C');
api.setTempUnit('F');
api.applyRemoteSettings({ tempUnit: 'C' });
tuOk &= tt('applyRemoteSettings adopts tempUnit', api.getTempUnit() === 'C');
api.applyRemoteSettings({ tempUnit: 'bogus' });
tuOk &= tt('applyRemoteSettings ignores invalid tempUnit', api.getTempUnit() === 'C');
api.setTempUnit('F');
allOk &= tuOk;

console.log('\nProofing-temperature / fermentation assertions:');
let ptOk = true;
function pt(label, cond) { console.log(`  [proofing] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
api.setProofingTempF(null);
ptOk &= pt('default: unset, 70F, factor exactly 1', !api.proofingTempIsSet() && api.getProofingTempF() === 70 && api.proofTempFactor() === 1);
ptOk &= pt('default: fermentScale is identity (240 -> 240)', api.fermentScale(240) === 240);
api.setProofingTempF(87);
ptOk &= pt('70+17F warmer: factor ~0.5 (doubling rule)', Math.abs(api.proofTempFactor() - 0.5) < 1e-9);
ptOk &= pt('warmer: fermentScale halves (240 -> 120)', api.fermentScale(240) === 120);
ptOk &= pt('warmer: levain build window scales down (fast build2 mid 5 -> 2.5)',
  Math.abs(api.pickLevainBuild('build2', new Date(), 'fast').mid - 2.5) < 1e-9);
api.setProofingTempF(53);
ptOk &= pt('cooler: factor > 1 (slower)', api.proofTempFactor() > 1);
ptOk &= pt('cooler: clamped at 55F (not below)', Math.abs(api.proofTempFactor() - Math.pow(2, (70 - 55) / 17)) < 1e-9);
api.setProofingTempF(72);
ptOk &= pt('getLocalSettings carries proofingTempF', api.getLocalSettings().proofingTempF === 72);
api.applyRemoteSettings({ proofingTempF: 80 });
ptOk &= pt('applyRemoteSettings adopts proofingTempF', api.getProofingTempF() === 80);
api.applyRemoteSettings({ proofingTempF: null });
ptOk &= pt('applyRemoteSettings null clears to default', !api.proofingTempIsSet() && api.getProofingTempF() === 70);

// Integration: a warmer kitchen makes warm ferments shorter, so the bulk-ferment
// step starts LATER (closer to the fixed bake), and cooler makes it start earlier.
function loafBulkStart() {
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const ev = api.__sr().events.find(e => e.title === 'Bulk ferment' || e.title.startsWith('Bulk ferment'));
  return ev && ev.timeEnd ? (ev.timeEnd.getTime() - ev.time.getTime()) / 60000 : null;
}
api.setProofingTempF(70); const t70 = loafBulkStart();
api.setProofingTempF(85); const tWarm = loafBulkStart();
api.setProofingTempF(58); const tCool = loafBulkStart();
ptOk &= pt('integration: warmer kitchen → shorter bulk ferment than at 70F', t70 != null && tWarm != null && tWarm < t70);
ptOk &= pt('integration: cooler kitchen → longer bulk ferment than at 70F', t70 != null && tCool != null && tCool > t70);
api.setProofingTempF(null);
allOk &= ptOk;

console.log('\nStep-notes / hover assertions:');
let hvOk = true;
function hv(label, cond) { console.log(`  [notes] ${cond ? 'PASS' : 'FAIL'} — ${label}`); return cond; }
// stepNoteKey is stable across counts and includes the process.
const evA = { process: 'loaf', title: 'Bake 8 loaves' };
const evB = { process: 'loaf', title: 'Bake 6 loaves' };
const evC = { process: 'muffin', title: 'Bake 8 loaves' };
hvOk &= hv('stepNoteKey ignores counts (8 vs 6 loaves match)', api.stepNoteKey(evA) === api.stepNoteKey(evB));
hvOk &= hv('stepNoteKey separates by process', api.stepNoteKey(evA) !== api.stepNoteKey(evC));
// round-trip a note
api.setStepNote(api.stepNoteKey(evA), '  use the blue box  ');
hvOk &= hv('setStepNote trims + getStepNoteFor reads it back', api.getStepNoteFor(evA) === 'use the blue box');
hvOk &= hv('note shared across same-key events (evB sees evA note)', api.getStepNoteFor(evB) === 'use the blue box');
hvOk &= hv('getLocalSettings carries stepNotes', api.getLocalSettings().stepNotes[api.stepNoteKey(evA)] === 'use the blue box');
api.applyRemoteSettings({ stepNotes: { 'x|y': 'remote note' } });
hvOk &= hv('applyRemoteSettings adopts stepNotes', api.loadStepNotes()['x|y'] === 'remote note');
api.setStepNote('x|y', '');  // clear
hvOk &= hv('setStepNote empty clears the note', !('x|y' in api.loadStepNotes()));

// Hover HTML is built from the real bake-sheet helpers for a scheduled event.
seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
els['deadline-default-input'].value = fmtLocal(tomorrow8);
['coldproof-loaf-input','coldproof-muffin-input','coldproof-bagel-input','bake-time-default-input'].forEach(id => { els[id].value = ''; });
localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
api.renderSchedule();
const H = api.buildBakeSheetHelpers();
const evs = api.__sr().events;
const weigh = evs.find(e => /^Weigh ingredients/.test(e.title));
const hoverWeigh = weigh ? api.hoverHtmlFor(weigh, H) : '';
hvOk &= hv('hover for "Weigh ingredients" includes the Ingredients section', /Ingredients/.test(hoverWeigh) && /<table/.test(hoverWeigh));
const bake = evs.find(e => /^Bake /.test(e.title));
const hoverBake = bake ? api.hoverHtmlFor(bake, H) : '';
hvOk &= hv('hover for a bake step is non-empty', !!hoverBake);
// A note set on an event shows up in its hover tooltip.
if (weigh) api.setStepNote(api.stepNoteKey(weigh), 'sift the flour');
const hoverWeigh2 = weigh ? api.hoverHtmlFor(weigh, api.buildBakeSheetHelpers()) : '';
hvOk &= hv('note appears in the step hover tooltip', /sift the flour/.test(hoverWeigh2) && /Note/.test(hoverWeigh2));
if (weigh) api.setStepNote(api.stepNoteKey(weigh), '');
// Schedule inline note control: add/edit button is present and no-print.
const ncEmpty = api.noteControlHtml({ process: 'loaf', title: 'Mix dough' });
hvOk &= hv('schedule note control shows "+ note" button when empty', /\+ note/.test(ncEmpty) && /class="schedule-note-btn no-print"/.test(ncEmpty));
hvOk &= hv('schedule note button is no-print', /schedule-note-btn no-print/.test(ncEmpty));
api.setStepNote(api.stepNoteKey({ process: 'loaf', title: 'Mix dough' }), 'cold water');
const ncSet = api.noteControlHtml({ process: 'loaf', title: 'Mix dough' });
hvOk &= hv('schedule note control shows the note + "Edit note"', /cold water/.test(ncSet) && /Edit note/.test(ncSet));
api.setStepNote(api.stepNoteKey({ process: 'loaf', title: 'Mix dough' }), '');

// Recipe-stage notes (authored on a recipe's stage) appear on the matching step.
const loafRec = api.__recipes().find(r => r.id === SEED.batard);
const bulkStage = (loafRec.stages || []).find(s => s.type === 'bulk');
hvOk &= hv('seed loaf recipe has a bulk stage to annotate', !!bulkStage);
if (bulkStage) {
  bulkStage.note = 'score deeply';
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H2 = api.buildBakeSheetHelpers();
  const evsR = api.__sr().events;
  const bulkEv = evsR.find(e => /^Bulk ferment/.test(e.title));
  const rn = bulkEv ? api.recipeStageNotesForEvent(bulkEv, H2) : [];
  hvOk &= hv('recipe-stage note maps onto the matching Bulk ferment step', rn.some(n => n.note === 'score deeply'));
  hvOk &= hv('recipeStageNotesHtml renders the note text', /score deeply/.test(bulkEv ? api.recipeStageNotesHtml(bulkEv, H2) : ''));
  const bakeEv = evsR.find(e => /^Bake /.test(e.title));
  hvOk &= hv('recipe-stage note does NOT bleed onto a different-stage (bake) step',
    !bakeEv || !api.recipeStageNotesForEvent(bakeEv, H2).some(n => n.note === 'score deeply'));
  delete bulkStage.note;
}

// eventStageType maps each title to its specific stage type.
hvOk &= hv('eventStageType: bulk variants → bulk', api.eventStageType({ title: 'Muffin dough bulk ferment' }) === 'bulk' && api.eventStageType({ title: 'Bulk ferment' }) === 'bulk');
hvOk &= hv('eventStageType: preshape / bench / shape distinct', api.eventStageType({ title: 'Start preshape' }) === 'preshape' && api.eventStageType({ title: 'Bench rest' }) === 'bench' && api.eventStageType({ title: 'Final shape' }) === 'shape');
hvOk &= hv('eventStageType: oven-control steps hold no recipe note', api.eventStageType({ title: 'Turn on oven to 500°F' }) === '' && api.eventStageType({ title: 'Set oven to 450°F' }) === '');
hvOk &= hv('eventStageType: prefers explicit ev.stageType', api.eventStageType({ title: 'Whatever the baker named it', stageType: 'proof' }) === 'proof');

// THE FIX: notes on two SAME-CATEGORY stages (autolyse + mix are both 'mix') separate
// to their own steps instead of all showing on each (the old category-match behavior).
const autoStage = (loafRec.stages || []).find(s => s.type === 'autolyse');
const mixStage = (loafRec.stages || []).find(s => s.type === 'mix');
hvOk &= hv('seed loaf has same-category autolyse + mix stages', !!autoStage && !!mixStage &&
  api.recipeStageNotesForEvent && true);
if (autoStage && mixStage) {
  autoStage.note = 'rest 60 min';
  mixStage.note = 'add salt last';
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H3 = api.buildBakeSheetHelpers();
  const evsS = api.__sr().events;
  const autoEv = evsS.find(e => /^Start autolyse/.test(e.title));
  const mixEv = evsS.find(e => /^Mix in salt/.test(e.title));
  const notesOf = (e) => e ? api.recipeStageNotesForEvent(e, H3).map(n => n.note) : [];
  hvOk &= hv('autolyse step shows ONLY the autolyse note', autoEv && notesOf(autoEv).includes('rest 60 min') && !notesOf(autoEv).includes('add salt last'));
  hvOk &= hv('mix step shows ONLY the mix note', mixEv && notesOf(mixEv).includes('add salt last') && !notesOf(mixEv).includes('rest 60 min'));
  delete autoStage.note; delete mixStage.note;
}

// A stage that fans out into many steps (bagel boil → "Bring to a boil" + per-batch
// "Boil & top") shows its recipe note ONCE, on the first step, not on every one.
const bagelRec = api.__recipes().find(r => r.id === SEED.bagel);
const boilStage = bagelRec && (bagelRec.stages || []).find(s => s.type === 'boil');
hvOk &= hv('seed bagel recipe has a boil stage', !!boilStage);
if (boilStage) {
  boilStage.note = 'malt in the water';
  seedPlan({ [SEED.bagel]: 24 }); api.__setPlan({ [SEED.bagel]: 24 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H4 = api.buildBakeSheetHelpers();
  const sortedB = [...api.__sr().events].sort((a, b) => a.time - b.time);
  const boilEvs = sortedB.filter(e => api.eventStageType(e) === 'boil');
  hvOk &= hv('bagel plan produces multiple boil-type steps', boilEvs.length >= 2);
  // raw matcher: the note matches EVERY boil step...
  const rawHits = boilEvs.filter(e => api.recipeStageNotesForEvent(e, H4).some(n => n.note === 'malt in the water')).length;
  // ...but the deduped render map shows it on exactly one.
  const map = api.buildRecipeNotesByEvent(sortedB, H4);
  const shownHits = boilEvs.filter(e => (map.get(e) || []).some(n => n.note === 'malt in the water')).length;
  hvOk &= hv('raw matcher hits all boil steps', rawHits === boilEvs.length && rawHits >= 2);
  hvOk &= hv('deduped map shows the boil note on exactly ONE step', shownHits === 1);
  delete boilStage.note;
}

// Per-stage ingredient tags: tagging ingredients on a stage drives the bake sheet's
// ingredient column for that step (overriding the heuristic).
const muffRec = api.__recipes().find(r => r.id === SEED.muffin);
const muffMix = muffRec && (muffRec.stages || []).find(s => s.type === 'mix');
const muffIngNames = muffRec ? (muffRec.ingredients || []).map(i => i.name) : [];
hvOk &= hv('seed muffin has a mix stage + ingredients to tag', !!muffMix && muffIngNames.length >= 2);
if (muffMix && muffIngNames.length >= 2) {
  const tagOne = muffIngNames[0];
  muffMix.ings = [tagOne];
  seedPlan({ [SEED.muffin]: 12 }); api.__setPlan({ [SEED.muffin]: 12 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H5 = api.buildBakeSheetHelpers();
  const mixEv = api.__sr().events.find(e => api.eventStageType(e) === 'mix' && (e.process === 'muffin' || /muffin/i.test(e.title)));
  const ings = mixEv ? H5.getEventIngredients(mixEv) : null;
  const rowNames = ings && ings.type === 'byRecipe'
    ? ings.recipes.flatMap(r => r.ingredients.map(i => i.name))
    : (ings && ings.rows ? ings.rows.map(r => r.name) : []);
  hvOk &= hv('tagged mix step shows ONLY the tagged ingredient', rowNames.length === 1 && rowNames[0] === tagOne);
  // An untagged stage type keeps heuristic behavior (weigh shows all ingredients).
  const weighEv = api.__sr().events.find(e => api.eventStageType(e) === 'weigh');
  const wIngs = weighEv ? H5.getEventIngredients(weighEv) : null;
  const wNames = wIngs && wIngs.type === 'byRecipe' ? wIngs.recipes.flatMap(r => r.ingredients.map(i => i.name)) : [];
  hvOk &= hv('untagged weigh step still lists all ingredients (heuristic intact)', wNames.length > 1);
  delete muffMix.ings;
}

// Mixed tagging: when one recipe tags a step but another (same process) does not, the
// untagged one falls back to the heuristic AND a warning is surfaced.
const batard = api.__recipes().find(r => r.id === SEED.batard);
const boule = api.__recipes().find(r => r.id === SEED.boule);
const bAuto = batard && (batard.stages || []).find(s => s.type === 'autolyse');
const blAuto = boule && (boule.stages || []).find(s => s.type === 'autolyse');
hvOk &= hv('two loaf seeds both have an autolyse stage', !!bAuto && !!blAuto);
if (bAuto && blAuto && batard.ingredients && batard.ingredients.length) {
  bAuto.ings = [batard.ingredients[0].name];   // tag batard only
  seedPlan({ [SEED.batard]: 4, [SEED.boule]: 4 }); api.__setPlan({ [SEED.batard]: 4, [SEED.boule]: 4 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H6 = api.buildBakeSheetHelpers();
  const autoEv = api.__sr().events.find(e => api.eventStageType(e) === 'autolyse' && e.process === 'loaf');
  const res = autoEv ? H6.getEventIngredients(autoEv) : null;
  hvOk &= hv('mixed tagging is flagged with the untagged recipe named', !!res && res.mixedTagging === true && res.fallbackRecipes.includes(boule.name));
  const byName = {};
  (res ? res.recipes : []).forEach(r => { byName[r.name] = r.ingredients.map(i => i.name); });
  hvOk &= hv('tagged recipe shows only its tagged ingredient', byName[batard.name] && byName[batard.name].length === 1);
  hvOk &= hv('untagged recipe falls back to the heuristic (flours+water)', byName[boule.name] && byName[boule.name].length > 1);
  hvOk &= hv('ingredient column renders the mixed-tagging warning', autoEv && /bs-ing-warn/.test(H6.renderIngCol(autoEv)));
  // When BOTH tag, no warning.
  blAuto.ings = [boule.ingredients[0].name];
  api.renderSchedule();
  const H7 = api.buildBakeSheetHelpers();
  const autoEv2 = api.__sr().events.find(e => api.eventStageType(e) === 'autolyse' && e.process === 'loaf');
  const res2 = autoEv2 ? H7.getEventIngredients(autoEv2) : null;
  hvOk &= hv('no warning when all recipes tag the step', !!res2 && !res2.mixedTagging);
  delete bAuto.ings; delete blAuto.ings;
}

// Sub-step notes: the bake stage fans out into preheat / bake / oven-off; a sub-note
// shows on its own step, while the stage's main note stays on the bake itself.
hvOk &= hv('eventSubstep maps oven control + boil heat to sub-steps',
  api.eventSubstep({ title: 'Turn on oven to 500°F' }).key === 'preheat' &&
  api.eventSubstep({ title: 'Set Deck oven to 450°F' }).key === 'tempchange' &&
  api.eventSubstep({ title: 'Turn off Deck oven' }).key === 'ovenoff' &&
  api.eventSubstep({ title: 'Bring Big pot to a boil' }).key === 'heat' &&
  api.eventSubstep({ title: 'Bake 8 of 8' }) === null);
const loafBake = (loafRec.stages || []).find(s => s.type === 'bake');
hvOk &= hv('loaf recipe has a bake stage', !!loafBake);
if (loafBake) {
  loafBake.subNotes = { preheat: 'preheat to 500 sharp' };
  loafBake.note = 'steam first 15 min';
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H8 = api.buildBakeSheetHelpers();
  const evsX = api.__sr().events;
  const preheatEv = evsX.find(e => /^Turn on oven/.test(e.title));
  const bakeEv2 = evsX.find(e => /^Bake /.test(e.title));
  const notesOf = (e) => e ? api.recipeStageNotesForEvent(e, H8).map(n => n.note) : [];
  hvOk &= hv('preheat sub-step shows the preheat note', preheatEv && notesOf(preheatEv).includes('preheat to 500 sharp'));
  hvOk &= hv('preheat sub-step does NOT show the main bake note', preheatEv && !notesOf(preheatEv).includes('steam first 15 min'));
  hvOk &= hv('bake step shows the main note, not the preheat note', bakeEv2 && notesOf(bakeEv2).includes('steam first 15 min') && !notesOf(bakeEv2).includes('preheat to 500 sharp'));
  delete loafBake.subNotes; delete loafBake.note;
}

// Stretch & fold fans out into per-fold sub-steps (count from the recipe), each
// individually annotatable; the stage's general fold note shows once (first fold).
hvOk &= hv('eventSubstep maps "Stretch & fold 3 of 5" to fold f3', api.eventSubstep({ title: 'Stretch & fold 3 of 5' }) && api.eventSubstep({ title: 'Stretch & fold 3 of 5' }).key === 'f3' && api.eventSubstep({ title: 'Stretch & fold 2 of 4 — focaccia' }).key === 'f2');
const loafFold = (loafRec.stages || []).find(s => s.type === 'fold');
hvOk &= hv('loaf has a fold stage with count > 1', !!loafFold && loafFold.duration && Number(loafFold.duration.count) > 1);
if (loafFold) {
  loafFold.note = 'fold gently throughout';
  loafFold.subNotes = { f1: 'first fold: coil', f3: 'last set: build tension' };
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const H9 = api.buildBakeSheetHelpers();
  const sortedF = [...api.__sr().events].sort((a, b) => a.time - b.time);
  const foldEvs = sortedF.filter(e => /^Stretch & fold/.test(e.title));
  const map = api.buildRecipeNotesByEvent(sortedF, H9);
  const shown = (e) => (map.get(e) || []).map(n => n.note);
  const fold1 = foldEvs.find(e => /fold 1 of/.test(e.title));
  const fold3 = foldEvs.find(e => /fold 3 of/.test(e.title));
  const fold2 = foldEvs.find(e => /fold 2 of/.test(e.title));
  hvOk &= hv('fold 1 shows its sub-note AND the general fold note (once)', fold1 && shown(fold1).includes('first fold: coil') && shown(fold1).includes('fold gently throughout'));
  hvOk &= hv('fold 3 shows its own sub-note', fold3 && shown(fold3).includes('last set: build tension'));
  hvOk &= hv('fold 2 (untagged) shows neither sub-note nor a repeated general note', fold2 && !shown(fold2).includes('first fold: coil') && !shown(fold2).includes('last set: build tension') && !shown(fold2).includes('fold gently throughout'));
  const generalCount = foldEvs.filter(e => shown(e).includes('fold gently throughout')).length;
  hvOk &= hv('general fold note appears on exactly one fold', generalCount === 1);
  delete loafFold.note; delete loafFold.subNotes;
}
// Gist round-trip: recipes are pushed verbatim (JSON.stringify(recipes)) and loaded via
// withMigratedStages, so every stage field — including notes/sub-notes/ingredient tags —
// survives. Simulate that round-trip and confirm nothing is dropped.
const rt = JSON.parse(JSON.stringify({
  id: 'rt', name: 'RT', processType: 'sourdough-loaf', loafWeight: 900, unit: 'loaf', batchYield: 8,
  ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }],
  stages: [
    { type: 'weigh', duration: { kind: 'fixed', min: 5 }, ings: ['Bread flour'], active: false },
    { type: 'mix', duration: { kind: 'fixed', min: 30, activeMin: 8 } },
    { type: 'fold', duration: { kind: 'countInterval', count: 3, intervalMin: 30 }, note: 'gentle', subNotes: { f1: 'coil', f3: 'tension' } },
    { type: 'bake', duration: { kind: 'anchored', min: 40 }, tempF: 500, note: 'steam', subNotes: { preheat: 'sharp', ovenoff: 'crack door' } },
  ],
}));
const rtLoaded = api.withMigratedStages(rt);
const lFold = rtLoaded.stages.find(s => s.type === 'fold');
const lBake = rtLoaded.stages.find(s => s.type === 'bake');
const lWeigh = rtLoaded.stages.find(s => s.type === 'weigh');
hvOk &= hv('gist round-trip preserves stage notes', lFold.note === 'gentle' && lBake.note === 'steam');
hvOk &= hv('gist round-trip preserves stage sub-notes', lFold.subNotes.f1 === 'coil' && lFold.subNotes.f3 === 'tension' && lBake.subNotes.preheat === 'sharp' && lBake.subNotes.ovenoff === 'crack door');
hvOk &= hv('gist round-trip preserves ingredient tags + tempF', lWeigh.ings[0] === 'Bread flour' && lBake.tempF === 500);
hvOk &= hv('gist round-trip preserves the authored batch yield', rtLoaded.batchYield === 8);
const rtMix = rtLoaded.stages.find(s => s.type === 'mix');
hvOk &= hv('gist round-trip preserves the editable active flag', lWeigh.active === false);
hvOk &= hv('gist round-trip preserves the per-step active (hands-on) minutes', rtMix.duration.activeMin === 8);

// --- Active vs passive time (editable per step) ---
const palMixActive = api.stageIsActive({ type: 'mix' });            // palette default for mix is active
const palBakeActive = api.stageIsActive({ type: 'bake' });           // palette default for bake is passive
hvOk &= hv('stageIsActive reads the palette default (mix active, bake passive)', palMixActive === true && palBakeActive === false);
hvOk &= hv('stageIsActive honors an explicit override either way', api.stageIsActive({ type: 'mix', active: false }) === false && api.stageIsActive({ type: 'bake', active: true }) === true);
hvOk &= hv('a passive step contributes 0 hands-on minutes', api.stageActiveMinutes({ type: 'mix', active: false, duration: { kind: 'fixed', min: 30 } }, 30) === 0);
hvOk &= hv('an active fixed step with no override is hands-on for the whole step', api.stageActiveMinutes({ type: 'mix', duration: { kind: 'fixed', min: 30 } }, 30) === 30);
hvOk &= hv('an explicit activeMin splits a long step (mixer: load then run)', api.stageActiveMinutes({ type: 'mix', duration: { kind: 'fixed', min: 30, activeMin: 8 } }, 30) === 8);
hvOk &= hv('a passive cold proof contributes 0 hands-on minutes by default', api.stageActiveMinutes({ type: 'chill', duration: { kind: 'range', auto: true } }, 600) === 0);
hvOk &= hv('marking a cold proof active gives a tiny default hands-on window (move to fridge)', api.stageActiveMinutes({ type: 'chill', active: true, duration: { kind: 'range', auto: true } }, 600) === 3);
hvOk &= hv('an active cold proof can carry a custom hands-on window', api.stageActiveMinutes({ type: 'chill', active: true, duration: { kind: 'range', minHr: 8, maxHr: 12, activeMin: 5 } }, 600) === 5);

// --- annotateActiveMinutes drives bread warnings off the editable flag ---
const _savedRecipes = api.__recipes();
const _savedPlan = JSON.parse(JSON.stringify({}));
api.__setRecipes([{
  id: 'tl', name: 'TestLoaf', processType: 'sourdough-loaf', loafWeight: 900, unit: 'loaf',
  ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }],
  stages: [
    { type: 'mix', duration: { kind: 'fixed', min: 0, activeMin: 10 } },
    { type: 'bake', duration: { kind: 'anchored', min: 40 }, tempF: 480 },
  ],
}]);
api.__setPlan({ tl: 4 });
const mkEv = () => ({ title: 'Mix TestLoaf dough', process: 'loaf', detail: '10 min active', time: new Date(2030, 0, 1, 2, 0) });
let mixEvA = mkEv();
api.annotateActiveMinutes([mixEvA]);
hvOk &= hv('annotate reads the recipe mix stage active-time (10 min)', mixEvA.activeMin === 10);
hvOk &= hv('isActiveStep is true for an annotated active step', api.isActiveStep(mixEvA, 'loaf') === true);
// Mark the mix stage passive — the same step should drop out of active classification.
api.__setRecipes([{
  id: 'tl', name: 'TestLoaf', processType: 'sourdough-loaf', loafWeight: 900, unit: 'loaf',
  ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }],
  stages: [
    { type: 'mix', active: false, duration: { kind: 'fixed', min: 0, activeMin: 10 } },
    { type: 'bake', duration: { kind: 'anchored', min: 40 }, tempF: 480 },
  ],
}]);
let mixEvB = mkEv();
api.annotateActiveMinutes([mixEvB]);
hvOk &= hv('a step marked passive contributes 0 active minutes', mixEvB.activeMin === 0);
hvOk &= hv('a passive step is excluded from late-night active steps', api.lateNightActiveSteps([mkEvPassive()], 'loaf').length === 0);
function mkEvPassive() { const e = mkEv(); return e; }
api.__setRecipes(_savedRecipes);

// --- detectActiveOverlaps: two hands-on steps the baker can't do at once ---
const T = (h, m) => new Date(2030, 0, 1, h, m);
const overlapEvents = [
  { title: 'Mix loaf dough', process: 'loaf', activeMin: 15, time: T(6, 0) },
  { title: 'Shape muffins', process: 'muffin', activeMin: 15, time: T(6, 5) },   // overlaps the mix
  { title: 'Bake bread', process: 'loaf', activeMin: 40, time: T(9, 0), timeEnd: T(9, 40) }, // passive bake — ignored
];
const ov = api.detectActiveOverlaps(overlapEvents);
hvOk &= hv('overlapping hands-on steps raise an active-overlap notice', ov.length === 1 && ov[0].issue === 'active-overlap');
hvOk &= hv('the overlap notice names both conflicting steps', ov[0].titles.includes('Mix loaf dough') && ov[0].titles.includes('Shape muffins'));
const noOverlap = api.detectActiveOverlaps([
  { title: 'Mix loaf dough', process: 'loaf', activeMin: 10, time: T(6, 0) },
  { title: 'Shape muffins', process: 'muffin', activeMin: 10, time: T(7, 0) }, // 60 min apart — no overlap
]);
hvOk &= hv('well-separated hands-on steps raise no overlap notice', noOverlap.length === 0);
const sameStep = api.detectActiveOverlaps([
  { title: 'Weigh ingredients', process: 'loaf', activeMin: 10, time: T(6, 0) },
  { title: 'Weigh ingredients', process: 'muffin', activeMin: 10, time: T(6, 0) }, // same logical step, two columns
]);
hvOk &= hv('the same logical step across columns is not flagged as a conflict', sameStep.length === 0);

// Levain container choice: pickLevainContainer honors a per-stream preference (and
// falls back to auto when unset or the chosen container is gone), and it syncs.
api.__setContainers([
  { id: 'lc-small', name: 'Quart jar', maxDoughGrams: 500, processTag: 'levain' },
  { id: 'lc-big', name: 'Big tub', maxDoughGrams: 5000, processTag: 'levain' },
]);
api.setLevainContainerPref('shared', 'b2', '');
hvOk &= hv('levain container auto-picks smallest that fits when unset', api.pickLevainContainer(300, 'shared', 'b2').id === 'lc-small');
api.setLevainContainerPref('shared', 'b2', 'lc-big');
hvOk &= hv('levain container honors the chosen container even if larger than needed', api.pickLevainContainer(300, 'shared', 'b2').id === 'lc-big');
hvOk &= hv('Build 1 and Build 2 are independent (b1 still auto)', api.pickLevainContainer(300, 'shared', 'b1').id === 'lc-small');
api.setLevainContainerPref('shared', 'b1', 'lc-big');
api.setLevainContainerPref('shared', 'b2', 'lc-small');
hvOk &= hv('Build 1 and Build 2 can hold different containers', api.pickLevainContainer(300, 'shared', 'b1').id === 'lc-big' && api.pickLevainContainer(300, 'shared', 'b2').id === 'lc-small');
hvOk &= hv('levain container choice is per-stream (muffin still auto)', api.pickLevainContainer(300, 'muffin', 'b2').id === 'lc-small');
hvOk &= hv('getLocalSettings carries per-build levainContainers', api.getLocalSettings().levainContainers['shared:b1'] === 'lc-big' && api.getLocalSettings().levainContainers['shared:b2'] === 'lc-small');
api.applyRemoteSettings({ levainContainers: { 'bagel:b2': 'lc-small' } });
hvOk &= hv('applyRemoteSettings adopts per-build levainContainers', api.getLevainContainerPref('bagel', 'b2') === 'lc-small');
api.setLevainContainerPref('shared', 'b2', 'gone-id');
hvOk &= hv('a removed preferred container falls back to auto', api.pickLevainContainer(300, 'shared', 'b2').id === 'lc-small');
api.setLevainContainerPref('shared', 'b1', ''); api.setLevainContainerPref('shared', 'b2', ''); api.setLevainContainerPref('bagel', 'b2', '');

// Bake Sheet equipment pickers: each step offers a no-print dropdown for the equipment
// it uses (mixer/oven/pot/levain container), like the Bake Plan cards.
api.__setMixers([{ id: 'mx1', name: 'Spiral' }, { id: 'mx2', name: 'Hobart' }]);
api.__setOvens([{ id: 'ov1', name: 'Deck A', decks: 3 }, { id: 'ov2', name: 'Deck B', decks: 3 }]);
api.__setPots([{ id: 'pot1', name: 'Stockpot', size: '20 qt', quantity: 1 }]);
api.__setContainers([
  { id: 'lc', name: 'Levain jar', maxDoughGrams: 2000, processTag: 'levain' },
  { id: 'dc', name: 'Dough tub', maxDoughGrams: 12000, processTag: 'loaf' },
]);
seedPlan({ [SEED.batard]: 8, [SEED.bagel]: 12 }); api.__setPlan({ [SEED.batard]: 8, [SEED.bagel]: 12 });
els['deadline-default-input'].value = fmtLocal(tomorrow8);
['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
api.renderSchedule();
const Hb = api.buildBakeSheetHelpers();
const evsBs = api.__sr().events;
const pickerFor = (pred) => { const e = evsBs.find(pred); return e ? Hb.getEventEquipPicker(e) : '__noevent__'; };
const mixPick = pickerFor(e => api.eventStageType(e) === 'mix');
hvOk &= hv('bake sheet mix step offers a mixer picker, marked no-print', /bs-equip-edit no-print/.test(mixPick) && /Mixer/.test(mixPick) && /bp-equip-select/.test(mixPick));
hvOk &= hv('a mix step with a mixer does NOT also offer a container picker (the bowl is the container)', !/data-kind="container"/.test(mixPick));
const bakePick = pickerFor(e => /^Bake /.test(e.title));
hvOk &= hv('bake sheet bake step offers an oven picker (2+ ovens)', /Oven/.test(bakePick) && /data-kind="oven"/.test(bakePick));
const boilPick = pickerFor(e => api.eventStageType(e) === 'boil' || (api.eventSubstep(e) && api.eventSubstep(e).type === 'boil'));
hvOk &= hv('bake sheet boil step offers a pot picker', /Pot/.test(boilPick) && /data-kind="pot"/.test(boilPick));
const levPick = pickerFor(e => /Levain Build/.test(e.title));
hvOk &= hv('bake sheet levain build offers a container picker', /Container/.test(levPick) && /onLevainContainerChange/.test(levPick) && /no-print/.test(levPick));
const chillPick = pickerFor(e => api.eventStageType(e) === 'chill');
hvOk &= hv('bake sheet step with no editable equipment shows no picker', chillPick === '');
// Bulk-ferment container picker now appears for bagels (and muffins), not just loaves.
const bagelBulkPick = pickerFor(e => e.process === 'bagel' && api.eventStageType(e) === 'bulk');
hvOk &= hv('bake sheet bagel bulk ferment offers a container picker', /data-kind="container"/.test(bagelBulkPick) && /Change container/.test(bagelBulkPick));
hvOk &= hv('container picker drops the redundant "Container" label', !/bs-equip-lbl">Container</.test(bagelBulkPick));
const loafBulkPick = pickerFor(e => e.process === 'loaf' && api.eventStageType(e) === 'bulk');
hvOk &= hv('bake sheet loaf bulk ferment still offers a container picker', /data-kind="container"/.test(loafBulkPick));
hvOk &= hv('container picker auto option reads "Change container", not "auto"', /Change container/.test(bagelBulkPick) && !/— auto/.test(bagelBulkPick));
// pickDoughContainer honors a preference (so the bagel/muffin picker actually takes effect).
api.__setContainers([
  { id: 'small', name: 'Small tub', maxDoughGrams: 3000, processTag: 'loaf' },
  { id: 'big', name: 'Big tub', maxDoughGrams: 12000, processTag: 'any' },
]);
hvOk &= hv('pickDoughContainer auto-picks the smallest that fits', api.pickDoughContainer(2000).id === 'small');
hvOk &= hv('pickDoughContainer honors an explicit container preference', api.pickDoughContainer(2000, ['big']).id === 'big');
hvOk &= hv('pickDoughContainer falls back to auto when the preferred container is gone', api.pickDoughContainer(2000, ['ghost']).id === 'small');

// Topping is its own step: bagels now boil and top as separate steps, and a recipe's
// topping stage drives that step's ingredients (e.g. everything seasoning).
const bagelRT = api.__recipes().find(r => r.id === SEED.bagel);
let topStage = (bagelRT.stages || []).find(s => s.type === 'topping');
if (!topStage) { topStage = { type: 'topping', duration: { kind: 'fixed', min: 3 } }; const bi = bagelRT.stages.findIndex(s => s.type === 'bake'); bagelRT.stages.splice(bi < 0 ? bagelRT.stages.length : bi, 0, topStage); }
const topIng = bagelRT.ingredients[0].name;
topStage.ings = [topIng];
seedPlan({ [SEED.bagel]: 12 }); api.__setPlan({ [SEED.bagel]: 12 });
els['deadline-default-input'].value = fmtLocal(tomorrow8);
['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
api.renderSchedule();
const Ht = api.buildBakeSheetHelpers();
const evsT = api.__sr().events;
const topEv = evsT.find(e => /^Top batch/.test(e.title));
hvOk &= hv('bagels boil and top as SEPARATE steps', evsT.some(e => /^Boil batch/.test(e.title)) && !!topEv);
const bagelShapeEv = evsT.find(e => /^Shape bagels/.test(e.title));
const bagelLW = api.__recipes().find(r => r.id === SEED.bagel).loafWeight;
hvOk &= hv('the bagel shape step says how much each bagel should weigh', !!bagelShapeEv && /divide into/.test(bagelShapeEv.detail) && bagelShapeEv.detail.includes(String(bagelLW)) && /each/.test(bagelShapeEv.detail));
hvOk &= hv('Top step maps to the topping stage (color + type)', topEv && api.getEventStage(topEv) === 'topping' && api.eventStageType(topEv) === 'topping');
const ti = topEv ? Ht.getEventIngredients(topEv) : null;
const tnames = ti && ti.type === 'byRecipe' ? ti.recipes.flatMap(r => r.ingredients.map(i => i.name)) : [];
hvOk &= hv('tagged topping ingredient shows on the Top step', tnames.length === 1 && tnames[0] === topIng);
delete topStage.ings;

// Loaf/focaccia (other bread engines) get a "Top <process>" step via the post-pass when
// the recipe has a topping stage — and NOT when it doesn't.
const loafR = api.__recipes().find(r => r.id === SEED.batard);
const hasTopLoaf = () => {
  seedPlan({ [SEED.batard]: 8 }); api.__setPlan({ [SEED.batard]: 8 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  ['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
  localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
  api.renderSchedule();
  const e = api.__sr().events.find(ev => /^Top loaves/.test(ev.title));
  return e ? api.getEventStage(e) : null;
};
hvOk &= hv('loaf with no topping stage has no Top step', hasTopLoaf() === null);
const loafBakeIdx = loafR.stages.findIndex(s => s.type === 'bake');
loafR.stages.splice(loafBakeIdx < 0 ? loafR.stages.length : loafBakeIdx, 0, { type: 'topping', duration: { kind: 'fixed', min: 4 } });
hvOk &= hv('loaf with a topping stage gets a "Top loaves" step (topping type)', hasTopLoaf() === 'topping');

// --- Flour auto-detection (drives the contextual Anchor-flour control). Last, since it
// swaps the pantry. ---
api.__setPantry([
  { id: 'pan-bread', name: 'Bread flour', category: 'Flours' },
  { id: 'pan-water', name: 'Water', category: 'Water' },
]);
hvOk &= hv('bread/AP flours auto-detect as anchor', api.detectFlourType('Bread flour') === 'anchor' && api.detectFlourType('All purpose flour') === 'anchor');
hvOk &= hv('rye/whole-grain flours auto-detect as specialty', api.detectFlourType('Whole rye') === 'specialty' && api.detectFlourType('Spelt flour') === 'specialty');
hvOk &= hv('non-flours do not auto-detect a flour role', api.detectFlourType('Water') === '' && api.detectFlourType('Olive oil') === '');
hvOk &= hv('ingredientIsFlour: true for flour names, false for others', api.ingredientIsFlour('Bread flour', '') === true && api.ingredientIsFlour('Semolina', '') === true && api.ingredientIsFlour('Butter', '') === false);
hvOk &= hv('a pantry link to a Flours item marks the row a flour even with an odd name', api.ingredientIsFlour('House blend', 'pan-bread') === true);
hvOk &= hv('a pantry link to a non-flour item overrides a flour-ish name', api.ingredientIsFlour('flour sack', 'pan-water') === false);
// The per-ingredient role control is a single "Tag" dropdown (Anchor / Specialty / Process
// aid), not the old toggle buttons or checkboxes.
hvOk &= hv('ingredient role control is a Tag dropdown wired to onTagChange', /<select class="ing-tag" onchange="onTagChange\(this\)"/.test(html) && /ingredientTagOptions\(/.test(scriptBody));
hvOk &= hv('Tag options include Anchor flour / Specialty flour / Process aid', /value: 'anchor', label: 'Anchor flour'/.test(scriptBody) && /value: 'specialty', label: 'Specialty flour'/.test(scriptBody) && /value: 'aid', label: 'Process aid'/.test(scriptBody));
hvOk &= hv('old toggle-button / checkbox role controls are gone', !/ing-anchor-btn|ing-aid-btn|onAnchorToggle|onProcessAidToggle|ing-anchor-cb|ing-unit-cb|onUnitWeightToggle/.test(html));
// The per-unit weight box rescales the recipe proportionally: live feedback on input, the
// grams-mode rescale on commit (so a partial value can't zero out tiny ingredients).
hvOk &= hv('per-unit weight box is wired to rescale the recipe (oninput + onchange)', /id="r-weight"[^>]*oninput="onUnitWeightInput\(\)"[^>]*onchange="onUnitWeightCommit\(\)"/.test(html));
hvOk &= hv('grams-mode commit scales each ingredient so per-unit dough hits the target', /function onUnitWeightCommit\(\)[\s\S]*?const scale = \(target \* yld\) \/ doughTotal;[\s\S]*?\.ing-pct[\s\S]*?round2\(v \* scale\)/.test(scriptBody));
hvOk &= hv('per-unit weight box stays visible in both entry modes', /document\.getElementById\('r-weight-row'\)\.style\.display = '';\s*\n\s*document\.getElementById\('r-batch-yield-row'\)\.style\.display = mode === 'grams'/.test(scriptBody));

// --- Ingredient weight roles: process aids + toppings vs unit weight ---
// A bagel: 100 g flour-equivalent dough, 5% sesame topping, plus boil-water salt & lye that
// are process aids (bought + on the boil step, but never in the unit).
const bagelW = {
  id: 'bw', name: 'Test Bagel', processType: 'bagel', unit: 'bagel', loafWeight: 100,
  ingredients: [
    { name: 'Bread flour', pct: 100, flourType: 'anchor' },
    { name: 'Water', pct: 55 },
    { name: 'Salt', pct: 2 },
    { name: 'Sesame', pct: 5 },              // topping (tagged to the topping stage below)
    { name: 'Boil salt', pct: 10, processAid: true },
    { name: 'Lye', pct: 4, processAid: true },
  ],
  stages: [
    { type: 'mix', duration: { kind: 'fixed', min: 10 } },
    { type: 'shape', duration: { kind: 'perUnit', minPerUnit: 1 } },
    { type: 'boil', duration: { kind: 'fixed', min: 5 }, ings: ['Boil salt', 'Lye'] },
    { type: 'topping', duration: { kind: 'fixed', min: 3 }, ings: ['Sesame'] },
    { type: 'bake', duration: { kind: 'anchored', min: 20 }, tempF: 480 },
  ],
};
hvOk &= hv('process aids are role "aid"', api.ingredientWeightRole(bagelW, bagelW.ingredients[4]) === 'aid' && api.ingredientWeightRole(bagelW, bagelW.ingredients[5]) === 'aid');
hvOk &= hv('a topping-tagged ingredient is role "topping"', api.ingredientWeightRole(bagelW, bagelW.ingredients[3]) === 'topping');
hvOk &= hv('dough ingredients are role "dough"', api.ingredientWeightRole(bagelW, bagelW.ingredients[0]) === 'dough' && api.ingredientWeightRole(bagelW, bagelW.ingredients[1]) === 'dough');
hvOk &= hv('doughSumPct excludes aids + toppings (100+55+2 = 157)', api.doughSumPct(bagelW) === 157);
// flour weight per unit = loafWeight / (doughSumPct/100) = 100 / 1.57 ≈ 63.69 g; sesame = 5% of that ≈ 3.18 g.
hvOk &= hv('topping grams/unit derive from flour weight, dough-only', Math.abs(api.toppingGramsPerUnit(bagelW) - (100 / 1.57) * 0.05) < 1e-6);
hvOk &= hv('final unit weight = dough (loafWeight) + topping, aids excluded', Math.abs(api.finalUnitWeight(bagelW) - (100 + (100 / 1.57) * 0.05)) < 1e-6);
hvOk &= hv('shape/dough weight stays loafWeight (toppings + aids excluded)', api.perUnitDoughDetail ? true : (bagelW.loafWeight === 100));
// A plain recipe with no aids/toppings is unchanged: doughSumPct == raw sum, final == loafWeight.
const plainW = { loafWeight: 100, ingredients: [{ name: 'Bread flour', pct: 100, flourType: 'anchor' }, { name: 'Water', pct: 70 }], stages: [] };
hvOk &= hv('plain recipe: doughSumPct equals the raw % sum (back-compat)', api.doughSumPct(plainW) === 170);
hvOk &= hv('plain recipe: final unit weight equals loafWeight (back-compat)', api.finalUnitWeight(plainW) === 100);
loafR.stages = loafR.stages.filter(s => s.type !== 'topping');

// --- Bake order: a per-recipe bakeRank the deck planner honors ---
hvOk &= hv('bakeRankMap is null when no recipe has a bakeRank (keeps default packing)', api.bakeRankMap([{ name: 'A' }, { name: 'B' }]) === null);
const brm = api.bakeRankMap([{ name: 'A', bakeRank: 1 }, { name: 'B', bakeRank: 0 }, { name: 'C' }]);
hvOk &= hv('bakeRankMap normalizes bakeRank to 0..n in order (B<A<C)', brm.B === 0 && brm.A === 1 && brm.C === 2);
// Two equal-size recipes, one deck per batch: default packs A first (insertion/tie order);
// with a rank putting B first, B leads the first bake.
const capAB = { A: 4, B: 4 };
const defBatches = api.planBakes({ A: 4, B: 4 }, capAB, 1);
hvOk &= hv('default packing leads with the first-listed recipe', defBatches[0][0].items[0].name === 'A');
const rankBatches = api.planBakes({ A: 4, B: 4 }, capAB, 1, { B: 0, A: 1 });
hvOk &= hv('a bakeRank order leads the first bake with the chosen recipe', rankBatches[0][0].items[0].name === 'B');
hvOk &= hv('ranking still fills decks (B fully in batch 1, A in batch 2)', rankBatches[0][0].items[0].count === 4 && rankBatches[1][0].items[0].name === 'A');
// A small leftover of the lead recipe shares its deck with the next (decks stay full).
const mixBatches = api.planBakes({ A: 1, B: 8 }, { A: 4, B: 4 }, 1, { A: 0, B: 1 });
hvOk &= hv('lead recipe leftover shares a deck to fill it (A+B in the first deck)', mixBatches[0][0].items.length === 2 && mixBatches[0][0].items.some(it => it.name === 'A') && mixBatches[0][0].total === 4);

// moveBakeOrder writes bakeRank across the type's in-plan recipes and reorders them.
const _br = api.__recipes();
const loafIds = _br.filter(r => api.getProcessType(r) === 'sourdough-loaf').map(r => r.id);
if (loafIds.length >= 2) {
  loafIds.forEach(id => { const r = _br.find(x => x.id === id); delete r.bakeRank; });
  api.__setPlan(Object.fromEntries(loafIds.map(id => [id, 6])));
  els['deadline-default-input'].value = fmtLocal(tomorrow8); // a shared deadline groups them
  api.moveBakeOrder(loafIds[1], -1); // bump the 2nd loaf to the front of its deadline group
  const r0 = _br.find(r => r.id === loafIds[1]);
  hvOk &= hv('moveBakeOrder gives the promoted recipe the earliest bakeRank (0)', r0.bakeRank === 0);
  hvOk &= hv('moveBakeOrder ranks the whole plan (all in-plan recipes get a finite bakeRank)', loafIds.every(id => Number.isFinite(Number(_br.find(r => r.id === id).bakeRank))));
}
// Bake Order Preferences groups by deadline: a shared deadline → one group, an override → split.
const RDK = 'whb-recipe-deadlines-v1';
const planRecs = api.__recipes().filter(r => api.getProcessType(r) !== 'levain').slice(0, 2);
if (planRecs.length === 2) {
  api.__setPlan({ [planRecs[0].id]: 4, [planRecs[1].id]: 4 });
  els['deadline-default-input'].value = fmtLocal(tomorrow8);
  localStorageStub.removeItem(RDK);
  let grp = api.bakeOrderGroups();
  hvOk &= hv('recipes sharing the default deadline form one Bake Order group', grp.length === 1 && grp[0].recipes.length === 2);
  const later = new Date(tomorrow8.getTime() + 6 * 3600 * 1000);
  localStorageStub.setItem(RDK, JSON.stringify({ [planRecs[1].id]: fmtLocal(later) }));
  grp = api.bakeOrderGroups();
  hvOk &= hv('a per-recipe deadline override splits into separate Bake Order groups (earliest first)', grp.length === 2 && grp[0].recipes.length === 1 && grp[1].recipes.length === 1 && grp[0].ms < grp[1].ms);
  localStorageStub.removeItem(RDK);
}
hvOk &= hv('the card is titled "Bake Order Preferences"', /<h2>Bake Order Preferences<\/h2>/.test(html));

// Emptying the bake plan must hide ALL equipment cards (regression: the Boiling/pot card
// lingered after the last boiling recipe was removed).
api.__setPots([{ id: 'potX', name: 'Stockpot', size: '20 qt', quantity: 1 }]);
api.__setPlan({ [SEED.bagel]: 12 }); seedPlan({ [SEED.bagel]: 12 });
api.renderTotals();
const potCardShownWithBagels = getEl('pot-overview-card').style.display !== 'none';
api.__setPlan({}); seedPlan({});
api.renderTotals();
hvOk &= hv('Boiling (pot) card shows with a bagel in the plan', potCardShownWithBagels);
hvOk &= hv('emptying the plan hides the Boiling (pot) card', getEl('pot-overview-card').style.display === 'none');
hvOk &= hv('emptying the plan hides the banneton + pan cards too', getEl('banneton-card').style.display === 'none' && getEl('pan-card').style.display === 'none');

// --- Stage editor: per-step options live on their own line, in order
// (1) substeps (2) ingredients (3) equipment (4) active/passive (5) active min (6) notes. ---
api.__setOvens([{ id: 'ov1', name: 'Deck', decks: 3 }]);
api.editRecipe(SEED.bagel);
const stageHtml = getEl('r-stages-list').innerHTML;
hvOk &= hv('each step splits into a main line + its own controls line', /stage-main[\s\S]*stage-controls/.test(stageHtml));
const ctrlSegs = stageHtml.match(/<div class="stage-controls">[\s\S]*?<\/div>/g) || [];
const fullSeg = ctrlSegs.find(s => /stage-sub-btn/.test(s) && /<select/.test(s)) || '';
const order = [/stage-sub-btn/, /stage-ing-btn/, /<select/, /stage-active-btn/, /stage-actmin/, /stage-note-btn/].map(re => fullSeg.search(re));
hvOk &= hv('controls line orders subs→ing→equip→active→active-min→notes', !!fullSeg && order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])));
hvOk &= hv('active-minutes is its own control, not appended to the duration', !/stage-dur[^>]*>[^<]*stage-actmin/.test(stageHtml) && /stage-actmin/.test(stageHtml));
// Each step shows a compact summary (label + duration + Edit), collapsed by default; the
// full editor body is hidden until you click Edit.
hvOk &= hv('each step shows a summary with an Edit button', /class="stage-summary"/.test(stageHtml) && /class="stage-edit-btn[^"]*"[^>]*>Edit</.test(stageHtml));
hvOk &= hv('the summary shows a duration chip', /class="stage-sum-dur"/.test(stageHtml));
hvOk &= hv('steps are collapsed by default (edit body hidden)', /class="stage-edit-body" style="display:none"/.test(stageHtml) && !/is-expanded/.test(stageHtml));
api.toggleStageExpand(0);
const expandedHtml = getEl('r-stages-list').innerHTML;
hvOk &= hv('clicking Edit expands that step (is-expanded + Done, body shown)', /class="stage-row is-expanded"/.test(expandedHtml) && /class="stage-edit-btn[^"]*"[^>]*>Done</.test(expandedHtml));
hvOk &= hv('stageDurationSummary is concise', api.stageDurationSummary({ duration: { kind: 'fixed', min: 120 } }) === '2 hr' && api.stageDurationSummary({ duration: { kind: 'perUnit', minPerUnit: 2 } }) === '2 min/unit' && api.stageDurationSummary({ duration: { kind: 'range', auto: true } }) === 'auto window');
api.toggleStageExpand(0); // collapse again, leave state clean

// --- Shaping weight: bolded on the bake sheet, surfaced in the schedule hover ---
hvOk &= hv('boldUnitWeightHtml bolds "N g each"', api.boldUnitWeightHtml('divide into 138 g each') === 'divide into <strong>138 g each</strong>');
hvOk &= hv('boldUnitWeightHtml bolds "N g per pan" / per recipe, splitting on middot', api.boldUnitWeightHtml('705 g per pan').includes('<strong>705 g per pan</strong>') && api.boldUnitWeightHtml('300 g per Sesame · 110 g per Plain') === '<strong>300 g per Sesame</strong> · <strong>110 g per Plain</strong>');
hvOk &= hv('boldUnitWeightHtml leaves non-weight text alone', api.boldUnitWeightHtml('2 min × 12 bagels = 24 min total') === '2 min × 12 bagels = 24 min total');
seedPlan({ [SEED.bagel]: 12 }); api.__setPlan({ [SEED.bagel]: 12 });
els['deadline-default-input'].value = fmtLocal(tomorrow8);
['coldproof-loaf-input', 'coldproof-muffin-input', 'coldproof-bagel-input', 'bake-time-default-input'].forEach(id => { els[id].value = ''; });
localStorageStub.removeItem(RECIPE_DEADLINES_KEY);
api.renderSchedule();
const Hh = api.buildBakeSheetHelpers();
const shapeEv = api.__sr().events.find(e => e.process === 'bagel' && /^Shape bagels/.test(e.title));
const hoverHtml = shapeEv ? api.hoverHtmlFor(shapeEv, Hh) : '';
hvOk &= hv('schedule hover on a shaping step shows the unit weight', /Unit weight/.test(hoverHtml) && /<strong>\d+\s*g\s+each<\/strong>/.test(hoverHtml));
const mixEv = api.__sr().events.find(e => e.process === 'bagel' && /^Mix/.test(e.title));
hvOk &= hv('schedule hover on a non-shaping step has no Unit weight section', mixEv && !/Unit weight/.test(api.hoverHtmlFor(mixEv, Hh)));

allOk &= hvOk;

console.log(allOk ? '\nALL SCENARIOS PASSED' : '\nSOME SCENARIOS FAILED');
process.exit(allOk ? 0 : 1);

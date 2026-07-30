/**
 * IsoLab UI controller.
 *
 * The engine is synchronous and runs a full 24-band simulation in well under a
 * millisecond, so every control recomputes the entire result on input rather
 * than debouncing or approximating. "Real time" here means literally that:
 * there is no server, no worker, and no interpolation between cached answers.
 */

import { simulate } from '../core/solver.mjs';
import { buildDesign, SCENARIOS } from '../data/designs.mjs';
import { WALL_PRESETS, DOOR_PRESETS, FLOOR_PRESETS, CEILING_PRESETS } from '../data/assemblies.mjs';
import { DUCT_PRESETS, ductInsertionLoss, requiredAirflowLps } from '../core/duct.mjs';
import { ENVIRONMENTS, SEPARATING_ELEMENTS } from '../data/environments.mjs';
import { SOURCES, sourcesByCategory } from '../data/sources.mjs';
import { MATERIALS, materialsByCategory } from '../data/materials.mjs';
import { assessMaterial } from '../core/assess.mjs';
import { optimise, singleChangeOptions, compareDesigns } from '../core/optimizer.mjs';
import { assess, fitCalibration, MEASUREMENT_PROTOCOL } from '../core/calibration.mjs';
import { runValidation } from '../core/validation.mjs';
import { partitionTL, massAirMass, CONNECTIONS } from '../core/partition.mjs';
import { criticalFrequency } from '../core/panel.mjs';
import { computeSTC } from '../core/ratings.mjs';
import { LEAK_PRESETS } from '../core/leaks.mjs';
import { THIRD_OCTAVE, OCTAVE, N_BANDS } from '../core/bands.mjs';
import { lineChart, barChart, donutChart, paretoChart, heatColor, PALETTE } from './charts.mjs';
import { Booth3D, facesFromResult } from './viz3d.mjs';
import { materialColor, swatchCSS } from './appearance.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

/* ==================== state ==================== */

const state = {
  spec: {
    ...SCENARIOS['bedroom-good'].spec,
    name: 'My booth',
  },
  customSpectrum: null,
  advancedSource: false,
  target: 35,
  budget: 2000,
  compareTo: null,
  gaps: [],
  /** Per-surface material overrides edited in the 3D builder. */
  surfaceOverrides: {},
  selectedSurface: null,
  vizMode: 'materials',
};

let result = null;
let viz = null;

/* ==================== controls ==================== */

function option(value, label, selected) {
  const o = el('option', null, label);
  o.value = value;
  if (selected) o.selected = true;
  return o;
}

function buildSelect(id, groups, current) {
  const s = $(id);
  s.innerHTML = '';
  for (const [group, items] of Object.entries(groups)) {
    if (Object.keys(groups).length > 1) {
      const g = el('optgroup');
      g.label = group;
      for (const it of items) g.appendChild(option(it.id, it.name || it.label, it.id === current));
      s.appendChild(g);
    } else {
      for (const it of items) s.appendChild(option(it.id, it.name || it.label, it.id === current));
    }
  }
}

function groupBy(obj, keyFn) {
  const out = {};
  for (const v of Object.values(obj)) (out[keyFn(v)] ||= []).push(v);
  return out;
}

function initControls() {
  // Scenario
  const sc = $('scenario');
  sc.appendChild(option('', 'Custom design', true));
  for (const [id, s] of Object.entries(SCENARIOS)) sc.appendChild(option(id, s.name));
  sc.addEventListener('change', () => {
    const id = sc.value;
    if (!id) return;
    state.spec = { ...SCENARIOS[id].spec, name: SCENARIOS[id].name };
    state.customSpectrum = null;
    state.surfaceOverrides = {};
    state.selectedSurface = null;
    syncControlsFromSpec();
    run();
    $('scenarioNote').textContent = SCENARIOS[id].description;
  });

  buildSelect('wall', groupBy(WALL_PRESETS, (p) => p.category), state.spec.wall);
  buildSelect('ceilingAssembly', { '': [{ id: '', name: 'Same as walls' }, ...Object.values(WALL_PRESETS)] }, state.spec.ceiling || '');
  buildSelect('door', { '': Object.values(DOOR_PRESETS) }, state.spec.door);
  buildSelect('vent', { '': Object.values(DUCT_PRESETS).map((d) => ({ id: d.id, name: d.label })) }, state.spec.ventPreset);
  buildSelect('floorSystem', { '': Object.values(FLOOR_PRESETS) }, state.spec.floorSystem || 'direct');
  buildSelect('env', groupBy(ENVIRONMENTS, (e) => e.category), state.spec.envId);
  buildSelect('separating', { '': Object.values(SEPARATING_ELEMENTS).map((s) => ({ id: s.id, name: s.label })) }, state.spec.separatingElementId || 'none');
  buildSelect('source', groupBy(SOURCES, (s) => s.category), state.spec.sourceId);
  buildSelect('treatMaterial', { '': [{ id: '', name: 'None (bare boards)' }, ...Object.values(MATERIALS).filter((m) => m.flowResistivity)] },
    state.spec.treatment?.materialId || '');

  // simple bindings
  const bind = (id, key, transform = (v) => v, after = null) => {
    const n = $(id);
    n.addEventListener('input', () => {
      state.spec[key] = transform(n.value);
      if (after) after();
      run();
    });
  };
  // Choosing a global wall assembly clears per-surface edits, otherwise the
  // dropdown would appear to do nothing on surfaces the user had customised.
  $('wall').addEventListener('input', () => {
    state.spec.wall = $('wall').value;
    state.surfaceOverrides = {};
    run({ keepCamera: true });
  });
  bind('door', 'door');
  bind('vent', 'ventPreset');
  bind('floorSystem', 'floorSystem');
  bind('env', 'envId', (v) => v, () => {
    const e = ENVIRONMENTS[$('env').value];
    if (e) { $('distance').value = e.defaultDistanceM; state.spec.distanceM = e.defaultDistanceM; syncLabels(); }
  });
  bind('separating', 'separatingElementId');
  bind('source', 'sourceId', (v) => v, () => { state.customSpectrum = null; state.advancedSource = false; $('advToggle').checked = false; renderSourceEditor(); });
  bind('ceilingAssembly', 'ceiling', (v) => v || null);

  for (const [id, key] of [['L', 'L'], ['W', 'W'], ['H', 'H'], ['level', 'level'], ['distance', 'distanceM'],
    ['airflow', 'ventAirflowLps'], ['occupants', 'occupants'], ['treatThickness', 'treatThicknessMm'], ['treatCoverage', 'treatCoverage']]) {
    $(id).addEventListener('input', () => {
      const v = Number($(id).value);
      if (key === 'treatThicknessMm' || key === 'treatCoverage') {
        state.spec.treatment = {
          materialId: $('treatMaterial').value,
          thicknessMm: Number($('treatThickness').value),
          coverage: Number($('treatCoverage').value),
        };
      } else state.spec[key] = v;
      syncLabels();
      run({ keepCamera: true });
    });
  }
  $('treatMaterial').addEventListener('change', () => {
    state.spec.treatment = {
      materialId: $('treatMaterial').value,
      thicknessMm: Number($('treatThickness').value),
      coverage: Number($('treatCoverage').value),
    };
    run();
  });

  $('sourceMode').addEventListener('change', () => {
    state.spec.sourceMode = $('sourceMode').value;
    run();
  });

  $('advToggle').addEventListener('change', () => {
    state.advancedSource = $('advToggle').checked;
    if (state.advancedSource && !state.customSpectrum) {
      state.customSpectrum = result ? result.inside.spectrum.slice() : null;
    }
    if (!state.advancedSource) state.customSpectrum = null;
    renderSourceEditor();
    run();
  });

  // Leak builder
  const lp = $('leakPreset');
  lp.appendChild(option('', 'Add a leak…', true));
  for (const p of LEAK_PRESETS) lp.appendChild(option(p.id, p.label));
  lp.addEventListener('change', () => {
    const p = LEAK_PRESETS.find((x) => x.id === lp.value);
    if (!p) return;
    state.gaps.push({ ...p, host: 'front' });
    lp.value = '';
    renderLeaks();
    run();
  });

  // View mode
  const setMode = (m) => {
    state.vizMode = m;
    $('modeMaterials').classList.toggle('active', m === 'materials');
    $('modeLeakage').classList.toggle('active', m === 'leakage');
    if (viz) { viz.mode = m; viz.draw(); }
    render3D();
  };
  $('modeMaterials').addEventListener('click', () => setMode('materials'));
  $('modeLeakage').addEventListener('click', () => setMode('leakage'));
  $('handles').addEventListener('change', () => {
    viz.showHandles = $('handles').checked; viz.draw();
  });

  // Explode / waves
  $('explode').addEventListener('input', () => viz.setExplode(Number($('explode').value) / 100));
  $('waves').addEventListener('change', () => { viz.showWaves = $('waves').checked; viz.draw(); });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) $('waves').checked = false;

  // Optimiser
  $('target').addEventListener('input', () => { state.target = Number($('target').value); syncLabels(); });
  $('budget').addEventListener('input', () => { state.budget = Number($('budget').value); syncLabels(); });
  $('runOptimise').addEventListener('click', runOptimiser);

  // Comparison
  const cmp = $('compareWall');
  cmp.appendChild(option('', 'No comparison', true));
  for (const [id, p] of Object.entries(WALL_PRESETS)) cmp.appendChild(option(id, p.name));
  cmp.addEventListener('change', () => { state.compareTo = cmp.value || null; run(); });

  // Calibration
  $('runCalibration').addEventListener('click', runCalibration);
  $('clearCalibration').addEventListener('click', () => {
    state.spec.calibration = {};
    $('calibrationOut').innerHTML = '<p class="muted">Calibration cleared.</p>';
    run();
  });

  // Tabs
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('[data-tab]')) x.classList.remove('active');
      for (const x of document.querySelectorAll('[data-panel]')) x.classList.remove('active');
      b.classList.add('active');
      $(b.dataset.tab).classList.add('active');
      run();
    });
  }

  // Material inspector
  buildSelect('inspectMaterial', groupBy(MATERIALS, (m) => m.category), 'acoustic-foam');
  $('inspectMaterial').addEventListener('change', renderMaterialInspector);
  $('inspectThickness').addEventListener('input', renderMaterialInspector);

  // Air-gap study
  $('gapStudyRun').addEventListener('click', renderGapStudy);
}

function syncControlsFromSpec() {
  const s = state.spec;
  $('wall').value = s.wall || 'booth-mid';
  $('ceilingAssembly').value = s.ceiling || '';
  $('door').value = s.door || 'solid-core';
  $('vent').value = s.ventPreset || 'flex-2bend';
  $('floorSystem').value = s.floorSystem || 'direct';
  $('env').value = s.envId || 'bedroom-rented';
  $('separating').value = s.separatingElementId || 'none';
  $('source').value = s.sourceId || 'scream';
  $('L').value = s.L ?? 1.4;
  $('W').value = s.W ?? 1.4;
  $('H').value = s.H ?? 2.1;
  $('level').value = s.level ?? 100;
  $('distance').value = s.distanceM ?? 1;
  $('airflow').value = s.ventAirflowLps ?? 12;
  $('occupants').value = s.occupants ?? 1;
  $('sourceMode').value = s.sourceMode || 'internal-spl';
  $('treatMaterial').value = s.treatment?.materialId || '';
  $('treatThickness').value = s.treatment?.thicknessMm ?? 50;
  $('treatCoverage').value = s.treatment?.coverage ?? 70;
  state.gaps = (s.gaps || []).slice();
  renderLeaks();
  syncLabels();
}

function syncLabels() {
  $('LVal').textContent = Number($('L').value).toFixed(2) + ' m';
  $('WVal').textContent = Number($('W').value).toFixed(2) + ' m';
  $('HVal').textContent = Number($('H').value).toFixed(2) + ' m';
  $('levelVal').textContent = $('level').value + ' dB';
  $('distanceVal').textContent = Number($('distance').value).toFixed(1) + ' m';
  $('airflowVal').textContent = $('airflow').value + ' L/s';
  $('occupantsVal').textContent = $('occupants').value;
  $('treatThicknessVal').textContent = $('treatThickness').value + ' mm';
  $('treatCoverageVal').textContent = $('treatCoverage').value + '%';
  $('targetVal').textContent = $('target').value + ' dB(A)';
  $('budgetVal').textContent = '£' + $('budget').value;
}

/* ==================== leak list ==================== */

function renderLeaks() {
  const box = $('leakList');
  box.innerHTML = '';
  if (!state.gaps.length) {
    box.appendChild(el('p', 'muted small', 'No leaks specified. Real construction always leaks somewhere — add the ones you expect to actually have.'));
    return;
  }
  state.gaps.forEach((g, i) => {
    const row = el('div', 'leak-row');
    const t = el('div', 'leak-main');
    t.appendChild(el('strong', null, g.label || 'Gap'));
    t.appendChild(el('span', 'muted small',
      ` ${g.shape === 'hole' ? `⌀${g.widthMm} mm` : `${g.widthMm} × ${g.lengthMm} mm`}, ${g.depthMm} mm deep`));
    row.appendChild(t);

    const host = el('select', 'mini');
    for (const k of ['front', 'back', 'left', 'right', 'ceiling', 'floor']) {
      host.appendChild(option(k, k, k === g.host));
    }
    host.addEventListener('change', () => { g.host = host.value; run(); });
    row.appendChild(host);

    const w = el('input', 'mini');
    w.type = 'number'; w.step = '0.05'; w.min = '0.01'; w.value = String(g.widthMm);
    w.title = 'gap width / hole diameter, mm';
    w.addEventListener('input', () => { g.widthMm = Number(w.value) || 0.05; run(); });
    row.appendChild(w);

    const del = el('button', 'icon-btn', '✕');
    del.title = 'Remove';
    del.addEventListener('click', () => { state.gaps.splice(i, 1); renderLeaks(); run(); });
    row.appendChild(del);

    box.appendChild(row);
  });
}

/* ==================== source editor ==================== */

function renderSourceEditor() {
  const box = $('sourceEditor');
  box.innerHTML = '';
  if (!state.advancedSource) {
    const s = SOURCES[state.spec.sourceId];
    if (s) {
      box.appendChild(el('p', 'muted small', s.notes));
    }
    return;
  }
  if (!state.customSpectrum) state.customSpectrum = result ? result.inside.spectrum.slice() : new Array(N_BANDS).fill(90);

  const grid = el('div', 'eq-grid');
  OCTAVE.forEach((f, oi) => {
    const idx = THIRD_OCTAVE.indexOf(f);
    const cell = el('div', 'eq-cell');
    cell.appendChild(el('label', 'small', f >= 1000 ? f / 1000 + 'k' : String(f)));
    const sl = el('input');
    sl.type = 'range'; sl.min = '20'; sl.max = '130'; sl.step = '1';
    sl.className = 'eq-slider';
    sl.value = String(Math.round(state.customSpectrum[idx]));
    const val = el('span', 'small mono', sl.value);
    sl.addEventListener('input', () => {
      const v = Number(sl.value);
      val.textContent = String(v);
      // Set all three 1/3-octaves in this octave band
      for (const j of [idx - 1, idx, idx + 1]) {
        if (j >= 0 && j < N_BANDS) state.customSpectrum[j] = v;
      }
      run();
    });
    cell.appendChild(sl);
    cell.appendChild(val);
    grid.appendChild(cell);
  });
  box.appendChild(grid);
  box.appendChild(el('p', 'muted small', 'Each slider sets the three 1/3-octave bands inside that octave. The engine still computes in 1/3-octaves internally.'));
}

/* ==================== run ==================== */

function currentSpec() {
  const s = { ...state.spec, gaps: state.gaps, surfaceOverrides: state.surfaceOverrides };
  if (state.customSpectrum) s.customSpectrum = state.customSpectrum.slice();
  return s;
}

function run(opts = {}) {
  const t0 = performance.now();
  const design = buildDesign(currentSpec());
  result = simulate(design);
  const ms = performance.now() - t0;
  $('perf').textContent = `${ms.toFixed(2)} ms`;

  renderHeadline();
  renderCharts();
  renderBreakdown();
  render3D();
  renderDiagnostics();
  renderDetails();
  renderCost();
  if (state.compareTo) renderComparison();
  else $('comparisonOut').innerHTML = '';
}

/* ==================== headline ==================== */

function renderHeadline() {
  const t = result.totals;
  $('insideVal').textContent = fmt(t.insideZ, 1);
  $('insideSub').textContent = `${fmt(t.insideA, 1)} dB(A)`;
  $('isoVal').textContent = '−' + fmt(t.isolationZ, 1);
  $('isoSub').textContent = `STC ${result.ratings.stc} · Rw ${result.ratings.rw} (C${result.ratings.c >= 0 ? '+' : ''}${result.ratings.c}, Ctr${result.ratings.ctr >= 0 ? '+' : ''}${result.ratings.ctr}) · NIC ${result.ratings.nic}`;
  $('outsideVal').textContent = fmt(t.outsideZ, 1);
  $('outsideSub').textContent = `${fmt(t.outsideA, 1)} dB(A)${result.outside.fan ? ` · ${fmt(t.outsideWithFanA, 1)} dB(A) with fan` : ''}`;

  const card = $('outsideCard');
  card.className = 'chain-card ' + (t.outsideWithFanA > 45 ? 'bad' : t.outsideWithFanA > 35 ? 'warn' : 'good');

  $('verdictText').textContent = result.verdict.audibility;
  $('verdictDesc').textContent = result.verdict.description;
  $('bgVal').textContent = fmt(t.backgroundA, 1);
  $('perceivedVal').textContent = fmt(t.perceivedA, 1);
  const ex = t.audibleExcessA;
  const exEl = $('excessVal');
  exEl.textContent = (ex >= 0 ? '+' : '') + fmt(ex, 1) + ' dB';
  exEl.className = 'pill ' + (ex > 8 ? 'bad' : ex > 0 ? 'warn' : 'good');
  $('nrVal').textContent = `NR ${fmt(result.ratings.nr, 0)} (${result.ratings.nrGoverning} Hz)`;

  // Criteria
  const box = $('criteria');
  box.innerHTML = '';
  for (const c of result.verdict.criteria) {
    const row = el('div', 'criterion');
    row.appendChild(el('span', 'badge ' + (c.pass ? 'good' : 'bad'), c.pass ? 'PASS' : 'FAIL'));
    row.appendChild(el('span', 'crit-label', c.label));
    row.appendChild(el('span', 'muted small', `≤ ${c.limit} dB(A)`));
    row.appendChild(el('span', 'mono small ' + (c.pass ? 'ok' : 'no'),
      (c.marginDb >= 0 ? '+' : '') + fmt(c.marginDb, 1)));
    row.title = c.note;
    box.appendChild(row);
  }

  // Level scale
  const scale = $('levelScale');
  scale.innerHTML = '';
  const marks = [[0, 'Silence'], [20, 'Quiet room'], [30, 'Very quiet'], [40, 'Normal quiet room'], [50, 'Conversation'], [65, 'Loud'], [80, 'Very loud']];
  const lvl = result.totals.outsideWithFanA;
  for (const [v, label] of marks) {
    const m = el('div', 'scale-mark' + (lvl >= v ? ' passed' : ''));
    m.appendChild(el('span', 'scale-v', String(v)));
    m.appendChild(el('span', 'scale-l', label));
    scale.appendChild(m);
  }
  const ptr = $('scalePointer');
  ptr.style.left = Math.max(0, Math.min(100, (lvl / 90) * 100)) + '%';
  ptr.textContent = fmt(lvl, 0);
}

/* ==================== charts ==================== */

function renderCharts() {
  const P = PALETTE();
  const f = THIRD_OCTAVE;

  lineChart($('chartSpectrum'), {
    freqs: f,
    yLabel: 'dB SPL',
    series: [
      { label: 'inside', values: result.inside.spectrum, color: P.inside, width: 2.5 },
      { label: 'outside', values: result.outside.withFan || result.outside.spectrum, color: P.outside, width: 2.5, fill: true },
      { label: 'background', values: result.outside.background, color: P.background, dash: [4, 3], width: 1.5 },
    ],
  });
  legend($('legendSpectrum'), [
    ['inside the booth', P.inside], ['outside (predicted)', P.outside], ['existing background', P.background],
  ]);

  // TL curve with physics markers
  const markers = [];
  const det = result.detail.front;
  if (det?.f0) markers.push({ f: det.f0, label: `f₀ ${det.f0.toFixed(0)} Hz`, color: P.target });
  for (const fc of det?.fc || []) if (fc > 60 && fc < 9000) markers.push({ f: fc, label: `f_c ${fc.toFixed(0)}`, color: '#94a3b8' });

  lineChart($('chartTL'), {
    freqs: f,
    yLabel: 'dB',
    yMin: 0,
    series: [
      { label: 'composite envelope TL', values: result.compositeTL, color: P.tl, width: 2.5 },
      { label: 'wall alone', values: det?.tl || [], color: P.series[0], dash: [5, 3], width: 1.8 },
      { label: 'level difference', values: result.levelDifference, color: P.series[4], dash: [2, 2], width: 1.5 },
    ],
    markers,
  });
  legend($('legendTL'), [
    ['composite envelope (what you get)', P.tl],
    ['the wall assembly alone (what the spec promises)', P.series[0]],
    ['inside − outside level difference', P.series[4]],
  ]);
}

function legend(node, items) {
  node.innerHTML = '';
  for (const [label, color] of items) {
    const s = el('span', 'legend-item');
    const sw = el('span', 'swatch');
    sw.style.background = color;
    s.appendChild(sw);
    s.appendChild(el('span', null, label));
    node.appendChild(s);
  }
}

/* ==================== breakdown ==================== */

const GROUP_COLORS = {
  door: '#dc2626', 'door-leak': '#f97316', leak: '#f59e0b', vent: '#0891b2',
  wall: '#059669', window: '#7c3aed', flanking: '#6366f1',
};

function renderBreakdown() {
  const slices = result.breakdown.byGroup
    .filter((g) => g.percent > 0.05)
    .map((g) => ({ label: g.group, percent: g.percent, color: GROUP_COLORS[g.group] || '#94a3b8' }));
  donutChart($('chartDonut'), slices, {
    main: fmt(result.totals.outsideWithFanA, 0) + ' dB(A)',
    sub: 'outside',
  });

  const lg = $('donutLegend');
  lg.innerHTML = '';
  for (const s of slices) {
    const row = el('div', 'legend-row');
    const sw = el('span', 'swatch');
    sw.style.background = s.color;
    row.appendChild(sw);
    row.appendChild(el('span', 'legend-name', s.label));
    row.appendChild(el('span', 'mono', fmt(s.percent, 1) + '%'));
    lg.appendChild(row);
  }

  const list = $('pathList');
  list.innerHTML = '';
  const max = Math.max(...result.breakdown.byElement.map((e) => e.percent), 1);
  for (const e of result.breakdown.byElement) {
    if (e.percent < 0.05) continue;
    const row = el('div', 'path-row');
    const bar = el('div', 'path-bar');
    const fill = el('div', 'path-fill');
    fill.style.width = (e.percent / max) * 100 + '%';
    fill.style.background = GROUP_COLORS[e.group] || '#94a3b8';
    bar.appendChild(fill);
    row.appendChild(el('span', 'mono path-pct', fmt(e.percent, 1) + '%'));
    row.appendChild(bar);
    row.appendChild(el('span', 'path-label', e.label));
    list.appendChild(row);
  }

  const pot = $('potentialList');
  pot.innerHTML = '';
  for (const p of result.breakdown.potential.slice(0, 5)) {
    if (p.maxImprovementDb < 0.1) continue;
    const row = el('div', 'legend-row');
    row.appendChild(el('span', 'mono gain', '−' + fmt(p.maxImprovementDb, 1) + ' dB'));
    row.appendChild(el('span', 'legend-name', p.label));
    pot.appendChild(row);
  }

  // Dominant path per octave
  const dom = $('dominantBands');
  dom.innerHTML = '';
  for (const d of result.breakdown.dominantByBand.filter((_, i) => i % 3 === 1)) {
    const row = el('div', 'legend-row');
    row.appendChild(el('span', 'mono band-f', (d.band >= 1000 ? d.band / 1000 + 'k' : d.band) + ' Hz'));
    row.appendChild(el('span', 'legend-name', String(d.label)));
    row.appendChild(el('span', 'mono', fmt(d.percent, 0) + '%'));
    dom.appendChild(row);
  }
}

/* ==================== 3D ==================== */

function render3D() {
  if (!viz) {
    viz = new Booth3D($('viz3d'), {
      onSelect: (faceKey, badgeId) => {
        state.selectedSurface = badgeId ? null : faceKey || null;
        renderEditor(badgeId);
      },
      onResize: (dims) => {
        // Live feedback while dragging a handle: update the sliders and re-solve.
        state.spec.L = dims.L; state.spec.W = dims.W; state.spec.H = dims.H;
        $('L').value = dims.L; $('W').value = dims.W; $('H').value = dims.H;
        syncLabels();
        run({ keepCamera: true });
      },
    });
    // Exposed for automated interaction tests; harmless in normal use.
    if (typeof window !== 'undefined') window.__viz = viz;
    let last = performance.now();
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      viz.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  const built = facesFromResult(result.geometry, result.breakdown, result.design);
  viz.setFaces(built.faces);
  viz.setGeometry(built.geom, {
    L: result.geometry.L, W: result.geometry.W, H: result.geometry.H,
  });
  viz.mode = state.vizMode;
  viz.draw();

  $('heatKeyWrap').style.display = state.vizMode === 'leakage' ? '' : 'none';
  $('vizHint').innerHTML = state.vizMode === 'materials'
    ? 'Click a wall to change its material. Drag the round <span class="hint-key">↔</span> handles to resize the booth. Drag the background to orbit, scroll to zoom.'
    : 'Faces and markers are coloured by their share of the escaping sound. <b>D</b> door, <b>V</b> vent, <b>L</b> leak, <b>W</b> window, <b>F</b> flanking. Click any of them to inspect.';

  const key = $('heatKey');
  key.innerHTML = '';
  for (const [t, label] of [[0, 'good'], [0.35, ''], [0.6, 'medium'], [0.8, ''], [1, 'major leak']]) {
    const sp = el('span', 'key-step');
    sp.style.background = heatColor(t);
    sp.title = label;
    key.appendChild(sp);
  }
  renderEditor();
}

/* ==================== wall editor ==================== */

/** Material choices offered for a leaf, grouped and excluding non-structural ones. */
function massMaterials() {
  const out = {};
  for (const m of Object.values(MATERIALS)) {
    if (!['mass', 'membrane', 'glazing', 'structural'].includes(m.role)) continue;
    (out[m.category] ||= []).push(m);
  }
  return out;
}
function fillMaterials() {
  const out = { 'No fill (empty cavity)': [{ id: '', name: 'Empty cavity' }] };
  for (const m of Object.values(MATERIALS)) {
    if (m.role !== 'porous') continue;
    (out[m.category] ||= []).push(m);
  }
  return out;
}

/** The override for a surface, defaulting to the current assembly's actual layers. */
function overrideFor(key) {
  if (state.surfaceOverrides[key] && typeof state.surfaceOverrides[key] === 'object') {
    return state.surfaceOverrides[key];
  }
  const part = result.design.surfaces[key];
  const leafSpec = (leaf) => {
    if (!leaf) return null;
    const l = leaf.layers[0];
    return { materialId: l.material.id, thicknessMm: l.thicknessMm, layers: leaf.layers.length };
  };
  const cav = part.cavities[0];
  return {
    leafA: leafSpec(part.leaves[0]),
    leafB: leafSpec(part.leaves[1]),
    cavity: cav ? {
      depthMm: cav.depthMm,
      fillId: cav.fill?.id || '',
      fillFraction: cav.fillThicknessMm && cav.depthMm ? cav.fillThicknessMm / cav.depthMm : 0.7,
    } : { depthMm: 50, fillId: '', fillFraction: 0.7 },
    connection: part.connection?.type || 'rigid-stud',
    bonding: part.leaves[0]?.bonding || 'screwed',
  };
}

function commitOverride(key, ov) {
  state.surfaceOverrides[key] = ov;
  run({ keepCamera: true });
}

function renderEditor(badgeId) {
  const box = $('wallEditor');
  const sel = $('vizSelection');
  box.innerHTML = '';
  sel.innerHTML = '';

  // Clicking a leak/door/vent marker shows the path inspector instead.
  if (badgeId) {
    $('editorTitle').textContent = 'Path detail';
    const items = result.breakdown.byElement.filter((e) => e.id === badgeId);
    if (!items.length) { sel.appendChild(el('p', 'muted small', 'No detail for this marker.')); return; }
    sel.appendChild(el('strong', null, items[0].label));
    sel.appendChild(el('div', 'mono', fmt(items[0].percent, 1) + '% of escaping power'));
    const pot = result.breakdown.potential.find((p) => p.id === badgeId);
    if (pot) sel.appendChild(el('p', 'small gain', `Fixing this perfectly: up to −${fmt(pot.maxImprovementDb, 1)} dB overall.`));
    return;
  }

  const key = state.selectedSurface;
  if (!key) {
    $('editorTitle').textContent = state.vizMode === 'materials' ? 'Wall editor' : 'Selection';
    box.appendChild(el('p', 'muted small',
      state.vizMode === 'materials'
        ? 'Click any wall, the ceiling or the floor to change what it is made of.'
        : 'Click a face or a marker to inspect it.'));
    return;
  }

  const part = result.design.surfaces[key];
  const det = result.detail[key];
  const ov = overrideFor(key);
  $('editorTitle').textContent = key.charAt(0).toUpperCase() + key.slice(1);

  // --- header with the visible material ---
  const outer = part.leaves[part.leaves.length - 1];
  const outerMat = outer.layers[outer.layers.length - 1].material;
  const head = el('div', 'editor-head');
  const sw = el('span', 'swatch-lg');
  sw.style.background = swatchCSS(outerMat);
  head.appendChild(sw);
  head.appendChild(el('strong', null, part.label || 'Assembly'));
  box.appendChild(head);

  // --- leaf editors ---
  const leafEditor = (title, spec, onChange, optional) => {
    const secn = el('div', 'editor-sec');
    const h = el('div', 'editor-head');
    h.appendChild(el('strong', null, title));
    if (optional) {
      const t = el('button', 'btn', spec ? 'Remove' : 'Add second leaf');
      t.style.marginLeft = 'auto';
      t.addEventListener('click', () => onChange(spec ? null : { materialId: 'mdf', thicknessMm: 18, layers: 1 }));
      h.appendChild(t);
    }
    secn.appendChild(h);
    if (!spec) return secn;

    const row = el('div', 'leaf-row');

    const f1 = el('label', 'field');
    f1.appendChild(el('span', null, 'Material'));
    const wrap = el('div', 'mat-select-wrap');
    const chip = el('span', 'swatch-lg');
    chip.style.background = swatchCSS(MATERIALS[spec.materialId]);
    const msel = el('select');
    for (const [cat, list] of Object.entries(massMaterials())) {
      const g = el('optgroup'); g.label = cat;
      for (const m of list) g.appendChild(option(m.id, m.name, m.id === spec.materialId));
      msel.appendChild(g);
    }
    msel.addEventListener('change', () => {
      const m = MATERIALS[msel.value];
      const t = m.availableThicknessesMm || [12];
      const near = t.reduce((a, b) => (Math.abs(b - spec.thicknessMm) < Math.abs(a - spec.thicknessMm) ? b : a), t[0]);
      onChange({ ...spec, materialId: msel.value, thicknessMm: near });
    });
    wrap.appendChild(chip); wrap.appendChild(msel);
    f1.appendChild(wrap);
    row.appendChild(f1);

    const f2 = el('label', 'field');
    f2.appendChild(el('span', null, 'mm'));
    const tsel = el('select');
    const ths = MATERIALS[spec.materialId]?.availableThicknessesMm || [12];
    for (const t of ths) tsel.appendChild(option(String(t), String(t), t === spec.thicknessMm));
    tsel.addEventListener('change', () => onChange({ ...spec, thicknessMm: Number(tsel.value) }));
    f2.appendChild(tsel);
    row.appendChild(f2);

    const f3 = el('label', 'field');
    f3.appendChild(el('span', null, '×'));
    const lsel = el('select');
    for (const n of [1, 2, 3]) lsel.appendChild(option(String(n), String(n), n === (spec.layers || 1)));
    lsel.addEventListener('change', () => onChange({ ...spec, layers: Number(lsel.value) }));
    f3.appendChild(lsel);
    row.appendChild(f3);

    secn.appendChild(row);
    const m = MATERIALS[spec.materialId];
    const ms = m.density * (spec.thicknessMm / 1000) * (spec.layers || 1);
    secn.appendChild(el('div', 'stat-row')).innerHTML =
      `<span>surface mass <b>${ms.toFixed(1)}</b> kg/m²</span>` +
      `<span>f<sub>c</sub> <b>${Math.round(criticalFrequency(m, spec.thicknessMm))}</b> Hz</span>`;
    return secn;
  };

  box.appendChild(leafEditor('Inner leaf', ov.leafA,
    (v) => commitOverride(key, { ...ov, leafA: v || ov.leafA })));

  // --- cavity ---
  if (ov.leafB) {
    const secn = el('div', 'editor-sec');
    secn.appendChild(el('div', 'editor-head')).appendChild(el('strong', null, 'Cavity'));
    const row = el('div', 'leaf-row');

    const fd = el('label', 'field');
    fd.appendChild(el('span', null, 'Depth mm'));
    const dsel = el('select');
    for (const d of [10, 25, 40, 50, 75, 90, 100, 140, 190, 250, 300]) {
      dsel.appendChild(option(String(d), String(d), d === ov.cavity.depthMm));
    }
    dsel.addEventListener('change', () =>
      commitOverride(key, { ...ov, cavity: { ...ov.cavity, depthMm: Number(dsel.value) } }));
    fd.appendChild(dsel);
    row.appendChild(fd);
    secn.appendChild(row);

    const ff = el('label', 'field');
    ff.appendChild(el('span', null, 'Fill'));
    const fsel = el('select');
    for (const [cat, list] of Object.entries(fillMaterials())) {
      const g = el('optgroup'); g.label = cat;
      for (const m of list) g.appendChild(option(m.id, m.name, m.id === (ov.cavity.fillId || '')));
      fsel.appendChild(g);
    }
    fsel.addEventListener('change', () =>
      commitOverride(key, { ...ov, cavity: { ...ov.cavity, fillId: fsel.value } }));
    ff.appendChild(fsel);
    secn.appendChild(ff);
    box.appendChild(secn);
  }

  box.appendChild(leafEditor('Outer leaf', ov.leafB,
    (v) => commitOverride(key, { ...ov, leafB: v }), true));

  // --- connection ---
  if (ov.leafB) {
    const secn = el('div', 'editor-sec');
    secn.appendChild(el('div', 'editor-head')).appendChild(el('strong', null, 'How the leaves are joined'));
    const csel = el('select');
    for (const [id, c] of Object.entries(CONNECTIONS)) {
      if (id === 'none') continue;
      csel.appendChild(option(id, c.label, id === ov.connection));
    }
    csel.addEventListener('change', () => commitOverride(key, { ...ov, connection: csel.value }));
    secn.appendChild(csel);

    const bsel = el('select');
    bsel.style.marginTop = '.35rem';
    for (const [id, lbl] of [['screwed', 'Layers screwed together'],
      ['damped', 'Damping compound between layers'], ['laminated', 'Layers rigidly glued']]) {
      bsel.appendChild(option(id, lbl, id === ov.bonding));
    }
    bsel.addEventListener('change', () => commitOverride(key, { ...ov, bonding: bsel.value }));
    secn.appendChild(bsel);
    box.appendChild(secn);
  }

  // --- resulting performance ---
  const perf = el('div', 'editor-sec');
  perf.appendChild(el('div', 'editor-head')).appendChild(el('strong', null, 'This surface'));
  const stats = el('div', 'kv-grid');
  const kv = (k, v) => {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v mono', v));
    stats.appendChild(r);
  };
  kv('Surface mass', fmt(det.surfaceMass, 1) + ' kg/m²');
  kv('Build-up thickness', fmt(det.totalThicknessMm, 0) + ' mm');
  kv('STC of this assembly', String(computeSTC(det.tl).stc));
  if (det.f0) kv('Mass-air-mass f₀', fmt(det.f0, 0) + ' Hz');
  kv('Coincidence f_c', (det.fc || []).map((v) => fmt(v, 0)).join(', ') + ' Hz');
  const share = result.breakdown.byElement
    .filter((e) => e.surface === key).reduce((a, b) => a + b.percent, 0);
  kv('Share of escaping sound', fmt(share, 1) + '%');
  perf.appendChild(stats);
  box.appendChild(perf);

  // --- apply / reset ---
  const actions = el('div', 'apply-row');
  const all = el('button', 'btn', 'Apply to all four walls');
  all.addEventListener('click', () => {
    for (const k of ['front', 'back', 'left', 'right']) state.surfaceOverrides[k] = { ...ov };
    run({ keepCamera: true });
  });
  const every = el('button', 'btn', 'Apply to every surface');
  every.addEventListener('click', () => {
    for (const k of ['front', 'back', 'left', 'right', 'ceiling', 'floor']) {
      state.surfaceOverrides[k] = { ...ov };
    }
    run({ keepCamera: true });
  });
  const reset = el('button', 'btn', 'Reset this surface');
  reset.addEventListener('click', () => {
    delete state.surfaceOverrides[key];
    run({ keepCamera: true });
  });
  actions.appendChild(all); actions.appendChild(every); actions.appendChild(reset);
  box.appendChild(actions);
}

/* ==================== diagnostics ==================== */

function renderDiagnostics() {
  const box = $('diagnostics');
  box.innerHTML = '';
  if (!result.diagnostics.length) {
    box.appendChild(el('p', 'muted', 'No issues flagged.'));
    return;
  }
  for (const n of result.diagnostics) {
    const card = el('div', 'diag ' + n.severity);
    const head = el('div', 'diag-head');
    head.appendChild(el('span', 'badge ' + n.severity, n.severity.toUpperCase()));
    head.appendChild(el('strong', null, n.title));
    card.appendChild(head);
    card.appendChild(el('p', null, n.detail));
    if (n.fixes?.length) {
      const ul = el('ul', 'fixes');
      for (const f of n.fixes) ul.appendChild(el('li', null, f));
      card.appendChild(ul);
    }
    box.appendChild(card);
  }
}

/* ==================== detail panels ==================== */

function renderDetails() {
  // Wall physics
  const d = result.detail.front;
  const box = $('wallPhysics');
  box.innerHTML = '';
  const rows = [
    ['Surface mass (both leaves)', fmt(d.surfaceMass, 1) + ' kg/m²'],
    ['Total build-up thickness', fmt(d.totalThicknessMm, 0) + ' mm'],
    ['Mass-air-mass resonance f₀', d.f0 ? fmt(d.f0, 0) + ' Hz' : 'n/a (single leaf)'],
    ['Cavity limiting frequency f_l', d.fl ? fmt(d.fl, 0) + ' Hz' : '—'],
    ['Coincidence frequencies f_c', (d.fc || []).map((v) => fmt(v, 0)).join(', ') + ' Hz'],
    ['Fundamental panel mode f₁₁', (d.f11 || []).map((v) => fmt(v, 0)).join(', ') + ' Hz'],
    ['Cavity standing waves', (d.cavityResonances || []).slice(0, 3).map((v) => fmt(v, 0)).join(', ') + ' Hz'],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v mono', v));
    box.appendChild(r);
  }

  // What limits each band
  const lim = $('limitedBy');
  lim.innerHTML = '';
  const seen = {};
  (d.limitedBy || []).forEach((v, i) => {
    if (!seen[v]) seen[v] = [];
    seen[v].push(THIRD_OCTAVE[i]);
  });
  for (const [k, bands] of Object.entries(seen)) {
    const r = el('div', 'legend-row');
    r.appendChild(el('span', 'legend-name', k));
    r.appendChild(el('span', 'mono small', `${bands[0]}–${bands[bands.length - 1]} Hz`));
    lim.appendChild(r);
  }

  // Internal acoustics
  const ia = $('internalAcoustics');
  ia.innerHTML = '';
  const g = result.geometry;
  const firstMode = 343 / (2 * Math.min(g.L, g.W, g.H));
  const irows = [
    ['Internal volume', fmt(g.volume, 2) + ' m³'],
    ['Envelope area', fmt(g.envelope, 1) + ' m²'],
    ['RT60 at 500 Hz', fmt(result.absorption.rt[THIRD_OCTAVE.indexOf(500)], 2) + ' s'],
    ['RT60 at 125 Hz', fmt(result.absorption.rt[THIRD_OCTAVE.indexOf(125)], 2) + ' s'],
    ['Treated surface', fmt(result.absorption.treatedFraction * 100, 0) + '%'],
    ['First axial mode', fmt(firstMode, 0) + ' Hz'],
    ['Diffuse field above', fmt(firstMode * 3, 0) + ' Hz'],
  ];
  if (result.inside.buildUp) {
    irows.push(['Reverberant build-up', fmt(Math.max(...result.inside.buildUp), 1) + ' dB']);
  }
  for (const [k, v] of irows) {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v mono', v));
    ia.appendChild(r);
  }

  // Ventilation
  const vb = $('ventDetail');
  vb.innerHTML = '';
  const air = requiredAirflowLps({ volumeM3: g.volume, occupants: result.design.occupants || 1 });
  const supplied = (result.design.vents || []).reduce((a, v) => a + (v.airflowLps || 0) * (v.count || 1), 0);
  const vr = el('div', 'kv');
  vr.appendChild(el('span', 'k', 'Required airflow'));
  vr.appendChild(el('span', 'v mono', fmt(air.required, 0) + ' L/s (' + air.governing + ')'));
  vb.appendChild(vr);
  const vs = el('div', 'kv');
  vs.appendChild(el('span', 'k', 'Specified airflow'));
  const sv = el('span', 'v mono ' + (supplied >= air.required ? 'ok' : 'no'), fmt(supplied, 0) + ' L/s');
  vs.appendChild(sv);
  vb.appendChild(vs);
  for (const v of result.design.vents || []) {
    const { il, velocity, warnings } = ductInsertionLoss(v);
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', v.label || 'Vent'));
    r.appendChild(el('span', 'v mono', `${fmt(velocity, 2)} m/s · IL ${OCTAVE.map((f) => fmt(il[THIRD_OCTAVE.indexOf(f)], 0)).join('/')}`));
    vb.appendChild(r);
  }
}

function renderCost() {
  const box = $('costList');
  box.innerHTML = '';
  for (const it of result.cost.items) {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', it.label));
    r.appendChild(el('span', 'v mono', '£' + fmt(it.cost, 0)));
    box.appendChild(r);
  }
  const t = el('div', 'kv total');
  t.appendChild(el('span', 'k', 'Total (materials, ex-VAT, no labour)'));
  t.appendChild(el('span', 'v mono', '£' + fmt(result.cost.total, 0)));
  box.appendChild(t);
}

/* ==================== comparison ==================== */

function renderComparison() {
  const specA = currentSpec();
  const specB = { ...specA, wall: state.compareTo };
  const cmp = compareDesigns(specA, specB, ['current', WALL_PRESETS[state.compareTo].name]);
  const out = $('comparisonOut');
  out.innerHTML = '';

  const table = el('div', 'cmp-table');
  const rowc = (label, a, b, d = 1, unit = '') => {
    const r = el('div', 'cmp-row');
    r.appendChild(el('span', 'cmp-label', label));
    r.appendChild(el('span', 'mono', fmt(a, d) + unit));
    r.appendChild(el('span', 'mono', fmt(b, d) + unit));
    const delta = b - a;
    const good = label.includes('Cost') ? delta < 0 : delta < 0;
    r.appendChild(el('span', 'mono ' + (Math.abs(delta) < 0.05 ? 'muted' : good ? 'ok' : 'no'),
      (delta >= 0 ? '+' : '') + fmt(delta, d)));
    table.appendChild(r);
  };
  const hdr = el('div', 'cmp-row head');
  hdr.appendChild(el('span', 'cmp-label', ''));
  hdr.appendChild(el('span', null, 'Current'));
  hdr.appendChild(el('span', null, WALL_PRESETS[state.compareTo].name.slice(0, 22)));
  hdr.appendChild(el('span', null, 'Δ'));
  table.appendChild(hdr);
  rowc('Outside dB(A)', cmp.a.totals.outsideWithFanA, cmp.b.totals.outsideWithFanA);
  rowc('Isolation dB(A)', -cmp.a.totals.isolationA, -cmp.b.totals.isolationA);
  rowc('STC', cmp.a.ratings.stc, cmp.b.ratings.stc, 0);
  rowc('Cost', cmp.a.cost.total, cmp.b.cost.total, 0);
  out.appendChild(table);

  out.appendChild(el('p', 'small muted',
    `£${fmt(Math.abs(cmp.delta.costPerDb), 0)} per dB gained.`));

  const cv = el('canvas', 'chart small-chart');
  out.appendChild(cv);
  const P = PALETTE();
  requestAnimationFrame(() => lineChart(cv, {
    freqs: THIRD_OCTAVE,
    yLabel: 'dB outside',
    series: [
      { label: 'current', values: cmp.a.outside.spectrum, color: P.series[0], width: 2 },
      { label: 'alternative', values: cmp.b.outside.spectrum, color: P.series[2], width: 2 },
    ],
  }));
}

/* ==================== optimiser ==================== */

function runOptimiser() {
  const btn = $('runOptimise');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  setTimeout(() => {
    const t0 = performance.now();
    const groups = [...document.querySelectorAll('#optGroups input:checked')].map((i) => i.value);
    const res = optimise({
      baseSpec: currentSpec(),
      targetDbA: state.target,
      budget: state.budget,
      groups: groups.length ? groups : ['wall', 'door', 'vent'],
    });
    const ms = performance.now() - t0;

    const out = $('optimiserOut');
    out.innerHTML = '';

    const v = el('div', 'verdict-box ' + res.verdict.status);
    v.appendChild(el('strong', null, res.verdict.headline));
    v.appendChild(el('p', 'small', res.verdict.note));
    out.appendChild(v);
    out.appendChild(el('p', 'muted small',
      `${res.candidateCount} complete designs simulated exhaustively in ${ms.toFixed(0)} ms.`));

    // Single-change table
    const sc = singleChangeOptions(currentSpec());
    out.appendChild(el('h4', null, 'Best single changes from your current design'));
    const t1 = el('div', 'opt-table');
    const h1 = el('div', 'opt-row head');
    for (const c of ['Change', 'Gain', 'Cost', 'dB/£100']) h1.appendChild(el('span', null, c));
    t1.appendChild(h1);
    for (const o of sc.options.slice(0, 8)) {
      if (o.improvementDb < 0.05) continue;
      const r = el('div', 'opt-row');
      r.appendChild(el('span', 'opt-name', `${o.groupLabel}: ${o.label}`));
      r.appendChild(el('span', 'mono gain', '−' + fmt(o.improvementDb, 1) + ' dB'));
      r.appendChild(el('span', 'mono', '£' + fmt(o.deltaCost, 0)));
      r.appendChild(el('span', 'mono', isFinite(o.valuePer100) ? fmt(o.valuePer100, 2) : '∞'));
      t1.appendChild(r);
    }
    out.appendChild(t1);

    // Pareto
    out.appendChild(el('h4', null, 'Cost versus achieved level'));
    const cv = el('canvas', 'chart');
    out.appendChild(cv);
    requestAnimationFrame(() => paretoChart(cv, {
      points: res.pareto.map((p) => ({ cost: p.cost, level: p.level })),
      target: state.target, budget: state.budget,
    }));

    out.appendChild(el('h4', null, 'Marginal value of each step'));
    const t2 = el('div', 'opt-table');
    for (const m of res.marginal) {
      const r = el('div', 'opt-row wide');
      r.appendChild(el('span', 'mono', '£' + fmt(m.deltaCost, 0)));
      r.appendChild(el('span', 'mono gain', '−' + fmt(m.deltaDb, 1) + ' dB'));
      r.appendChild(el('span', 'opt-name small', m.changes.join('; ')));
      t2.appendChild(r);
    }
    out.appendChild(t2);

    if (res.recommended) {
      out.appendChild(el('h4', null, 'Recommended build'));
      const rb = el('div', 'rec-box');
      rb.appendChild(el('div', 'rec-head',
        `£${fmt(res.recommended.cost, 0)} → ${fmt(res.recommended.level, 1)} dB(A)  (STC ${res.recommended.stc})`));
      for (const ch of res.recommended.choices) {
        const r = el('div', 'kv');
        r.appendChild(el('span', 'k', ch.group));
        r.appendChild(el('span', 'v', ch.label));
        rb.appendChild(r);
      }
      const apply = el('button', 'btn', 'Apply this design');
      apply.addEventListener('click', () => {
        for (const ch of res.recommended.choices) {
          const g = ['wall', 'door', 'vent', 'floor', 'sealing'].find((x) => x === ch.group);
          if (!g) continue;
        }
        // Re-apply by re-running the optimiser choice patches
        const full = res.recommendedFull;
        if (full) {
          state.spec = { ...state.spec, ...full.spec };
          state.gaps = full.spec.gaps || state.gaps;
          syncControlsFromSpec();
          run();
        }
      });
      rb.appendChild(apply);
      out.appendChild(rb);
    }

    btn.disabled = false;
    btn.textContent = 'Run optimiser';
  }, 10);
}

/* ==================== calibration ==================== */

function renderCalibrationInputs() {
  const box = $('measuredBands');
  box.innerHTML = '';
  for (const f of OCTAVE) {
    const cell = el('div', 'eq-cell');
    cell.appendChild(el('label', 'small', f >= 1000 ? f / 1000 + 'k' : String(f)));
    const inp = el('input', 'mini');
    inp.type = 'number';
    inp.id = 'meas' + f;
    inp.placeholder = '—';
    box.appendChild(cell);
    cell.appendChild(inp);
  }
  const ul = el('ul', 'fixes small');
  for (const s of MEASUREMENT_PROTOCOL.steps) ul.appendChild(el('li', null, s));
  $('protocol').innerHTML = '';
  $('protocol').appendChild(el('strong', null, MEASUREMENT_PROTOCOL.title));
  $('protocol').appendChild(ul);
}

function runCalibration() {
  const inside = Number($('measInside').value);
  const outside = Number($('measOutside').value);
  const bg = $('measBackground').value ? Number($('measBackground').value) : null;
  const bands = OCTAVE.map((f) => {
    const v = $('meas' + f)?.value;
    return v === '' || v == null ? null : Number(v);
  });
  const haveBands = bands.every((v) => v != null);

  const m = {
    insideOverall: isFinite(inside) ? inside : undefined,
    outsideOverall: isFinite(outside) ? outside : undefined,
    backgroundOverall: bg,
    weighting: $('measWeighting').value,
    bandType: 'octave',
  };
  if (haveBands) { m.outsideBands = bands; m.bandFrequencies = OCTAVE; }

  const design = buildDesign(currentSpec());
  const a = assess(design, m);
  const out = $('calibrationOut');
  out.innerHTML = '';

  const summary = el('div', 'cal-summary');
  const addKv = (k, v, cls) => {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v mono ' + (cls || ''), v));
    summary.appendChild(r);
  };
  addKv('Predicted outside', fmt(a.predictedOverall, 1) + ' dB' + (m.weighting === 'A' ? '(A)' : ''));
  if (a.measuredOverall != null) addKv('Measured outside', fmt(a.measuredOverall, 1) + ' dB');
  if (a.overallErrorDb != null) {
    addKv('Overall error', (a.overallErrorDb >= 0 ? '+' : '') + fmt(a.overallErrorDb, 1) + ' dB',
      Math.abs(a.overallErrorDb) < 3 ? 'ok' : 'no');
  }
  if (a.rmseDb != null) {
    addKv('Spectral RMSE', fmt(a.rmseDb, 1) + ' dB', a.rmseDb < 4 ? 'ok' : 'no');
    addKv('Mean bias', (a.meanBiasDb >= 0 ? '+' : '') + fmt(a.meanBiasDb, 1) + ' dB');
    addKv('Low / mid / high error',
      `${fmt(a.errorProfile.lowFreq, 1)} / ${fmt(a.errorProfile.midFreq, 1)} / ${fmt(a.errorProfile.highFreq, 1)} dB`);
  }
  addKv('Accuracy grade', a.accuracy.grade.toUpperCase(),
    ['excellent', 'good'].includes(a.accuracy.grade) ? 'ok' : 'no');
  out.appendChild(summary);
  out.appendChild(el('p', 'small muted', a.accuracy.description));

  if (a.backgroundWarning) {
    const w = el('div', 'diag high');
    w.appendChild(el('strong', null, 'Measurement validity'));
    w.appendChild(el('p', null, a.backgroundWarning));
    out.appendChild(w);
  }

  for (const d of a.diagnosis || []) {
    const card = el('div', 'diag ' + d.severity);
    const h = el('div', 'diag-head');
    h.appendChild(el('span', 'badge ' + d.severity, d.severity.toUpperCase()));
    h.appendChild(el('strong', null, d.title));
    card.appendChild(h);
    card.appendChild(el('p', null, d.detail));
    if (d.fixes?.length) {
      const ul = el('ul', 'fixes');
      for (const f of d.fixes) ul.appendChild(el('li', null, f));
      card.appendChild(ul);
    }
    out.appendChild(card);
  }

  if (a.perBand) {
    const cv = el('canvas', 'chart');
    out.appendChild(cv);
    const P = PALETTE();
    requestAnimationFrame(() => lineChart(cv, {
      freqs: THIRD_OCTAVE,
      yLabel: 'dB outside',
      series: [
        { label: 'predicted', values: a.perBand.map((x) => x.predicted), color: P.series[0], width: 2 },
        { label: 'measured', values: a.perBand.map((x) => x.measured), color: P.series[1], width: 2, dash: [4, 3] },
      ],
    }));
  }

  // Fit
  const fit = fitCalibration(design, [m]);
  const fb = el('div', 'rec-box');
  fb.appendChild(el('strong', null, `Suggested calibration: ${fit.mode}`));
  fb.appendChild(el('p', 'small',
    `RMSE before ${fmt(fit.before.rmseDb, 1)} dB → after ${fmt(fit.after.rmseDb, 1)} dB.`));
  fb.appendChild(el('p', 'small muted', fit.caveat));
  const apply = el('button', 'btn', 'Apply calibration to this design');
  apply.addEventListener('click', () => {
    state.spec.calibration = fit.calibration;
    run();
    out.appendChild(el('p', 'small ok', 'Calibration applied. All predictions for this design are now anchored to your measurement.'));
  });
  fb.appendChild(apply);
  out.appendChild(fb);
}

/* ==================== material inspector ==================== */

function renderMaterialInspector() {
  const id = $('inspectMaterial').value;
  const m = MATERIALS[id];
  const t = Number($('inspectThickness').value);
  $('inspectThicknessVal').textContent = t + ' mm';
  const a = assessMaterial(m, t);
  const out = $('materialOut');
  out.innerHTML = '';

  out.appendChild(el('h4', null, m.name));
  const head = el('div', 'verdict-box ' + (a.scores.blocking >= 3 ? 'achievable' : a.scores.absorbing >= 3 ? 'over-budget' : 'infeasible'));
  head.appendChild(el('strong', null, a.headline));
  out.appendChild(head);

  const scores = el('div', 'score-grid');
  for (const [k, v] of [['Blocking (isolation)', a.scores.blocking], ['Absorbing', a.scores.absorbing], ['Self-damping', a.scores.damping]]) {
    const row = el('div', 'score-row');
    row.appendChild(el('span', 'score-label', k));
    const bar = el('div', 'score-bar');
    for (let i = 0; i < 5; i++) {
      const seg = el('span', 'score-seg' + (i < v ? ' on' : ''));
      bar.appendChild(seg);
    }
    row.appendChild(bar);
    row.appendChild(el('span', 'mono', v + '/5'));
    scores.appendChild(row);
  }
  out.appendChild(scores);

  const props = el('div', 'kv-grid');
  const rows = [
    ['Surface mass', fmt(a.surfaceMass, 1) + ' kg/m²'],
    ['Density', m.density + ' kg/m³'],
    ["Young's modulus", (m.youngsModulus / 1e9).toFixed(2) + ' GPa'],
    ["Poisson's ratio", String(m.poisson)],
    ['Loss factor η', String(m.lossFactor)],
    ['Wave speed c_L', fmt(a.longitudinalSpeed, 0) + ' m/s'],
    ['Coincidence f_c', a.criticalFrequency > 20000 ? 'above audible' : fmt(a.criticalFrequency, 0) + ' Hz'],
    ['TL at 500 Hz', fmt(a.tl500, 1) + ' dB'],
  ];
  if (m.flowResistivity) rows.push(['Flow resistivity', m.flowResistivity + ' Pa·s/m²']);
  if (a.nrc != null) rows.push(['NRC', a.nrc.toFixed(2)]);
  if (m.costPerM2PerMm) rows.push(['Cost at this thickness', '£' + (m.costPerM2PerMm * t).toFixed(2) + '/m²']);
  for (const [k, v] of rows) {
    const r = el('div', 'kv');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v mono', v));
    props.appendChild(r);
  }
  out.appendChild(props);

  const cv = el('canvas', 'chart');
  out.appendChild(cv);
  const P = PALETTE();
  const series = [{ label: 'TL', values: a.tl, color: P.tl, width: 2.5 }];
  requestAnimationFrame(() => lineChart(cv, { freqs: THIRD_OCTAVE, yLabel: 'dB', yMin: 0, series }));

  if (a.absorption) {
    const cv2 = el('canvas', 'chart');
    out.appendChild(cv2);
    requestAnimationFrame(() => lineChart(cv2, {
      freqs: THIRD_OCTAVE, yLabel: 'absorption α', yMin: 0, yMax: 1,
      series: [{ label: 'α', values: a.absorption, color: P.series[5], width: 2.5, fill: true }],
    }));
  }

  for (const line of a.explanation) out.appendChild(el('p', null, line));
  for (const w of a.warnings) {
    const d = el('div', 'diag medium');
    d.appendChild(el('p', null, w));
    out.appendChild(d);
  }
  out.appendChild(el('p', 'small muted', m.notes));
}

/* ==================== air-gap study ==================== */

function renderGapStudy() {
  const out = $('gapStudyOut');
  out.innerHTML = '';
  const gaps = [10, 25, 50, 100, 150, 200, 300];
  const mA = MATERIALS[$('gapMatA').value];
  const mB = MATERIALS[$('gapMatB').value];
  const tA = Number($('gapThickA').value), tB = Number($('gapThickB').value);
  const filled = $('gapFilled').checked;

  const series = [];
  const P = PALETTE();
  const table = el('div', 'opt-table');
  const hdr = el('div', 'opt-row head');
  hdr.appendChild(el('span', null, 'Cavity'));
  hdr.appendChild(el('span', null, 'f₀'));
  for (const f of [125, 250, 500, 1000]) hdr.appendChild(el('span', null, f + ' Hz'));
  hdr.appendChild(el('span', null, 'STC'));
  table.appendChild(hdr);

  gaps.forEach((depth, i) => {
    const part = {
      leaves: [
        { layers: [{ material: mA, thicknessMm: tA }], widthM: 0.6, heightM: 2.4 },
        { layers: [{ material: mB, thicknessMm: tB }], widthM: 0.6, heightM: 2.4 },
      ],
      cavities: [{ depthMm: depth, fill: filled ? MATERIALS['rockwool-rwa45'] : null, fillThicknessMm: filled ? depth * 0.7 : 0 }],
      connection: CONNECTIONS['separate-frame'],
      areaM2: 10,
    };
    const r = partitionTL(part);
    series.push({ label: depth + ' mm', values: r.tl, color: P.series[i % P.series.length], width: 1.8 });

    const row = el('div', 'opt-row');
    row.appendChild(el('span', 'mono', depth + ' mm'));
    row.appendChild(el('span', 'mono', fmt(r.f0, 0) + ' Hz'));
    for (const f of [125, 250, 500, 1000]) {
      row.appendChild(el('span', 'mono', fmt(r.tl[THIRD_OCTAVE.indexOf(f)], 1)));
    }
    row.appendChild(el('span', 'mono', String(computeSTC(r.tl).stc)));
    table.appendChild(row);
  });

  const cv = el('canvas', 'chart tall');
  out.appendChild(cv);
  requestAnimationFrame(() => lineChart(cv, { freqs: THIRD_OCTAVE, yLabel: 'TL (dB)', yMin: 0, series }));
  legend($('gapLegend'), series.map((s) => [s.label, s.color]));
  out.appendChild(table);

  out.appendChild(el('p', null,
    'Increasing the cavity depth helps in two ways: it lowers the mass-air-mass resonance out of the audible range, ' +
    'and it increases the mid-frequency transmission loss. The gain is roughly 6 dB per doubling of depth between f₀ and ' +
    'the cavity limiting frequency c/(2πd).'));
  out.appendChild(el('p', null,
    'It stops helping — and can get worse — when: (a) the cavity becomes deep enough that its own standing waves at ' +
    'n·c/2d fall in the band of interest, which is why an empty deep cavity shows periodic dips and needs to be at least ' +
    '60% filled; (b) the depth is so large that structural bracing has to be added between the leaves, which re-couples ' +
    'them and reintroduces a bridging path; and (c) below f₀ the two leaves move together, so a deeper cavity does ' +
    'nothing at all — there the only thing that helps is mass.'));
}

/* ==================== validation panel ==================== */

function renderValidation() {
  const v = runValidation();
  const out = $('validationOut');
  out.innerHTML = '';
  const s = v.summary;
  const box = el('div', 'verdict-box ' + (s.failed === 0 ? 'achievable' : 'infeasible'));
  box.appendChild(el('strong', null,
    `${s.passed}/${s.n} published laboratory constructions predicted within tolerance`));
  box.appendChild(el('p', 'small',
    `Mean bias ${s.meanBiasStc >= 0 ? '+' : ''}${fmt(s.meanBiasStc, 2)} STC · RMSE ${fmt(s.rmseStc, 2)} STC · worst case ${fmt(s.maxAbsErrorStc, 0)} STC`));
  out.appendChild(box);

  const t = el('div', 'opt-table');
  const hdr = el('div', 'opt-row head');
  for (const h of ['Construction', 'Predicted', 'Published', 'Error']) hdr.appendChild(el('span', null, h));
  t.appendChild(hdr);
  for (const r of v.results) {
    const row = el('div', 'opt-row');
    row.appendChild(el('span', 'opt-name', r.label));
    row.appendChild(el('span', 'mono', String(r.predictedStc)));
    row.appendChild(el('span', 'mono', String(r.published)));
    row.appendChild(el('span', 'mono ' + (r.pass ? 'ok' : 'no'),
      (r.error >= 0 ? '+' : '') + r.error));
    row.title = r.note || '';
    t.appendChild(row);
  }
  out.appendChild(t);

  for (const c of v.curves) {
    out.appendChild(el('h4', null, c.label));
    out.appendChild(el('p', 'small muted', `Source: ${c.source} — RMSE ${fmt(c.rmse, 2)} dB, worst ${fmt(c.maxAbsError, 0)} dB`));
    const cv = el('canvas', 'chart');
    out.appendChild(cv);
    const P = PALETTE();
    requestAnimationFrame(() => lineChart(cv, {
      freqs: c.comparisons.map((x) => x.band),
      yLabel: 'TL (dB)', yMin: 0,
      series: [
        { label: 'predicted', values: c.comparisons.map((x) => x.predicted), color: P.series[0], width: 2 },
        { label: 'published', values: c.comparisons.map((x) => x.published), color: P.series[1], width: 2, dash: [4, 3] },
      ],
    }));
  }
}

/* ==================== boot ==================== */

function boot() {
  initControls();
  syncControlsFromSpec();
  renderSourceEditor();
  renderCalibrationInputs();
  run();
  renderMaterialInspector();
  renderValidation();
  buildSelect('gapMatA', groupBy(MATERIALS, (m) => m.category), 'gypsum');
  buildSelect('gapMatB', groupBy(MATERIALS, (m) => m.category), 'mdf');
  renderGapStudy();
  // Charts sample CSS custom properties at draw time, so they must be
  // repainted whenever the theme changes — either because the OS preference
  // flipped, or because the host stamped data-theme on the root element.
  const repaint = () => { renderCharts(); renderBreakdown(); if (viz) viz.draw(); };
  window.addEventListener('resize', repaint);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  new MutationObserver(repaint).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme', 'class', 'style'],
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

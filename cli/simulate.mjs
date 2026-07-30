#!/usr/bin/env node
/**
 * IsoLab command-line simulator.
 *
 *   node cli/simulate.mjs --scenario bedroom-diy
 *   node cli/simulate.mjs --wall booth-pro --door acoustic-45 --vent labyrinth --level 110
 *   node cli/simulate.mjs --scenario bedroom-good --optimise --target 30 --budget 2000
 *   node cli/simulate.mjs --validate
 *   node cli/simulate.mjs --list
 *   node cli/simulate.mjs --material acoustic-foam --thickness 50
 *   node cli/simulate.mjs --compare booth-budget booth-pro
 *   node cli/simulate.mjs --json --scenario bedroom-good
 */

import { simulate } from '../src/core/solver.mjs';
import { buildDesign, buildScenario, SCENARIOS } from '../src/data/designs.mjs';
import { WALL_PRESETS, DOOR_PRESETS, FLOOR_PRESETS } from '../src/data/assemblies.mjs';
import { DUCT_PRESETS, ductInsertionLoss, requiredAirflowLps, recommendDuct } from '../src/core/duct.mjs';
import { ENVIRONMENTS, SEPARATING_ELEMENTS } from '../src/data/environments.mjs';
import { SOURCES } from '../src/data/sources.mjs';
import { MATERIALS, materialsByCategory } from '../src/data/materials.mjs';
import { assessMaterial, rankByValue } from '../src/core/assess.mjs';
import { optimise, singleChangeOptions, compareDesigns } from '../src/core/optimizer.mjs';
import { runValidation, formatValidation } from '../src/core/validation.mjs';
import { OCTAVE, THIRD_OCTAVE } from '../src/core/bands.mjs';
import { MOUNTING_PRESETS } from '../src/core/structure.mjs';

/* ---------------- arg parsing ---------------- */
const argv = process.argv.slice(2);
const args = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  } else positional.push(a);
}

/* ---------------- formatting helpers ---------------- */
const C = process.stdout.isTTY && !args['no-color'];
const c = (code, s) => (C ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = (s) => c(1, s);
const dim = (s) => c(2, s);
const red = (s) => c(31, s);
const green = (s) => c(32, s);
const yellow = (s) => c(33, s);
const cyan = (s) => c(36, s);
const mag = (s) => c(35, s);

const W = 78;
const rule = (ch = '─') => dim(ch.repeat(W));
const head = (s) => `\n${bold(s)}\n${rule()}`;
const num = (v, d = 1) => (v == null || !isFinite(v) ? '  —' : v.toFixed(d));

function severityColor(sev) {
  return sev === 'critical' ? red : sev === 'high' ? yellow : sev === 'medium' ? cyan : dim;
}

/** Horizontal bar for a 0..max value. */
function bar(v, max, width = 28, ch = '█') {
  const n = Math.max(0, Math.min(width, Math.round((v / max) * width)));
  return ch.repeat(n) + dim('·'.repeat(width - n));
}

/** ASCII spectrum plot over the 8 octave bands. */
function spectrumPlot(series, opts = {}) {
  const rows = opts.rows || 14;
  const all = series.flatMap((s) => s.values);
  const lo = opts.min ?? Math.floor((Math.min(...all) - 3) / 10) * 10;
  const hi = opts.max ?? Math.ceil((Math.max(...all) + 3) / 10) * 10;
  const marks = ['#', 'o', '+', '.'];
  const cols = OCTAVE.length;
  const colW = 8;
  const out = [];
  for (let r = rows - 1; r >= 0; r--) {
    const yTop = lo + ((r + 1) * (hi - lo)) / rows;
    const yBot = lo + (r * (hi - lo)) / rows;
    let line = String(Math.round(yBot)).padStart(4) + ' ' + dim('│');
    for (let ci = 0; ci < cols; ci++) {
      let cell = ' ';
      for (let si = 0; si < series.length; si++) {
        const v = series[si].values[ci];
        if (v >= yBot && v < yTop) cell = series[si].color ? series[si].color(marks[si]) : marks[si];
      }
      line += cell.padStart(Math.ceil(colW / 2)).padEnd(colW);
    }
    out.push(line);
  }
  out.push('     ' + dim('└' + '─'.repeat(cols * colW)));
  out.push('      ' + OCTAVE.map((f) => String(f >= 1000 ? f / 1000 + 'k' : f).padStart(Math.ceil(colW / 2)).padEnd(colW)).join(''));
  out.push('      ' + dim('Hz'));
  out.push('');
  out.push('      ' + series.map((s, i) => `${s.color ? s.color(marks[i]) : marks[i]} ${s.label}`).join('   '));
  return out.join('\n');
}

/* ---------------- commands ---------------- */

function cmdList() {
  console.log(head('SCENARIOS  (--scenario <id>)'));
  for (const [id, s] of Object.entries(SCENARIOS)) console.log(`  ${cyan(id.padEnd(22))} ${s.name}`);

  console.log(head('WALL ASSEMBLIES  (--wall <id>)'));
  let cat = '';
  for (const [id, p] of Object.entries(WALL_PRESETS)) {
    if (p.category !== cat) { cat = p.category; console.log(dim(`  ── ${cat}`)); }
    console.log(`  ${cyan(id.padEnd(22))} ${p.name}${p.labStc ? dim(`  [lab STC ${p.labStc}]`) : ''}`);
  }

  console.log(head('DOORS  (--door <id>)'));
  for (const [id, p] of Object.entries(DOOR_PRESETS)) {
    console.log(`  ${cyan(id.padEnd(22))} ${p.name}${p.labStc ? dim(`  [lab STC ${p.labStc}]`) : ''}`);
  }

  console.log(head('VENTILATION  (--vent <id>)'));
  for (const [id, p] of Object.entries(DUCT_PRESETS)) console.log(`  ${cyan(id.padEnd(22))} ${p.label}`);

  console.log(head('FLOOR SYSTEMS  (--floor <id>)'));
  for (const [id, p] of Object.entries(FLOOR_PRESETS)) console.log(`  ${cyan(id.padEnd(22))} ${p.name}`);

  console.log(head('ENVIRONMENTS  (--env <id>)'));
  for (const [id, e] of Object.entries(ENVIRONMENTS)) console.log(`  ${cyan(id.padEnd(22))} ${e.name}`);

  console.log(head('SEPARATING ELEMENTS  (--separating <id>)'));
  for (const [id, e] of Object.entries(SEPARATING_ELEMENTS)) console.log(`  ${cyan(id.padEnd(22))} ${e.label}`);

  console.log(head('SOURCES  (--source <id>)'));
  for (const [id, s] of Object.entries(SOURCES)) {
    console.log(`  ${cyan(id.padEnd(22))} ${s.name}${dim(`  [typical ${s.refSpl} dB @ 1 m]`)}`);
  }

  console.log(head('MATERIALS  (--material <id>)'));
  for (const [category, list] of Object.entries(materialsByCategory())) {
    console.log(dim(`  ── ${category}`));
    for (const m of list) console.log(`  ${cyan(m.id.padEnd(22))} ${m.name}`);
  }
  console.log('');
}

function cmdMaterial(id) {
  const m = MATERIALS[id];
  if (!m) { console.error(red(`Unknown material "${id}". Use --list to see them all.`)); process.exit(1); }
  const t = args.thickness ? Number(args.thickness) : undefined;
  const a = assessMaterial(m, t);

  console.log(head(`${m.name}  —  ${a.thicknessMm} mm`));
  console.log(`  ${bold(a.headline)}\n`);
  console.log(`  ${dim('Category')}          ${m.category} / ${m.role}`);
  console.log(`  ${dim('Density')}           ${m.density} kg/m³`);
  console.log(`  ${dim('Surface mass')}      ${num(a.surfaceMass, 1)} kg/m² at ${a.thicknessMm} mm`);
  console.log(`  ${dim(`Young's modulus`)}   ${(m.youngsModulus / 1e9).toFixed(2)} GPa`);
  console.log(`  ${dim(`Poisson's ratio`)}   ${m.poisson}`);
  console.log(`  ${dim('Loss factor η')}     ${m.lossFactor}`);
  console.log(`  ${dim('Wave speed c_L')}    ${num(a.longitudinalSpeed, 0)} m/s`);
  console.log(`  ${dim('Coincidence f_c')}   ${a.criticalFrequency > 20000 ? 'above audible range' : num(a.criticalFrequency, 0) + ' Hz'}`);
  if (m.flowResistivity) console.log(`  ${dim('Flow resistivity')}  ${m.flowResistivity} Pa·s/m²`);
  if (a.nrc != null) console.log(`  ${dim('NRC (absorption)')}  ${a.nrc.toFixed(2)}`);
  if (m.costPerM2PerMm) console.log(`  ${dim('Indicative cost')}   £${(m.costPerM2PerMm * a.thicknessMm).toFixed(2)}/m² at ${a.thicknessMm} mm`);

  const scoreBar = (v) => (v > 0 ? green('▰'.repeat(v)) : '') + dim('▱'.repeat(5 - v));
  console.log(`\n  ${dim('Blocking (isolation)')}  ${scoreBar(a.scores.blocking)}  ${a.scores.blocking}/5`);
  console.log(`  ${dim('Absorbing')}             ${scoreBar(a.scores.absorbing)}  ${a.scores.absorbing}/5`);
  console.log(`  ${dim('Self-damping')}          ${scoreBar(a.scores.damping)}  ${a.scores.damping}/5`);

  console.log(head('Transmission loss of a single leaf of this material'));
  const oct = OCTAVE.map((f) => a.tl[THIRD_OCTAVE.indexOf(f)]);
  console.log(spectrumPlot([{ label: 'TL (dB)', values: oct, color: green }], { rows: 12 }));

  if (a.absorption) {
    console.log(head('Random-incidence absorption coefficient'));
    const ao = OCTAVE.map((f) => a.absorption[THIRD_OCTAVE.indexOf(f)] * 100);
    console.log(spectrumPlot([{ label: 'α × 100', values: ao, color: cyan }], { rows: 10, min: 0, max: 100 }));
  }

  console.log(head('Assessment'));
  for (const line of a.explanation) console.log(wrap(line, 2));
  if (a.warnings.length) {
    console.log('');
    for (const wn of a.warnings) console.log(yellow(wrap('! ' + wn, 2)));
  }
  console.log(head('Manufacturer / handbook note'));
  console.log(wrap(m.notes, 2));
  console.log('');
}

function cmdValueTable() {
  console.log(head('Cost per unit surface mass — the cheapest way to add isolation'));
  console.log(dim('  Mass is what blocks sound. This ranks every mass-capable material by'));
  console.log(dim('  what it costs to add 1 kg/m² of surface density.\n'));
  console.log('  ' + 'Material'.padEnd(38) + 'kg/m²/mm'.padStart(10) + '£/m²/mm'.padStart(10) + '£ per kg/m²'.padStart(14));
  console.log('  ' + dim('─'.repeat(W - 4)));
  for (const r of rankByValue(MATERIALS)) {
    const m = r.material;
    console.log('  ' + m.name.slice(0, 36).padEnd(38) +
      (m.density / 1000).toFixed(3).padStart(10) +
      m.costPerM2PerMm.toFixed(3).padStart(10) +
      ('£' + r.costPerKg.toFixed(2)).padStart(14));
  }
  console.log('');
}

function specFromArgs() {
  const spec = {};
  if (args.scenario) Object.assign(spec, SCENARIOS[args.scenario]?.spec || {});
  const map = {
    wall: 'wall', door: 'door', vent: 'ventPreset', floor: 'floorSystem',
    env: 'envId', source: 'sourceId', separating: 'separatingElementId',
    mounting: 'mounting', ceiling: 'ceiling',
  };
  for (const [k, v] of Object.entries(map)) if (args[k] && args[k] !== true) spec[v] = args[k];
  for (const k of ['L', 'W', 'H', 'level', 'distanceM', 'ventAirflowLps', 'occupants', 'fanSwl']) {
    if (args[k] !== undefined && args[k] !== true) spec[k] = Number(args[k]);
  }
  if (args.distance) spec.distanceM = Number(args.distance);
  if (args.weighting) spec.weighting = args.weighting;
  if (args.mode) spec.sourceMode = args.mode;
  return spec;
}

function printReport(r, title) {
  const t = r.totals;
  console.log('\n' + bold('═'.repeat(W)));
  console.log(bold(`  ISOLAB SIMULATION — ${title}`));
  console.log(bold('═'.repeat(W)));

  const g = r.geometry;
  console.log(`  ${dim('Booth')}        ${g.L} × ${g.W} × ${g.H} m internal  ` +
    `(${num(g.volume, 2)} m³, ${num(g.envelope, 1)} m² envelope)`);
  console.log(`  ${dim('Source')}       ${SOURCES[r.design.source.sourceId]?.name || 'custom'} at ${num(t.insideZ, 0)} dB SPL (${num(t.insideA, 0)} dB(A))`);
  console.log(`  ${dim('Receiver')}     ${r.verdict.environment}, ${r.design.receiver.distanceM} m`);
  if (r.intermediate) console.log(`  ${dim('Via')}          ${SEPARATING_ELEMENTS[r.design.receiver.separatingElementId].label}`);

  /* ---- headline chain ---- */
  console.log(head('RESULT'));
  const chain = [
    ['INSIDE', num(t.insideZ, 1) + ' dB SPL', num(t.insideA, 1) + ' dB(A)', mag],
    ['BOOTH ISOLATION', '− ' + num(t.isolationZ, 1) + ' dB', 'STC ' + r.ratings.stc + ' / Rw ' + r.ratings.rw + ' (C' + (r.ratings.c >= 0 ? '+' : '') + r.ratings.c + ', Ctr' + (r.ratings.ctr >= 0 ? '+' : '') + r.ratings.ctr + ')', cyan],
    ['OUTSIDE', num(t.outsideZ, 1) + ' dB SPL', num(t.outsideA, 1) + ' dB(A)', t.outsideA > 40 ? red : t.outsideA > 30 ? yellow : green],
  ];
  for (const [label, main, sub, col] of chain) {
    console.log(`  ${dim(label.padEnd(17))} ${col(bold(main.padEnd(16)))} ${dim(sub)}`);
    if (label !== 'OUTSIDE') console.log(dim('                        ↓'));
  }
  if (r.outside.fan) {
    console.log(`  ${dim('+ fan noise'.padEnd(17))} ${num(t.outsideWithFanA, 1)} dB(A) total`);
  }
  console.log(`  ${dim('Background'.padEnd(17))} ${num(t.backgroundA, 1)} dB(A)  →  perceived ${bold(num(t.perceivedA, 1) + ' dB(A)')}`);
  console.log(`  ${dim('Audible excess'.padEnd(17))} ${t.audibleExcessA > 0 ? yellow('+' + num(t.audibleExcessA, 1)) : green(num(t.audibleExcessA, 1))} dB over background`);
  console.log(`  ${dim('NR curve'.padEnd(17))} NR ${num(r.ratings.nr, 0)} (governed by ${r.ratings.nrGoverning} Hz)`);

  console.log(`\n  ${bold(r.verdict.audibility)}`);
  console.log(dim(`  ${r.verdict.description}`));

  /* ---- criteria ---- */
  console.log(head('AGAINST COMMON CRITERIA  (A-weighted receiver level)'));
  for (const cr of r.verdict.criteria) {
    const ok = cr.pass ? green('PASS') : red('FAIL');
    console.log(`  ${ok}  ${cr.label.padEnd(44)} ${dim('limit')} ${String(cr.limit).padStart(3)} dB(A)  ` +
      `${cr.marginDb >= 0 ? green('margin +' + num(cr.marginDb, 1)) : red('over by ' + num(-cr.marginDb, 1))}`);
  }

  /* ---- spectra ---- */
  console.log(head('FREQUENCY RESPONSE  (octave bands)'));
  console.log(spectrumPlot([
    { label: 'inside', values: r.inside.octaves, color: mag },
    { label: 'outside', values: r.outside.octaves, color: red },
    { label: 'background', values: r.outside.backgroundOctaves, color: dim },
  ], { rows: 16 }));

  console.log('\n  ' + 'Band'.padEnd(10) + OCTAVE.map((f) => String(f).padStart(7)).join(''));
  console.log('  ' + dim('─'.repeat(10 + 8 * 7)));
  const row = (label, vals, col = (s) => s) => console.log('  ' + label.padEnd(10).slice(0, 10) +
    vals.map((v) => col(num(v, 0).padStart(7))).join(''));
  row('inside', r.inside.octaves, mag);
  row('isolation', r.levelDifferenceOctaves, cyan);
  row('outside', r.outside.octaves, red);
  row('backgrnd', r.outside.backgroundOctaves, dim);
  row('comp. TL', r.compositeTLOctaves, green);

  /* ---- breakdown ---- */
  console.log(head('WHERE THE SOUND ESCAPES  (share of transmitted acoustic power, A-weighted)'));
  const maxPct = Math.max(...r.breakdown.byGroup.map((x) => x.percent));
  for (const gr of r.breakdown.byGroup) {
    if (gr.percent < 0.05) continue;
    const col = gr.percent > 40 ? red : gr.percent > 15 ? yellow : green;
    console.log(`  ${gr.group.padEnd(10)} ${col(num(gr.percent, 1).padStart(5) + '%')}  ${col(bar(gr.percent, maxPct))}`);
  }
  console.log('\n  ' + dim('Individual paths:'));
  for (const e of r.breakdown.byElement.slice(0, 10)) {
    if (e.percent < 0.05) continue;
    const col = e.percent > 40 ? red : e.percent > 15 ? yellow : dim;
    console.log(`  ${col(num(e.percent, 1).padStart(5) + '%')}  ${e.label.slice(0, 66)}`);
  }

  console.log('\n  ' + dim('Fixing one path perfectly would gain at most:'));
  for (const p of r.breakdown.potential.slice(0, 4)) {
    if (p.maxImprovementDb < 0.1) continue;
    console.log(`  ${green('−' + num(p.maxImprovementDb, 1) + ' dB').padStart(18)}  ${p.label.slice(0, 60)}`);
  }

  console.log('\n  ' + dim('Dominant path per band:'));
  const dom = r.breakdown.dominantByBand.filter((_, i) => i % 3 === 1);
  for (const d of dom) {
    console.log(`  ${String(d.band).padStart(6)} Hz  ${num(d.percent, 0).padStart(3)}%  ${dim(String(d.label).slice(0, 56))}`);
  }

  /* ---- diagnostics ---- */
  if (r.diagnostics.length) {
    console.log(head('DIAGNOSIS AND RECOMMENDATIONS'));
    for (const n of r.diagnostics.slice(0, 8)) {
      const col = severityColor(n.severity);
      console.log(`\n  ${col('[' + n.severity.toUpperCase() + ']')} ${bold(n.title)}`);
      console.log(wrap(n.detail, 6));
      for (const f of (n.fixes || []).slice(0, 4)) console.log(dim(wrap('→ ' + f, 6)));
    }
  }

  /* ---- internal acoustics ---- */
  console.log(head('INSIDE THE BOOTH'));
  const rt = r.absorption.rt;
  console.log(`  ${dim('RT60 (500 Hz)')}     ${num(rt[THIRD_OCTAVE.indexOf(500)], 2)} s`);
  console.log(`  ${dim('RT60 (125 Hz)')}     ${num(rt[THIRD_OCTAVE.indexOf(125)], 2)} s`);
  console.log(`  ${dim('Treated fraction')}  ${num(r.absorption.treatedFraction * 100, 0)}% of internal surface`);
  const firstMode = 343 / (2 * Math.min(r.geometry.L, r.geometry.W, r.geometry.H));
  console.log(`  ${dim('First axial mode')}  ${num(firstMode, 0)} Hz  ${dim('(no diffuse field below ~' + num(firstMode * 3, 0) + ' Hz)')}`);

  /* ---- ventilation ---- */
  if ((r.design.vents || []).length) {
    console.log(head('VENTILATION'));
    const air = requiredAirflowLps({ volumeM3: r.geometry.volume, occupants: r.design.occupants || 1 });
    const supplied = r.design.vents.reduce((a, v) => a + (v.airflowLps || 0) * (v.count || 1), 0);
    console.log(`  ${dim('Required airflow')}  ${num(air.required, 0)} L/s  ${dim('(governed by ' + air.governing + ')')}`);
    console.log(`  ${dim('Specified')}         ${num(supplied, 0)} L/s  ${supplied >= air.required ? green('OK') : red('INSUFFICIENT')}`);
    for (const v of r.design.vents) {
      const { il, velocity } = ductInsertionLoss(v);
      console.log(`\n  ${bold(v.label || 'Vent')}`);
      console.log(`    ${dim('velocity')} ${num(velocity, 2)} m/s`);
      console.log('    ' + dim('IL: ') + OCTAVE.map((f, i) => `${f}:${num(il[THIRD_OCTAVE.indexOf(f)], 0)}`).join('  '));
    }
  }

  /* ---- cost ---- */
  console.log(head('INDICATIVE COST'));
  for (const it of r.cost.items) {
    console.log(`  £${num(it.cost, 0).padStart(8)}   ${it.label}`);
  }
  console.log('  ' + dim('─'.repeat(40)));
  console.log(`  £${bold(num(r.cost.total, 0).padStart(8))}   ${bold('total')}  ${dim('(materials and components, ex-VAT, excludes labour)')}`);
  console.log('');
}

function wrap(text, indent = 0, width = W) {
  const pad = ' '.repeat(indent);
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width - indent) { lines.push(pad + line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(pad + line.trim());
  return lines.join('\n');
}

function cmdOptimise(spec) {
  const target = Number(args.target ?? 35);
  const budget = Number(args.budget ?? 2000);

  console.log(head(`OPTIMISER — target ≤ ${target} dB(A), budget £${budget}`));

  const sc = singleChangeOptions(spec);
  console.log(`  Baseline: ${bold(num(sc.baseLevel, 1) + ' dB(A)')} at £${num(sc.baseCost, 0)}\n`);
  console.log('  ' + bold('Best single changes from here') + dim('  (each applied on its own)'));
  console.log('  ' + 'Change'.padEnd(52) + 'Δ dB'.padStart(7) + 'Δ cost'.padStart(9) + 'dB/£100'.padStart(9));
  console.log('  ' + dim('─'.repeat(W - 4)));
  for (const o of sc.options.slice(0, 10)) {
    if (o.improvementDb < 0.05) continue;
    const v = isFinite(o.valuePer100) ? o.valuePer100.toFixed(2) : '∞';
    console.log('  ' + `${o.groupLabel}: ${o.label}`.slice(0, 50).padEnd(52) +
      green(('−' + num(o.improvementDb, 1)).padStart(7)) +
      ('£' + num(o.deltaCost, 0)).padStart(9) + v.padStart(9));
  }

  const res = optimise({
    baseSpec: spec, targetDbA: target, budget,
    groups: (args.groups && args.groups !== true ? String(args.groups).split(',') : ['wall', 'door', 'vent', 'floor', 'sealing']),
  });

  console.log(head('COST vs PERFORMANCE — Pareto front'));
  console.log(dim(`  ${res.candidateCount} combinations evaluated exhaustively.\n`));
  console.log('  ' + 'Cost'.padStart(9) + 'dB(A)'.padStart(8) + 'STC'.padStart(5) + '   ' + 'Limiting path');
  console.log('  ' + dim('─'.repeat(W - 4)));
  for (const p of res.pareto) {
    const flag = p.level <= target ? green('✓') : ' ';
    const aff = p.cost <= budget ? '' : dim(' (over budget)');
    console.log(`  ${flag} £${num(p.cost, 0).padStart(6)}${num(p.level, 1).padStart(8)}${String(p.stc).padStart(5)}   ` +
      dim(String(p.weakest?.label || '').slice(0, 44)) + aff);
  }

  console.log(head('MARGINAL VALUE — what each step up the front buys'));
  for (const m of res.marginal) {
    console.log(`  £${num(m.deltaCost, 0).padStart(6)} → ${green('−' + num(m.deltaDb, 1) + ' dB')}` +
      dim(`  (${num(m.dbPer100, 2)} dB per £100)`));
    for (const ch of m.changes) console.log(dim(wrap('· ' + ch, 6)));
  }

  console.log(head('VERDICT'));
  const vcol = res.verdict.status === 'achievable' ? green : res.verdict.status === 'over-budget' ? yellow : red;
  console.log(vcol(wrap(res.verdict.headline, 2)));
  console.log(dim(wrap(res.verdict.note, 2)));

  if (res.recommended) {
    console.log(head('RECOMMENDED BUILD'));
    console.log(`  ${bold('£' + num(res.recommended.cost, 0))} → ${bold(num(res.recommended.level, 1) + ' dB(A)')}  (STC ${res.recommended.stc})`);
    for (const ch of res.recommended.choices) {
      console.log(`  ${dim(ch.group.padEnd(9))} ${ch.label}`);
    }
  }
  console.log('');
}

function cmdCompare(idA, idB) {
  const base = specFromArgs();
  const specA = { ...base, wall: idA };
  const specB = { ...base, wall: idB };
  const cmp = compareDesigns(specA, specB, [idA, idB]);

  console.log(head(`COMPARISON — ${idA}  vs  ${idB}`));
  const rowc = (label, a, b, unit = '', d = 1) => {
    console.log('  ' + label.padEnd(26) + num(a, d).padStart(10) + num(b, d).padStart(12) +
      dim(('  ' + (b - a >= 0 ? '+' : '') + num(b - a, d) + ' ' + unit)));
  };
  console.log('  ' + ''.padEnd(26) + bold(idA.slice(0, 9).padStart(10)) + bold(idB.slice(0, 11).padStart(12)) + dim('   difference'));
  console.log('  ' + dim('─'.repeat(W - 4)));
  rowc('Outside dB(A)', cmp.a.totals.outsideWithFanA, cmp.b.totals.outsideWithFanA, 'dB');
  rowc('Outside dB (Z)', cmp.a.totals.outsideZ, cmp.b.totals.outsideZ, 'dB');
  rowc('Isolation dB(A)', cmp.a.totals.isolationA, cmp.b.totals.isolationA, 'dB');
  rowc('STC', cmp.a.ratings.stc, cmp.b.ratings.stc, '', 0);
  rowc('Rw', cmp.a.ratings.rw, cmp.b.ratings.rw, '', 0);
  rowc('Cost £', cmp.a.cost.total, cmp.b.cost.total, '£', 0);
  console.log(`\n  ${dim('Cost per dB gained')}  £${num(cmp.delta.costPerDb, 0)}`);

  console.log(head('Outside level by octave band'));
  console.log(spectrumPlot([
    { label: idA.slice(0, 12), values: cmp.a.outside.octaves, color: cyan },
    { label: idB.slice(0, 12), values: cmp.b.outside.octaves, color: green },
  ], { rows: 14 }));
  console.log('');
}

/* ---------------- dispatch ---------------- */

if (args.help || args.h || (argv.length === 0)) {
  console.log(`
${bold('IsoLab — acoustic isolation simulator')}

${bold('USAGE')}
  node cli/simulate.mjs [options]

${bold('MAIN')}
  --scenario <id>        run a complete preset scenario
  --wall <id>            wall assembly          --door <id>       door
  --vent <id>            ventilation            --floor <id>      floor isolation
  --env <id>             receiving environment  --separating <id> party wall
  --source <id>          sound source           --level <dB>      internal level
  --L --W --H <m>        internal dimensions    --distance <m>    receiver distance
  --mode <m>             'internal-spl' (default) or 'source-at-1m'
  --weighting <Z|A>      how --level is specified

${bold('ANALYSIS')}
  --optimise             run the design optimiser
     --target <dB(A)>    target receiver level (default 35)
     --budget <£>        budget (default 2000)
     --groups a,b,c      which upgrade groups to search
  --compare <a> <b>      compare two wall assemblies side by side
  --material <id>        full material report   --thickness <mm>
  --value                cost per kg/m² ranking of every mass material
  --validate             run the laboratory validation suite
  --list                 list every preset id
  --json                 emit raw JSON instead of a report

${bold('EXAMPLES')}
  node cli/simulate.mjs --scenario bedroom-diy
  node cli/simulate.mjs --wall booth-pro --door acoustic-45 --vent labyrinth --level 110
  node cli/simulate.mjs --scenario bedroom-good --optimise --target 30 --budget 2500
  node cli/simulate.mjs --material acoustic-foam --thickness 50
  node cli/simulate.mjs --compare booth-budget double-stud
`);
  process.exit(0);
}

if (args.list) { cmdList(); process.exit(0); }
if (args.validate) { console.log('\n' + formatValidation(runValidation())); process.exit(0); }
if (args.value) { cmdValueTable(); process.exit(0); }
if (args.material && args.material !== true) { cmdMaterial(String(args.material)); process.exit(0); }
if (args.compare) {
  const a = args.compare !== true ? String(args.compare) : positional[0];
  const b = positional[args.compare !== true ? 0 : 1];
  if (!a || !b) { console.error(red('--compare needs two wall ids')); process.exit(1); }
  cmdCompare(a, b);
  process.exit(0);
}

const spec = specFromArgs();
if (args.optimise || args.optimize) { cmdOptimise(spec); process.exit(0); }

const design = buildDesign(spec);
const result = simulate(design);

if (args.json) {
  const replacer = (k, v) => (k === 'material' || k === 'fill' || k === 'result' ? undefined : v);
  console.log(JSON.stringify(result, replacer, 2));
} else {
  printReport(result, args.scenario ? SCENARIOS[args.scenario].name : (design.name || 'custom design'));
}

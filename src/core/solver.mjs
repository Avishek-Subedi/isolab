/**
 * Top-level simulation.
 *
 * The whole engine reduces to one power balance. Inside the booth there is a
 * diffuse field of mean-square pressure <p^2>. Diffuse-field theory says the
 * power incident on unit area of the boundary is
 *
 *      I_inc = <p^2> / (4 rho c)
 *
 * Every element of the envelope (each wall, the door leaf, the door's
 * threshold gap, the vent bore, a cable hole, the flanking path through the
 * floor) transmits a fraction tau of that. Because they all radiate into the
 * same receiving space, their powers simply add:
 *
 *      W_out = I_inc * SUM_over_elements ( S_i * tau_i )
 *
 * Working in "effective transmitting area" A_eff = S*tau is what makes the
 * leakage breakdown honest: the percentages are real power fractions, not a
 * heuristic. It is also why a 0.01 m^2 door gap can outrank 30 m^2 of
 * excellent wall — the gap's tau is 10,000 times larger.
 *
 * The receiver level then follows from the room (or free-field) response, the
 * distance, and the existing background noise.
 */

import { AIR } from './constants.mjs';
import { THIRD_OCTAVE, THIRD_OCTAVE_EXACT, N_BANDS, toOctaves, attenToOctaves, A_WEIGHT } from './bands.mjs';
import {
  splToP2, p2ToSpl, wToSwl, tauToTL, tlToTau, dbSum, dbSumSpectra,
  overall, overallA, overallC, roomConstant, roomSPL, boxEnvelopeSPL, sabineRT, porousAlpha,
} from './acoustics.mjs';
import { partitionTL, partitionCost, diagnosePartition } from './partition.mjs';
import { doorEffectiveArea, doorArea, doorCost, doorPathBreakdown } from './door.mjs';
import { ductEffectiveArea, ductInsertionLoss, fanNoiseSWL, ductVelocity, requiredAirflowLps } from './duct.mjs';
import { gapTau, gapArea } from './leaks.mjs';
import { flankingEffectiveArea, MOUNTING_PRESETS, ISOLATORS, floorImpactImprovement, diagnoseIsolation } from './structure.mjs';
import { computeSTC, computeRw, computeNIC, computeNR, describeLevel, CRITERIA } from './ratings.mjs';
import { SOURCES, sourceSpectrum } from '../data/sources.mjs';
import { ENVIRONMENTS, SEPARATING_ELEMENTS, tlFromRw } from '../data/environments.mjs';
import { MATERIALS } from '../data/materials.mjs';

const SURFACE_KEYS = ['front', 'back', 'left', 'right', 'ceiling', 'floor'];

/**
 * Maximum per-band level difference achievable between a source inside the
 * booth and a receiver elsewhere in the same building.
 *
 * Without this cap, chaining a good booth in series with a heavy party wall
 * predicts level differences of 90 dB or more and receiver levels below the
 * threshold of hearing. That never happens in a real building: long before
 * the airborne paths get that good, vibration runs through the floor slab,
 * the frame and the surrounding construction and sets a floor on what arrives.
 * Field measurements of even the best room-in-room constructions top out
 * around 70-80 dB of level difference.
 *
 * Applied only to receivers inside the same structure. An outdoor receiver has
 * no shared structural path, so distance attenuation governs instead.
 */
export const STRUCTURAL_FLANKING_CEILING_DB = 75;

/**
 * @typedef {Object} Design
 * @property {string} [name]
 * @property {{internalL:number, internalW:number, internalH:number}} geometry  metres
 * @property {Record<string, import('./partition.mjs').Partition>} surfaces
 * @property {import('./door.mjs').Door[]} [doors]
 * @property {{id:string,label:string,widthM:number,heightM:number,partition:object,host:string}[]} [windows]
 * @property {import('./duct.mjs').DuctSpec[]} [vents]
 * @property {import('./leaks.mjs').Gap[]} [gaps]
 * @property {{mountingId:string, deck?:object}} [mounting]
 * @property {{materialId:string, thicknessMm:number, coverage:number}} [internalTreatment]
 * @property {{sourceId:string, level:number, weighting:'Z'|'A', mode:'internal-spl'|'source-at-1m', customSpectrum?:number[]}} source
 * @property {{envId:string, distanceM:number, separatingElementId?:string, directivity?:number}} receiver
 * @property {{offsets?:number[], leakCoherenceFactor?:number, globalOffsetDb?:number}} [calibration]
 */

/** Internal geometry: surface areas, volume, envelope area. */
export function geometry(d) {
  const { internalL: L, internalW: W, internalH: H } = d.geometry;
  const areas = {
    front: W * H, back: W * H,
    left: L * H, right: L * H,
    ceiling: L * W, floor: L * W,
  };
  const volume = L * W * H;
  const envelope = Object.values(areas).reduce((a, b) => a + b, 0);
  return { areas, volume, envelope, L, W, H, footprint: L * W };
}

/** Internal absorption of the booth, 24-band, from the treatment spec. */
export function internalAbsorption(d) {
  const g = geometry(d);
  const t = d.internalTreatment;
  // Bare booth: hard boards, plus occupant and floor.
  const bare = [0.10, 0.10, 0.09, 0.08, 0.07, 0.06, 0.06, 0.05, 0.05, 0.05, 0.05, 0.05,
    0.05, 0.05, 0.06, 0.06, 0.06, 0.07, 0.07, 0.07, 0.08, 0.08, 0.09, 0.10];
  let alpha = bare.slice();
  let treatedFraction = 0;
  if (t && t.materialId && t.coverage > 0) {
    const m = MATERIALS[t.materialId];
    if (m && m.flowResistivity) {
      const a = porousAlpha(m.flowResistivity, t.thicknessMm, t.airGapMm || 0);
      treatedFraction = Math.min(1, t.coverage / 100);
      alpha = bare.map((b, i) => b * (1 - treatedFraction) + a[i] * treatedFraction);
    }
  }
  const A = alpha.map((a) => a * g.envelope + 0.4); // +0.4 m^2 for an occupant
  const rt = A.map((a) => sabineRT(g.volume, a));
  return { alpha, A, rt, treatedFraction };
}

/**
 * Internal SPL spectrum.
 *  - 'internal-spl'  : the user states the level measured inside. Used directly.
 *  - 'source-at-1m'  : the user states the source's free-field level at 1 m.
 *                      The booth's reverberant build-up is then added, which in
 *                      a small hard booth is worth 6-12 dB and is the reason a
 *                      100 dB scream measures 108 dB inside a tiled 1 m^3 box.
 */
export function internalSPL(d) {
  const src = d.source;
  const base = src.customSpectrum
    ? src.customSpectrum.slice()
    : sourceSpectrum(SOURCES[src.sourceId] || SOURCES.scream, src.level, src.weighting || 'Z', A_WEIGHT);

  if ((src.mode || 'internal-spl') === 'internal-spl') {
    return { spectrum: base, buildUpDb: new Array(N_BANDS).fill(0), swl: null };
  }

  const g = geometry(d);
  const { A } = internalAbsorption(d);
  // Free-field SPL at 1 m -> sound power (spherical radiation)
  const swl = base.map((v) => v + 10 * Math.log10(4 * Math.PI * 1 * 1));
  const r = Math.min(1, Math.max(0.4, Math.cbrt(g.volume) / 3));
  const spectrum = swl.map((w, i) => {
    const R = roomConstant(g.envelope, A[i] / g.envelope);
    return roomSPL(w, r, 2, R);
  });
  const buildUpDb = spectrum.map((v, i) => v - base[i]);
  return { spectrum, buildUpDb, swl };
}

/**
 * Assemble every transmitting element into a flat list of
 * { id, label, group, area, eff[] } where eff = S * tau per band.
 */
export function assembleElements(d, opts = {}) {
  const g = geometry(d);
  const elements = [];
  const detail = {};

  // --- openings subtracted from their host surface ---
  const openingArea = {};
  for (const dr of d.doors || []) {
    openingArea[dr.host || 'front'] = (openingArea[dr.host || 'front'] || 0) + doorArea(dr);
  }
  for (const w of d.windows || []) {
    openingArea[w.host || 'front'] = (openingArea[w.host || 'front'] || 0) + w.widthM * w.heightM;
  }

  // --- 1. Solid surfaces ---
  for (const key of SURFACE_KEYS) {
    const part = d.surfaces[key];
    if (!part) continue;
    const gross = g.areas[key];
    const net = Math.max(0.05, gross - (openingArea[key] || 0));
    const res = partitionTL({ ...part, areaM2: net }, opts);
    detail[key] = res;
    elements.push({
      id: `surface-${key}`, group: 'wall', surface: key,
      label: `${key.charAt(0).toUpperCase() + key.slice(1)} — ${part.label || 'assembly'}`,
      area: net,
      eff: res.tl.map((tl) => net * tlToTau(tl)),
      tl: res.tl,
    });
  }

  // --- 2. Doors (leaf + every gap sub-path, kept separate) ---
  (d.doors || []).forEach((dr, i) => {
    const r = doorEffectiveArea(dr, opts);
    detail[`door${i}`] = r;
    const series = r.paths.find((p) => p.isSeries);
    if (series) {
      elements.push({
        id: `door${i}`, group: 'door', surface: dr.host || 'front',
        label: `${dr.label || 'Door'} (two-door air lock)`,
        area: doorArea(dr), eff: series.eff.slice(), tl: series.eff.map((e) => tauToTL(e / doorArea(dr))),
      });
    } else {
      for (const p of r.paths) {
        elements.push({
          id: `door${i}-${p.id}`, group: p.id === 'leaf' || p.id === 'vision' ? 'door' : 'door-leak',
          surface: dr.host || 'front',
          label: `${dr.label || 'Door'}: ${p.label}`,
          area: p.area, eff: p.eff.slice(),
        });
      }
    }
  });

  // --- 3. Windows ---
  (d.windows || []).forEach((w, i) => {
    const A = w.widthM * w.heightM;
    const res = partitionTL({ ...w.partition, areaM2: A }, opts);
    detail[`window${i}`] = res;
    elements.push({
      id: `window${i}`, group: 'window', surface: w.host || 'front',
      label: `${w.label || 'Window'} — ${w.partition.label || 'glazing'}`,
      area: A, eff: res.tl.map((tl) => A * tlToTau(tl)), tl: res.tl,
    });
    // Frame perimeter gap
    const fg = {
      shape: 'slit', widthMm: w.frameGapMm ?? 0.2,
      lengthMm: 2 * (w.widthM + w.heightM) * 1000, depthMm: 100,
      sealResistivity: w.frameSealed === false ? undefined : 200000,
      sealFillFraction: w.frameSealed === false ? undefined : 1,
    };
    elements.push({
      id: `window${i}-frame`, group: 'leak', surface: w.host || 'front',
      label: `${w.label || 'Window'}: frame perimeter gap`,
      area: gapArea(fg), eff: gapTau(fg, opts).map((t) => t * gapArea(fg)),
    });
  });

  // --- 4. Ventilation ---
  (d.vents || []).forEach((v, i) => {
    const r = ductEffectiveArea(v, opts);
    detail[`vent${i}`] = r;
    for (const p of r.paths) {
      elements.push({
        id: `vent${i}-${p.id}`, group: 'vent', surface: v.host || 'ceiling',
        label: `${v.label || 'Vent'}: ${p.label.replace(/^.*?— /, '')}`,
        area: p.area || 0, eff: p.eff.slice(),
      });
    }
  });

  // --- 5. Discrete gaps and penetrations ---
  (d.gaps || []).forEach((gp, i) => {
    const A = gapArea(gp);
    elements.push({
      id: `gap${i}`, group: 'leak', surface: gp.host || 'front',
      label: gp.label || `Gap ${i + 1}`,
      area: A, eff: gapTau(gp, opts).map((t) => t * A),
    });
  });

  // --- 6. Structure-borne flanking ---
  const mount = MOUNTING_PRESETS[d.mounting?.mountingId || 'direct-on-timber'];
  const flank = flankingEffectiveArea({
    id: 'flanking', label: `Structure-borne flanking — ${mount.label}`,
    junctionAreaM2: g.footprint,
    isolator: d.mounting?.isolatorOverride ? ISOLATORS[d.mounting.isolatorOverride] : mount.isolator,
    vibrationReductionIndexDb: mount.vibrationReductionIndexDb,
  }, opts);
  detail.flanking = flank;
  elements.push({
    id: 'flanking', group: 'flanking', surface: 'floor',
    label: flank.label, area: flank.area, eff: flank.eff.slice(),
  });

  return { elements, detail, geometry: g, mount };
}

/**
 * Run the full simulation.
 * @param {Design} d
 * @returns {object} results
 */
export function simulate(d, options = {}) {
  const cal = d.calibration || {};
  const opts = { air: options.air || AIR, leakCoherenceFactor: cal.leakCoherenceFactor ?? 0.5 };

  const g = geometry(d);
  const abs = internalAbsorption(d);
  const inside = internalSPL(d);
  const Lin = inside.spectrum;

  const { elements, detail, mount } = assembleElements(d, opts);

  // ---- power balance ----
  const rho = opts.air.rho, c = opts.air.c;
  const Wt = new Array(N_BANDS).fill(0);
  for (let i = 0; i < N_BANDS; i++) {
    const Iinc = splToP2(Lin[i]) / (4 * rho * c);
    let sumEff = 0;
    for (const e of elements) sumEff += Math.max(e.eff[i], 0);
    Wt[i] = Iinc * sumEff;
  }

  // Total envelope area for the composite-TL figure
  const envArea = elements.filter((e) => e.group !== 'flanking')
    .reduce((a, e) => a + (e.area || 0), 0) || g.envelope;
  const sumEffPerBand = THIRD_OCTAVE_EXACT.map((_, i) =>
    elements.reduce((a, e) => a + Math.max(e.eff[i], 0), 0));
  const compositeTL = sumEffPerBand.map((s) => tauToTL(s / envArea));

  let swlOut = Wt.map((w) => wToSwl(w));

  // ---- fan noise added into the receiving space ----
  const fanContributions = [];
  for (const v of d.vents || []) {
    const f = fanNoiseSWL(v, opts);
    if (f) { fanContributions.push(f); }
  }

  // ---- receiver ----
  const env = ENVIRONMENTS[d.receiver.envId] || ENVIRONMENTS['bedroom-rented'];
  const dist = d.receiver.distanceM ?? env.defaultDistanceM;
  const Q = d.receiver.directivity ?? env.directivity ?? 2;

  /** @param {number[]} swl */
  const toReceiver = (swl) => {
    if (env.receiverType === 'freefield') {
      return swl.map((w) => boxEnvelopeSPL(w, { l: g.L, w: g.W, h: g.H }, dist));
    }
    const S = env.surfaceAreaM2 || 60;
    return swl.map((w, i) => {
      const R = roomConstant(S, env.alphaBar || 0.15);
      return roomSPL(w, Math.max(dist, 0.3), Q, R);
    });
  };

  let Lout = toReceiver(swlOut);
  const fanAtReceiver = fanContributions.length
    ? dbSumSpectra(fanContributions.map((f) => toReceiver(f)))
    : null;

  // ---- optional separating building element (neighbour scenarios) ----
  const sep = SEPARATING_ELEMENTS[d.receiver.separatingElementId || 'none'];
  let intermediate = null;
  if (sep && sep.rw > 0) {
    intermediate = { level: Lout.slice(), label: 'Level in the room containing the booth' };
    const sepTL = sep.tl || tlFromRw(sep.rw);
    const Ssep = 12; // nominal party-wall area, m^2
    const A2 = (env.surfaceAreaM2 || 70) * (env.alphaBar || 0.15);
    Lout = Lout.map((l, i) => l - sepTL[i] + 10 * Math.log10(Ssep / Math.max(A2, 1)));
  }

  // ---- structural flanking ceiling ----
  // Nothing inside a building can be quieter than what the structure carries.
  let flankingCeilingApplied = false;
  if (env.receiverType === 'room') {
    const ceiling = options.flankingCeilingDb ?? STRUCTURAL_FLANKING_CEILING_DB;
    Lout = Lout.map((v, i) => {
      const floorLevel = Lin[i] - ceiling;
      if (floorLevel > v) { flankingCeilingApplied = true; return floorLevel; }
      return v;
    });
  }

  // ---- calibration ----
  if (cal.offsets) Lout = Lout.map((v, i) => v + (cal.offsets[i] || 0));
  if (cal.globalOffsetDb) Lout = Lout.map((v) => v + cal.globalOffsetDb);

  // ---- combine with fan noise and background ----
  const LoutSourceOnly = Lout.slice();
  if (fanAtReceiver) Lout = dbSumSpectra([Lout, fanAtReceiver]);
  const background = env.background;
  const LoutWithBackground = dbSumSpectra([Lout, background]);

  // ---- level difference / isolation ----
  const levelDifference = Lin.map((v, i) => v - LoutSourceOnly[i]);

  // ---- ratings ----
  const stc = computeSTC(compositeTL);
  const rw = computeRw(compositeTL);
  const nic = computeNIC(levelDifference);
  const octOut = toOctaves(Lout);
  const nr = computeNR(octOut);

  // ---- breakdown ----
  const breakdown = buildBreakdown(elements, Lin, envArea);

  // ---- diagnostics ----
  const diagnostics = buildDiagnostics(d, {
    detail, elements, breakdown, abs, g, inside, compositeTL, mount, opts, flankingCeilingApplied,
  });

  const totals = {
    insideZ: overall(Lin), insideA: overallA(Lin), insideC: overallC(Lin),
    outsideZ: overall(LoutSourceOnly), outsideA: overallA(LoutSourceOnly), outsideC: overallC(LoutSourceOnly),
    outsideWithFanA: overallA(Lout),
    perceivedA: overallA(LoutWithBackground),
    backgroundA: overallA(background),
    isolationZ: overall(Lin) - overall(LoutSourceOnly),
    isolationA: overallA(Lin) - overallA(LoutSourceOnly),
    audibleExcessA: overallA(Lout) - overallA(background),
  };

  return {
    design: d,
    geometry: g,
    absorption: abs,
    inside: { spectrum: Lin, octaves: toOctaves(Lin), buildUp: inside.buildUpDb, swl: inside.swl },
    outside: {
      spectrum: LoutSourceOnly, octaves: toOctaves(LoutSourceOnly),
      withFan: Lout, withFanOctaves: toOctaves(Lout),
      withBackground: LoutWithBackground, withBackgroundOctaves: toOctaves(LoutWithBackground),
      background, backgroundOctaves: toOctaves(background),
      fan: fanAtReceiver,
    },
    intermediate,
    swlOut,
    compositeTL, compositeTLOctaves: attenToOctaves(compositeTL),
    levelDifference, levelDifferenceOctaves: attenToOctaves(levelDifference),
    ratings: { stc: stc.stc, stcDetail: stc, ...rw, nic, nr: nr.nr, nrGoverning: nr.governingBand },
    flankingCeilingApplied,
    totals,
    verdict: buildVerdict(totals, background, env),
    breakdown,
    elements,
    detail,
    diagnostics,
    cost: estimateCost(d),
    bands: THIRD_OCTAVE,
  };
}

/**
 * Power-share breakdown. Percentages are genuine fractions of the transmitted
 * power, aggregated by group and by individual element, both broadband
 * (A-weighted, because that is what audibility follows) and per band.
 */
function buildBreakdown(elements, Lin, envArea) {
  // A-weighted transmitted power share
  const weight = THIRD_OCTAVE_EXACT.map((_, i) => Math.pow(10, (Lin[i] + A_WEIGHT[i]) / 10));
  const scored = elements.map((e) => {
    let s = 0;
    for (let i = 0; i < N_BANDS; i++) s += Math.max(e.eff[i], 0) * weight[i];
    return { ...e, power: s };
  });
  const tot = scored.reduce((a, b) => a + b.power, 0) || 1e-30;

  const byElement = scored
    .map((e) => ({
      id: e.id, label: e.label, group: e.group, surface: e.surface,
      area: e.area, percent: (100 * e.power) / tot,
      // The level this path alone would produce at the receiver, relative to total
      soloDeltaDb: 10 * Math.log10(Math.max(e.power / tot, 1e-12)),
    }))
    .sort((a, b) => b.percent - a.percent);

  /** @type {Record<string, {group:string, percent:number, items:string[]}>} */
  const groups = {};
  for (const e of byElement) {
    const key = e.group === 'door-leak' ? 'door' : e.group;
    (groups[key] ||= { group: key, percent: 0, items: [] });
    groups[key].percent += e.percent;
    groups[key].items.push(e.label);
  }
  const byGroup = Object.values(groups).sort((a, b) => b.percent - a.percent);

  // Per-band dominant path
  const dominantByBand = THIRD_OCTAVE_EXACT.map((_, i) => {
    let best = null, bv = -1;
    for (const e of elements) {
      if (e.eff[i] > bv) { bv = e.eff[i]; best = e; }
    }
    const total = elements.reduce((a, e) => a + Math.max(e.eff[i], 0), 0) || 1e-30;
    return { band: THIRD_OCTAVE[i], id: best?.id, label: best?.label, percent: (100 * bv) / total };
  });

  // "If you fixed this path perfectly, how much would the total drop?"
  const potential = byElement.map((e) => {
    const remaining = 1 - e.percent / 100;
    return {
      id: e.id, label: e.label,
      maxImprovementDb: remaining > 1e-9 ? -10 * Math.log10(remaining) : 40,
    };
  }).sort((a, b) => b.maxImprovementDb - a.maxImprovementDb);

  return { byElement, byGroup, dominantByBand, potential, weakest: byElement[0] || null };
}

function buildVerdict(totals, background, env) {
  const out = totals.outsideWithFanA;
  const excess = totals.audibleExcessA;
  const criteria = CRITERIA.map((c) => ({ ...c, pass: out <= c.limit, marginDb: c.limit - out }));
  let audibility;
  if (excess <= -5) audibility = 'Inaudible — comfortably below the existing background noise.';
  else if (excess <= 0) audibility = 'At or just below the background. Effectively inaudible in normal conditions.';
  else if (excess <= 3) audibility = 'Marginally audible. Detectable in a quiet moment if someone is listening for it.';
  else if (excess <= 8) audibility = 'Clearly audible but not usually intrusive.';
  else if (excess <= 15) audibility = 'Clearly audible and likely to be intrusive at night.';
  else audibility = 'Obtrusive. Expect complaints.';
  return {
    outsideA: out,
    description: describeLevel(out),
    audibility,
    excessOverBackgroundDb: excess,
    criteria,
    environment: env.name,
  };
}

/** Indicative build cost. */
export function estimateCost(d) {
  const g = geometry(d);
  let total = 0;
  const items = [];
  for (const key of SURFACE_KEYS) {
    const p = d.surfaces[key];
    if (!p) continue;
    const c = partitionCost(p) * g.areas[key];
    items.push({ label: `${key} (${g.areas[key].toFixed(1)} m²)`, cost: c });
    total += c;
  }
  for (const dr of d.doors || []) {
    const c = doorCost(dr);
    items.push({ label: dr.label || 'Door', cost: c });
    total += c;
  }
  for (const v of d.vents || []) {
    const len = v.segments.reduce((a, s) => a + (s.lengthM ?? 0), 0);
    const sil = v.segments.filter((s) => s.kind === 'silencer').length;
    const bends = v.segments.filter((s) => s.kind === 'bend').length;
    const dia = (v.diameterMm || 125) / 100;
    const c = (18 * dia * len + 14 * dia * bends + 70 * dia * sil + 60) * (v.count || 1);
    items.push({ label: v.label || 'Ventilation', cost: c });
    total += c;
  }
  const mount = MOUNTING_PRESETS[d.mounting?.mountingId || 'direct-on-timber'];
  const mc = (mount.isolator.costPerM2 || 0) * g.footprint;
  if (mc > 0) { items.push({ label: `Floor isolation (${mount.label})`, cost: mc }); total += mc; }
  if (d.internalTreatment?.materialId && d.internalTreatment.coverage > 0) {
    const m = MATERIALS[d.internalTreatment.materialId];
    if (m) {
      const c = (m.costPerM2PerMm || 0) * d.internalTreatment.thicknessMm * g.envelope * (d.internalTreatment.coverage / 100);
      items.push({ label: 'Internal acoustic treatment', cost: c });
      total += c;
    }
  }
  return { total, items, currency: 'GBP' };
}

/* ------------------------------------------------------------------ *
 * Diagnostics: the "why is my booth bad and what do I do" engine
 * ------------------------------------------------------------------ */

function buildDiagnostics(d, ctx) {
  const notes = [];
  const { detail, breakdown, abs, g, inside, compositeTL, mount, opts } = ctx;

  // 0. Structural flanking ceiling
  if (ctx.flankingCeilingApplied) {
    notes.push({
      severity: 'high',
      category: 'flanking',
      title: `Prediction is limited by structural flanking, not by your design`,
      detail: `In at least one band the airborne paths are now so good that the answer is set by vibration travelling through the building structure instead — the shared floor, the frame and the surrounding construction. The result has been capped at a ${STRUCTURAL_FLANKING_CEILING_DB} dB level difference, which is about the best that field measurements of even room-in-room constructions achieve. Spending more on mass or sealing will not move this number; only breaking the structural connection will.`,
      fixes: [
        'Isolate the booth from the building on a resilient raft with a mount resonance below 10 Hz',
        'Ensure nothing rigid bridges the raft — a single fixing into the joists undoes it',
        'Accept this as the practical floor for the building you are in',
      ],
    });
  }

  // 1. Dominant path
  const w = breakdown.weakest;
  if (w && w.percent > 25) {
    notes.push({
      severity: w.percent > 60 ? 'critical' : 'high',
      category: 'weakest-path',
      title: `${w.label} carries ${w.percent.toFixed(0)}% of the escaping sound`,
      detail: `This single path dominates. Fixing it perfectly would reduce the outside level by up to ${breakdown.potential.find((p) => p.id === w.id)?.maxImprovementDb.toFixed(1)} dB. Improving anything else first is wasted money — the total is set by the loudest leak, not the average of the paths.`,
      fixes: fixesFor(w),
    });
  }

  // 2. Partition-level physics
  for (const key of SURFACE_KEYS) {
    const res = detail[key];
    if (!res) continue;
    for (const n of diagnosePartition(res)) {
      if (n.severity === 'low') continue;
      notes.push({
        severity: n.severity === 'high' ? 'high' : 'medium',
        category: 'resonance', surface: key,
        title: `${key}: ${n.title}`, detail: n.detail, fixes: n.fixes,
      });
    }
  }

  // 3. Isolation system
  const isoNotes = diagnoseIsolation(mount.isolator, inside.spectrum);
  for (const n of isoNotes) {
    notes.push({ severity: n.severity, category: 'vibration', title: n.title, detail: n.detail, fixes: n.fixes });
  }

  // 4. Ventilation adequacy
  const air = requiredAirflowLps({ volumeM3: g.volume, occupants: d.occupants || 1 });
  const supplied = (d.vents || []).reduce((a, v) => a + (v.airflowLps || 0) * (v.count || 1), 0);
  if (supplied < air.required * 0.95) {
    notes.push({
      severity: supplied < air.required * 0.5 ? 'critical' : 'high',
      category: 'ventilation',
      title: `Ventilation is below the required ${air.required.toFixed(0)} L/s`,
      detail: `A ${g.volume.toFixed(1)} m³ booth with ${d.occupants || 1} occupant needs about ${air.required.toFixed(0)} L/s (governed by ${air.governing}). You have specified ${supplied.toFixed(0)} L/s. This is a safety issue before it is an acoustic one: a sealed 2 m³ booth reaches uncomfortable CO2 in about 15 minutes and 3% CO2 in under an hour.`,
      fixes: ['Add a supply and an extract duct, not just one', `Size each duct for at least ${(air.required / 2).toFixed(0)} L/s at under 2.5 m/s`, 'Use a lined labyrinth or packaged attenuator so the vent does not become the weakest path'],
    });
  }
  for (const v of d.vents || []) {
    const { warnings } = ductInsertionLoss(v, opts);
    for (const wr of warnings) {
      notes.push({ severity: 'medium', category: 'ventilation', title: `${v.label || 'Vent'}: check`, detail: wr, fixes: [] });
    }
  }

  // 5. Internal reverberation
  const rtMid = (abs.rt[THIRD_OCTAVE.indexOf(500)] + abs.rt[THIRD_OCTAVE.indexOf(1000)]) / 2;
  if (rtMid > 0.4) {
    notes.push({
      severity: 'medium', category: 'internal',
      title: `Internal reverberation time is ${rtMid.toFixed(2)} s`,
      detail: `An untreated booth this size sounds boxy and, more importantly, builds up ${Math.max(...inside.buildUpDb).toFixed(0)} dB of extra internal level for the same source. Adding absorption inside reduces both the recorded room tone and, slightly, the level pressing on the walls.`,
      fixes: ['Line at least 60% of the internal surface with 50-100 mm porous absorber', 'Treat the corners first — that is where low-frequency energy concentrates'],
    });
  }
  const smallest = Math.min(g.L, g.W, g.H);
  const firstMode = 343 / (2 * smallest);
  if (g.volume < 8) {
    notes.push({
      severity: 'medium', category: 'internal',
      title: `Small-room modal problems below ${firstMode.toFixed(0)} Hz`,
      detail: `The smallest internal dimension is ${smallest.toFixed(2)} m, so the lowest axial mode is at ${firstMode.toFixed(0)} Hz and there is no diffuse field below roughly ${(firstMode * 3).toFixed(0)} Hz. Predictions below that frequency carry much larger uncertainty, and the measured internal level will vary by 10 dB or more depending on exactly where the microphone sits.`,
      fixes: ['Avoid cube-like proportions and equal dimensions', 'Add porous bass absorption in the corners', 'Treat sub-100 Hz predictions as indicative only'],
    });
  }

  // 6. Airtightness sanity check
  const leakEff = ctx.elements.filter((e) => e.group === 'leak' || e.group === 'door-leak');
  const leakShare = breakdown.byElement
    .filter((e) => e.group === 'leak' || e.group === 'door-leak')
    .reduce((a, b) => a + b.percent, 0);
  if (leakShare > 30) {
    notes.push({
      severity: leakShare > 60 ? 'critical' : 'high',
      category: 'airtightness',
      title: `${leakShare.toFixed(0)}% of the escaping sound is going through gaps, not through materials`,
      detail: `Air leaks are transmitting more than the walls. This is the most common reason a carefully specified booth measures 15 dB worse than predicted. Sealing costs almost nothing compared to adding mass, and there is no point adding a further layer of board while this is true.`,
      fixes: ['Seal every junction with a non-hardening acoustic sealant, not decorator\'s caulk', 'Fit compression gaskets and an automatic drop seal to the door', 'Pack and seal every cable and duct penetration', 'Do a light test: switch off the lights inside, have someone shine a torch around the outside, and seal wherever light gets through'],
    });
  }
  if (leakShare < 5 && (d.gaps || []).length === 0) {
    notes.push({
      severity: 'info', category: 'airtightness',
      title: 'No air leaks have been specified',
      detail: 'The model currently assumes an essentially airtight envelope apart from the door and vent. Real construction always leaks somewhere. Add the gaps you expect to actually have — 1-2 mm at the wall/floor junction and an unsealed socket box are typical — or treat this prediction as a best case that construction quality will not reach.',
      fixes: ['Add a wall/floor junction gap to see the sensitivity', 'Budget 3-5 dB of the prediction as construction tolerance'],
    });
  }

  // 7. Low-frequency reality check
  const lf = compositeTL.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  const hf = compositeTL.slice(13, 20).reduce((a, b) => a + b, 0) / 7;
  if (hf - lf > 25) {
    notes.push({
      severity: 'medium', category: 'spectrum',
      title: `Performance is very unbalanced: ${lf.toFixed(0)} dB at low frequency vs ${hf.toFixed(0)} dB at high frequency`,
      detail: `Mass law gives 6 dB per octave for free, so every booth is worst in the bass. What escapes will therefore be a muffled thump rather than an intelligible voice. If your source has real low-frequency content (drums, a subwoofer, a male voice) the single-number rating flatters the design badly — look at the 63-125 Hz bands instead.`,
      fixes: ['Increase cavity depth, which is the only cheap way to help below 125 Hz', 'Add mass to both leaves rather than one', 'Check the mass-air-mass resonance is below 60 Hz'],
    });
  }

  const order = { critical: 0, high: 1, medium: 2, info: 3 };
  return notes.sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
}

function fixesFor(el) {
  switch (el.group) {
    case 'door': return ['Upgrade to a heavier leaf, or add a second door to form an air lock', 'Two ordinary good doors in series beat one expensive door and usually cost less'];
    case 'door-leak': return ['Fit a compression gasket in an adjustable rebate', 'Fit an automatic drop seal at the threshold', 'Seal the frame-to-wall junction with acoustic sealant before architraves go on'];
    case 'leak': return ['Seal with a non-hardening acoustic sealant', 'Pack penetrations with mineral wool and then seal both faces'];
    case 'vent': return ['Add lined 90° bends to form a labyrinth', 'Fit a packaged attenuator', 'Increase the duct diameter so you can afford more lining without exceeding 2.5 m/s'];
    case 'flanking': return ['Isolate the booth from the structure on a resilient raft', 'Lower the mount resonance below 12 Hz', 'Break any rigid connection — one screw into a joist undoes the whole raft'];
    case 'window': return ['Use two panes of different thickness with a wide air gap', 'Use acoustic laminated glass rather than monolithic', 'Line the reveal between the panes with absorber'];
    default: return ['Add mass to the leaf', 'Increase the cavity depth', 'Decouple the leaves with clips or a separate frame'];
  }
}

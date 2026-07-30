/**
 * Door assembly model.
 *
 * A door is a small partition with a very bad perimeter. Its transmission is
 * the parallel sum of:
 *   1. the leaf itself (mass law / coincidence, from panel.mjs)
 *   2. the perimeter gap (Zwikker-Kosten slit, from leaks.mjs)
 *   3. the threshold gap / undercut
 *   4. the frame-to-wall junction gap
 *   5. any glazed vision panel
 *
 * In practice (2)-(4) dominate: a 44 mm solid-core leaf is capable of ~30 dB
 * but an unsealed one delivers ~20 dB. Two doors in series with an air lock
 * between them are the only reliable route past ~45 dB.
 */

import { N_BANDS, THIRD_OCTAVE_EXACT } from './bands.mjs';
import { singleLeafTL, surfaceMass, massLawTL } from './panel.mjs';
import { gapTau, gapArea } from './leaks.mjs';
import { tlToTau, tauToTL } from './acoustics.mjs';
import { partitionTL, CONNECTIONS } from './partition.mjs';

/**
 * Practical ceiling on a two-door air lock. Two good doors in series predict
 * far more than this on paper, but the lobby's own walls, its floor and the
 * frames flank around them. Field measurements of twin-door air locks land at
 * 55-62 dB, so the series result is capped here.
 */
export const AIRLOCK_MAX_TL_DB = 62;

/**
 * @typedef {Object} SealSpec
 * @property {string} id
 * @property {string} label
 * @property {number} effectiveGapMm  residual gap width after compression
 * @property {number} [resistivity]   Pa*s/m^2 of the seal material in the gap
 * @property {number} [fillFraction]
 * @property {number} costPerDoor
 */

/** Perimeter seal options, worst to best. */
export const PERIMETER_SEALS = {
  none: { id: 'none', label: 'No seal (bare rebate)', effectiveGapMm: 3.0, costPerDoor: 0 },
  'foam-tape': { id: 'foam-tape', label: 'Self-adhesive foam tape', effectiveGapMm: 0.8, resistivity: 5000, fillFraction: 0.3, costPerDoor: 12 },
  brush: { id: 'brush', label: 'Brush / pile seal', effectiveGapMm: 1.0, resistivity: 3000, fillFraction: 0.4, costPerDoor: 18 },
  'rubber-bulb': { id: 'rubber-bulb', label: 'Rubber bulb / P-strip', effectiveGapMm: 0.5, resistivity: 15000, fillFraction: 0.5, costPerDoor: 35 },
  compression: { id: 'compression', label: 'Compression gasket in rebate (adjustable)', effectiveGapMm: 0.25, resistivity: 25000, fillFraction: 0.6, costPerDoor: 85 },
  'double-compression': { id: 'double-compression', label: 'Twin compression gaskets, magnetic', effectiveGapMm: 0.1, resistivity: 40000, fillFraction: 0.8, costPerDoor: 180 },
};

/** Threshold (bottom edge) options. */
export const THRESHOLD_SEALS = {
  undercut: { id: 'undercut', label: 'Undercut, no seal (10 mm)', effectiveGapMm: 10, costPerDoor: 0 },
  'brush-strip': { id: 'brush-strip', label: 'Surface brush strip', effectiveGapMm: 1.2, resistivity: 3000, fillFraction: 0.4, costPerDoor: 15 },
  'rubber-blade': { id: 'rubber-blade', label: 'Rubber blade on threshold plate', effectiveGapMm: 0.6, resistivity: 15000, fillFraction: 0.5, costPerDoor: 45 },
  'drop-seal': { id: 'drop-seal', label: 'Automatic drop seal + threshold plate', effectiveGapMm: 0.2, resistivity: 30000, fillFraction: 0.7, costPerDoor: 110 },
  'drop-seal-double': { id: 'drop-seal-double', label: 'Twin drop seal on rebated threshold', effectiveGapMm: 0.08, resistivity: 45000, fillFraction: 0.9, costPerDoor: 220 },
};

/**
 * @typedef {Object} Door
 * @property {string} id
 * @property {string} [label]
 * @property {number} widthM
 * @property {number} heightM
 * @property {import('./panel.mjs').Leaf} leaf   the door construction
 * @property {SealSpec} perimeterSeal
 * @property {SealSpec} thresholdSeal
 * @property {number} [frameGapMm]   gap between frame and wall opening
 * @property {boolean} [frameSealed]
 * @property {number} [count]
 * @property {Object} [vision]  {widthM, heightM, leaf}
 * @property {Object} [secondDoor] a second door leaf forming an air lock
 * @property {number} [airlockDepthM]
 * @property {number} [costOverride]
 */

/** Door leaf area, m^2. */
export const doorArea = (d) => d.widthM * d.heightM * (d.count || 1);

/** Door perimeter length, m. */
export const doorPerimeter = (d) => 2 * (d.widthM + d.heightM);

/**
 * Compute a door's per-band effective transmitting area (S * tau),
 * broken down by sub-path. Everything downstream works in these units so
 * that paths add linearly on a power basis.
 *
 * @param {Door} door
 * @returns {{total:number[], paths:{id:string,label:string,eff:number[],area:number}[], leafTL:number[]}}
 */
export function doorEffectiveArea(door, opts = {}) {
  const n = door.count || 1;
  const A = door.widthM * door.heightM;
  const thickness = door.leaf.layers.reduce((s, l) => s + l.thicknessMm, 0);

  const leafRes = singleLeafTL({ ...door.leaf, widthM: door.widthM, heightM: door.heightM }, opts);
  const paths = [];

  // 1. Through the leaf
  const vision = door.vision;
  const visionA = vision ? vision.widthM * vision.heightM : 0;
  const solidA = Math.max(0, A - visionA);
  paths.push({
    id: 'leaf',
    label: 'Door leaf (through the material)',
    area: solidA * n,
    eff: leafRes.tl.map((tl) => solidA * n * tlToTau(tl)),
  });

  // 2. Vision panel
  if (vision) {
    const vRes = vision.partition
      ? partitionTL({ ...vision.partition, areaM2: visionA }, opts)
      : singleLeafTL({ ...vision.leaf, widthM: vision.widthM, heightM: vision.heightM }, opts);
    paths.push({
      id: 'vision',
      label: 'Vision panel / window in door',
      area: visionA * n,
      eff: vRes.tl.map((tl) => visionA * n * tlToTau(tl)),
    });
  }

  // 3. Perimeter gap (three sides: two stiles + head)
  const ps = door.perimeterSeal || PERIMETER_SEALS.none;
  const perimLen = (2 * door.heightM + door.widthM) * 1000;
  const permGap = {
    shape: 'slit', widthMm: ps.effectiveGapMm, lengthMm: perimLen, depthMm: thickness,
    count: n, sealResistivity: ps.resistivity, sealFillFraction: ps.fillFraction,
  };
  paths.push({
    id: 'perimeter',
    label: `Perimeter gap — ${ps.label} (${ps.effectiveGapMm} mm)`,
    area: gapArea(permGap),
    eff: gapTau(permGap, opts).map((t) => t * gapArea(permGap)),
  });

  // 4. Threshold
  const ts = door.thresholdSeal || THRESHOLD_SEALS.undercut;
  const thrGap = {
    shape: 'slit', widthMm: ts.effectiveGapMm, lengthMm: door.widthM * 1000, depthMm: thickness,
    count: n, sealResistivity: ts.resistivity, sealFillFraction: ts.fillFraction,
  };
  paths.push({
    id: 'threshold',
    label: `Threshold — ${ts.label} (${ts.effectiveGapMm} mm)`,
    area: gapArea(thrGap),
    eff: gapTau(thrGap, opts).map((t) => t * gapArea(thrGap)),
  });

  // 5. Frame-to-wall junction
  const fg = door.frameSealed === false ? (door.frameGapMm ?? 2) : (door.frameGapMm ?? 0.05);
  const frameGap = {
    shape: 'slit', widthMm: fg, lengthMm: doorPerimeter(door) * 1000, depthMm: Math.max(thickness, 100),
    count: n,
    sealResistivity: door.frameSealed === false ? undefined : 200000,
    sealFillFraction: door.frameSealed === false ? undefined : 1.0,
  };
  paths.push({
    id: 'frame',
    label: door.frameSealed === false
      ? `Frame-to-wall junction, unsealed (${fg} mm)`
      : `Frame-to-wall junction, sealed with acoustic sealant`,
    area: gapArea(frameGap),
    eff: gapTau(frameGap, opts).map((t) => t * gapArea(frameGap)),
  });

  let total = new Array(N_BANDS).fill(0);
  for (const p of paths) for (let i = 0; i < N_BANDS; i++) total[i] += p.eff[i];

  // 6. Second door / air lock — the two doors are in series, so the *composite*
  // TL of door 1 adds to that of door 2, plus the air-lock cavity gain.
  if (door.secondDoor) {
    const d2 = doorEffectiveArea({ ...door.secondDoor, count: n }, opts);
    const tl1 = total.map((e) => tauToTL(e / (A * n)));
    const tl2 = d2.total.map((e) => tauToTL(e / (A * n)));
    const depth = door.airlockDepthM ?? 0.6;
    for (let i = 0; i < N_BANDS; i++) {
      const f = THIRD_OCTAVE_EXACT[i];
      // Air-lock behaves as a lined cavity between two partitions. Gain is
      // limited at low frequency by the lobby's own resonance c/(2L).
      const fLobby = 343 / (2 * Math.max(depth, 0.15));
      const gain = f < fLobby ? 2 : Math.min(9, 3 + 6 * Math.log10(f / fLobby) / Math.log10(4));
      const series = tl1[i] + tl2[i] + gain;
      // Flanking through the lobby walls caps a two-door system in practice.
      total[i] = A * n * tlToTau(Math.min(series, AIRLOCK_MAX_TL_DB));
    }
    paths.push({
      id: 'second-door',
      label: `Second door in series (air lock ${(depth * 1000).toFixed(0)} mm)`,
      area: A * n,
      eff: total.slice(),
      isSeries: true,
    });
  }

  return { total, paths, leafTL: leafRes.tl, fc: leafRes.fc, surfaceMass: surfaceMass(door.leaf) };
}

/** Composite TL of the door as installed (referenced to its own opening area). */
export function doorCompositeTL(door, opts = {}) {
  const { total } = doorEffectiveArea(door, opts);
  const A = doorArea(door);
  return total.map((e) => tauToTL(e / A));
}

/** Indicative door cost. */
export function doorCost(door) {
  if (door.costOverride != null) return door.costOverride * (door.count || 1);
  const A = door.widthM * door.heightM;
  const leafCostM2 = door.leaf.layers.reduce(
    (s, l) => s + (l.material.costPerM2PerMm || 0) * l.thicknessMm, 0);
  let c = leafCostM2 * A + 60; // ironmongery + frame
  c += (door.perimeterSeal?.costPerDoor || 0) + (door.thresholdSeal?.costPerDoor || 0);
  if (door.vision) c += 140;
  let total = c * (door.count || 1);
  if (door.secondDoor) total += doorCost({ ...door.secondDoor, count: door.count || 1 });
  return total;
}

/**
 * Rank the door's own sub-paths so the UI can say
 * "83% of your door leakage is the threshold".
 */
export function doorPathBreakdown(door, opts = {}) {
  const { paths } = doorEffectiveArea(door, opts);
  const real = paths.filter((p) => !p.isSeries);
  const scored = real.map((p) => {
    // Weight by a speech-shaped spectrum so the ranking reflects audibility.
    let s = 0;
    for (let i = 0; i < N_BANDS; i++) s += p.eff[i];
    return { ...p, score: s };
  });
  const tot = scored.reduce((a, b) => a + b.score, 0) || 1;
  return scored
    .map((p) => ({ id: p.id, label: p.label, percent: (100 * p.score) / tot, area: p.area }))
    .sort((a, b) => b.percent - a.percent);
}

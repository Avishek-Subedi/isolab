/**
 * Design optimiser.
 *
 * Given a starting design, a target receiver level and a budget, find the
 * cheapest combination of upgrades that meets the target — and, when nothing
 * meets it, say so plainly and report how close the budget can get.
 *
 * Method: enumerate the Cartesian product of a small set of mutually exclusive
 * upgrade groups (wall, door, vent, floor, sealing, treatment), simulate each
 * combination, and return the Pareto front of cost against achieved level.
 * The engine runs a full 24-band simulation in well under a millisecond, so a
 * few thousand candidates is trivial and an exhaustive search gives the true
 * optimum rather than a greedy approximation.
 *
 * The single most important output is not the winning combination — it is the
 * *marginal* table: how many dB each extra pound buys, and where the curve
 * goes flat. Beyond a certain point every design becomes leak- or
 * flanking-limited and further spending on mass achieves nothing, which is
 * exactly the mistake this tool exists to prevent.
 */

import { simulate } from './solver.mjs';
import { buildDesign } from '../data/designs.mjs';
import { WALL_PRESETS, DOOR_PRESETS, FLOOR_PRESETS } from '../data/assemblies.mjs';
import { DUCT_PRESETS } from './duct.mjs';

/**
 * Upgrade groups. Each option is a patch applied to the design spec, with an
 * indicative incremental cost handled by the cost model rather than stated here
 * (so cost and acoustics can never disagree).
 */
export const UPGRADE_GROUPS = {
  wall: {
    label: 'Wall construction',
    options: [
      { id: 'booth-budget', label: 'Budget: 18 mm MDF + 50 mm wool + 12.5 mm board', patch: { wall: 'booth-budget' } },
      { id: 'stud-double-board', label: 'Rigid studs, two boards each side, insulated', patch: { wall: 'stud-double-board' } },
      { id: 'stud-damped', label: 'Rigid studs, two boards each side + damping compound', patch: { wall: 'stud-damped' } },
      { id: 'booth-mid', label: 'Resilient bar, damped double board, 100 mm wool', patch: { wall: 'booth-mid' } },
      { id: 'booth-pro', label: 'Isolation clips, damped double board, 140 mm wool', patch: { wall: 'booth-pro' } },
      { id: 'double-stud', label: 'Fully separate double frame, 190 mm cavity', patch: { wall: 'double-stud' } },
      { id: 'room-in-room', label: 'Room-in-room, triple board, 250 mm cavity', patch: { wall: 'room-in-room' } },
    ],
  },
  door: {
    label: 'Door',
    options: [
      { id: 'hollow', label: 'Existing hollow-core door, unsealed', patch: { door: 'hollow' } },
      { id: 'solid-core', label: '44 mm solid-core door, basic seals', patch: { door: 'solid-core' } },
      { id: 'mdf-heavy', label: 'Shop-built 2 x 18 mm damped MDF door, good seals', patch: { door: 'mdf-heavy' } },
      { id: 'acoustic-45', label: 'Proprietary acoustic door set, Rw 40', patch: { door: 'acoustic-45' } },
      { id: 'double-airlock', label: 'Two solid doors with a 600 mm air lock', patch: { door: 'double-airlock' } },
      { id: 'acoustic-54', label: 'Studio acoustic door set, Rw 47', patch: { door: 'acoustic-54' } },
    ],
  },
  vent: {
    label: 'Ventilation',
    options: [
      { id: 'open-hole', label: 'Open hole in the wall', patch: { ventPreset: 'open-hole' } },
      { id: 'straight-unlined', label: 'Straight unlined 100 mm duct', patch: { ventPreset: 'straight-unlined' } },
      { id: 'flex-2bend', label: 'Flexible duct, 2 m, two bends', patch: { ventPreset: 'flex-2bend' } },
      { id: 'labyrinth', label: 'Lined labyrinth, 3 m, four bends', patch: { ventPreset: 'labyrinth' } },
      { id: 'silenced-pro', label: 'Twin attenuators + plenum + labyrinth', patch: { ventPreset: 'silenced-pro' } },
    ],
  },
  floor: {
    label: 'Floor isolation',
    options: [
      { id: 'direct', label: 'Directly on the existing floor', patch: { floorSystem: 'direct' } },
      { id: 'rubber-mat', label: 'Continuous rubber mat under the footprint', patch: { floorSystem: 'rubber-mat' } },
      { id: 'floating-wool', label: 'Floating deck on a 50 mm mineral wool raft', patch: { floorSystem: 'floating-wool' } },
      { id: 'floating-heavy', label: 'Floating deck with 50 mm screed', patch: { floorSystem: 'floating-heavy' } },
    ],
  },
  sealing: {
    label: 'Airtightness',
    options: [
      {
        id: 'as-built', label: 'Typical construction: unsealed junctions and socket box',
        patch: {
          gaps: [
            { label: 'Wall/floor junction, unsealed', shape: 'slit', widthMm: 2, lengthMm: 5600, depthMm: 100, host: 'floor' },
            { label: 'Unsealed socket back-box', shape: 'hole', widthMm: 60, depthMm: 35, host: 'left' },
          ],
        },
      },
      {
        id: 'sealed', label: 'All junctions and penetrations sealed with acoustic sealant',
        patch: {
          gaps: [
            { label: 'Wall/floor junction, sealed', shape: 'slit', widthMm: 0.05, lengthMm: 5600, depthMm: 100, sealResistivity: 200000, sealFillFraction: 1, host: 'floor' },
            { label: 'Socket back-box, sealed and backed', shape: 'hole', widthMm: 60, depthMm: 35, sealResistivity: 200000, sealFillFraction: 1, host: 'left' },
          ],
        },
      },
    ],
  },
};

/**
 * @typedef {Object} OptimiseRequest
 * @property {object} baseSpec         the design spec to start from (see buildDesign)
 * @property {number} targetDbA        receiver-side A-weighted target
 * @property {number} budget           currency
 * @property {string[]} [groups]       which upgrade groups to search
 * @property {string[]} [locked]       group ids to hold at the base value
 */

/**
 * Exhaustive search over the upgrade product.
 * @param {OptimiseRequest} req
 */
export function optimise(req) {
  const groups = (req.groups || Object.keys(UPGRADE_GROUPS))
    .filter((g) => !(req.locked || []).includes(g));

  const lists = groups.map((g) => UPGRADE_GROUPS[g].options.map((o) => ({ group: g, ...o })));

  /** @type {{combo:object[], spec:object, result:object, cost:number, level:number}[]} */
  const candidates = [];

  const walk = (i, acc) => {
    if (i === lists.length) {
      const spec = { ...req.baseSpec };
      for (const o of acc) Object.assign(spec, o.patch);
      const design = buildDesign(spec);
      const result = simulate(design);
      candidates.push({
        combo: acc.slice(),
        spec,
        cost: result.cost.total,
        level: result.totals.outsideWithFanA,
        stc: result.ratings.stc,
        weakest: result.breakdown.weakest,
        excess: result.totals.audibleExcessA,
        result,
      });
      return;
    }
    for (const opt of lists[i]) walk(i + 1, [...acc, opt]);
  };
  walk(0, []);

  candidates.sort((a, b) => a.cost - b.cost);

  // --- Pareto front: cheapest design achieving each level ---
  const pareto = [];
  let bestLevel = Infinity;
  for (const c of candidates) {
    if (c.level >= bestLevel - 0.05) continue;
    // Candidates are cost-sorted, so an equal-cost entry always dominates the
    // one already stored: replace rather than append, or the front would
    // contain two points at the same cost.
    if (pareto.length && Math.abs(c.cost - pareto[pareto.length - 1].cost) < 1e-6) pareto.pop();
    pareto.push(c);
    bestLevel = c.level;
  }

  const meetsTarget = candidates.filter((c) => c.level <= req.targetDbA);
  const affordable = candidates.filter((c) => c.cost <= req.budget);
  const both = candidates.filter((c) => c.level <= req.targetDbA && c.cost <= req.budget);

  const cheapestMeeting = meetsTarget.length
    ? meetsTarget.reduce((a, b) => (a.cost <= b.cost ? a : b)) : null;
  const bestAffordable = affordable.length
    ? affordable.reduce((a, b) => (a.level <= b.level ? a : b)) : null;
  const recommended = both.length
    ? both.reduce((a, b) => (a.cost <= b.cost ? a : b)) : (bestAffordable || cheapestMeeting);

  // --- Marginal value: walk the Pareto front and report dB per £100 ---
  const marginal = [];
  for (let i = 1; i < pareto.length; i++) {
    const dCost = pareto[i].cost - pareto[i - 1].cost;
    const dLevel = pareto[i - 1].level - pareto[i].level;
    marginal.push({
      fromCost: pareto[i - 1].cost, toCost: pareto[i].cost,
      fromLevel: pareto[i - 1].level, toLevel: pareto[i].level,
      deltaCost: dCost, deltaDb: dLevel,
      dbPer100: dCost > 0 ? (dLevel / dCost) * 100 : Infinity,
      changes: describeDiff(pareto[i - 1].combo, pareto[i].combo),
    });
  }

  return {
    request: req,
    candidateCount: candidates.length,
    pareto: pareto.map(strip),
    marginal,
    recommended: recommended ? strip(recommended) : null,
    recommendedFull: recommended || null,
    cheapestMeetingTarget: cheapestMeeting ? strip(cheapestMeeting) : null,
    bestAffordable: bestAffordable ? strip(bestAffordable) : null,
    feasible: meetsTarget.length > 0,
    affordableAndFeasible: both.length > 0,
    verdict: buildOptimiserVerdict(req, meetsTarget, affordable, both, pareto),
  };
}

const strip = (c) => ({
  cost: c.cost, level: c.level, stc: c.stc, excess: c.excess,
  weakest: c.weakest ? { label: c.weakest.label, percent: c.weakest.percent } : null,
  choices: c.combo.map((o) => ({ group: o.group, id: o.id, label: o.label })),
});

function describeDiff(a, b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (!a[i] || a[i].id !== b[i].id) {
      out.push(`${UPGRADE_GROUPS[b[i].group].label}: ${a[i] ? a[i].label : '—'} → ${b[i].label}`);
    }
  }
  return out;
}

function buildOptimiserVerdict(req, meetsTarget, affordable, both, pareto) {
  const best = pareto.length ? pareto[pareto.length - 1] : null;
  if (both.length) {
    const w = both.reduce((a, b) => (a.cost <= b.cost ? a : b));
    return {
      status: 'achievable',
      headline: `Target of ${req.targetDbA} dB(A) is achievable within £${req.budget}. Cheapest compliant build: £${w.cost.toFixed(0)}, predicted ${w.level.toFixed(1)} dB(A).`,
      note: `Leaves £${(req.budget - w.cost).toFixed(0)} of the budget unspent. Spending it on the next item in the marginal table buys the most additional benefit.`,
    };
  }
  if (meetsTarget.length) {
    const cheapest = meetsTarget.reduce((a, b) => (a.cost <= b.cost ? a : b));
    return {
      status: 'over-budget',
      headline: `Target of ${req.targetDbA} dB(A) is reachable but not within £${req.budget}. The cheapest design that meets it costs £${cheapest.cost.toFixed(0)}.`,
      note: `Within budget the best achievable is ${affordable.length ? affordable.reduce((a, b) => (a.level <= b.level ? a : b)).level.toFixed(1) : '—'} dB(A). Either raise the budget by £${(cheapest.cost - req.budget).toFixed(0)}, accept a higher level, or reduce the source level.`,
    };
  }
  return {
    status: 'infeasible',
    headline: `Target of ${req.targetDbA} dB(A) cannot be reached with any combination in the option set${best ? `; the best possible is ${best.level.toFixed(1)} dB(A) at £${best.cost.toFixed(0)}` : ''}.`,
    note: best && best.weakest
      ? `The limiting path in the best design is "${best.weakest.label}" at ${best.weakest.percent.toFixed(0)}% of the transmitted power. No amount of extra mass will help until that path is addressed — and if it is a flanking or ventilation path, the option set may simply not contain a good enough component.`
      : 'Consider reducing the source level, moving the booth away from the sensitive receiver, or accepting a time-of-day restriction instead.',
  };
}

/**
 * Single-change sensitivity: from the current design, what does each individual
 * upgrade buy on its own? This is the "Option 1 / Option 2 / Option 3" list,
 * and it is the honest way to present advice because it isolates each change.
 * @param {object} baseSpec
 */
export function singleChangeOptions(baseSpec) {
  const base = simulate(buildDesign(baseSpec));
  const baseLevel = base.totals.outsideWithFanA;
  const baseCost = base.cost.total;
  const out = [];

  for (const [gid, group] of Object.entries(UPGRADE_GROUPS)) {
    for (const opt of group.options) {
      const spec = { ...baseSpec, ...opt.patch };
      const r = simulate(buildDesign(spec));
      const delta = r.totals.outsideWithFanA - baseLevel;
      const dCost = r.cost.total - baseCost;
      if (Math.abs(delta) < 0.05 && Math.abs(dCost) < 1) continue;
      out.push({
        group: gid, groupLabel: group.label, id: opt.id, label: opt.label,
        improvementDb: -delta, deltaCost: dCost,
        newLevel: r.totals.outsideWithFanA, newStc: r.ratings.stc,
        valuePer100: dCost > 0 ? (-delta / dCost) * 100 : (delta < 0 ? Infinity : 0),
        weakestAfter: r.breakdown.weakest?.label,
      });
    }
  }
  out.sort((a, b) => b.improvementDb - a.improvementDb);
  return { baseLevel, baseCost, options: out };
}

/**
 * Compare two designs side by side (Part: comparison mode).
 */
export function compareDesigns(specA, specB, labels = ['Design A', 'Design B']) {
  const a = simulate(buildDesign(specA));
  const b = simulate(buildDesign(specB));
  return {
    labels,
    a, b,
    delta: {
      outsideA: b.totals.outsideWithFanA - a.totals.outsideWithFanA,
      stc: b.ratings.stc - a.ratings.stc,
      cost: b.cost.total - a.cost.total,
      perBand: a.outside.spectrum.map((v, i) => b.outside.spectrum[i] - v),
      costPerDb: (b.cost.total - a.cost.total) /
        Math.max(0.1, a.totals.outsideWithFanA - b.totals.outsideWithFanA),
    },
  };
}

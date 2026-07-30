/**
 * Material advisor.
 *
 * Answers the question the user actually asks: "is this material any good for
 * stopping sound getting out?" — and separates that from "is it good for
 * making the room sound nicer inside?", because these are different jobs and
 * confusing them is the single most common and most expensive mistake in
 * amateur studio construction.
 */

import { THIRD_OCTAVE_EXACT, N_BANDS, THIRD_OCTAVE } from './bands.mjs';
import { massLawTL, criticalFrequency, singleLeafTL, longitudinalSpeed } from './panel.mjs';
import { porousAlpha } from './acoustics.mjs';

/**
 * @param {import('../data/materials.mjs').Material} m
 * @param {number} thicknessMm
 */
export function assessMaterial(m, thicknessMm) {
  const t = thicknessMm ?? (m.availableThicknessesMm?.[Math.floor((m.availableThicknessesMm.length - 1) / 2)] ?? 12);
  const ms = m.density * (t / 1000);
  const fc = criticalFrequency(m, t);
  const cL = longitudinalSpeed(m);
  const leaf = { layers: [{ material: m, thicknessMm: t }], widthM: 1.2, heightM: 2.4 };
  const tl = singleLeafTL(leaf).tl;
  const tl500 = tl[THIRD_OCTAVE.indexOf(500)];
  const tl125 = tl[THIRD_OCTAVE.indexOf(125)];

  const absorption = m.flowResistivity ? porousAlpha(m.flowResistivity, t, 0) : null;
  const nrc = absorption
    ? Math.round(([250, 500, 1000, 2000].reduce((s, f) => s + absorption[THIRD_OCTAVE.indexOf(f)], 0) / 4) * 20) / 20
    : null;

  // --- Blocking score: driven by surface mass, penalised for stiffness ---
  // 10 kg/m^2 ~ single 12.5 mm plasterboard = "adequate mass layer" baseline.
  let blocking;
  if (ms < 1) blocking = 0;
  else if (ms < 3) blocking = 1;
  else if (ms < 8) blocking = 2;
  else if (ms < 16) blocking = 3;
  else if (ms < 40) blocking = 4;
  else blocking = 5;
  // Stiff, undamped panels lose real-world performance to the coincidence dip.
  const dipDepth = Math.max(0, massLawTL(ms, Math.min(fc, 5000)) - tl[nearestBand(Math.min(fc, 5000))]);
  if (dipDepth > 13 && fc > 200 && fc < 6000) blocking = Math.max(0, blocking - 1);

  // --- Absorbing score ---
  let absorbing = 0;
  if (nrc !== null) {
    if (nrc >= 0.9) absorbing = 5;
    else if (nrc >= 0.7) absorbing = 4;
    else if (nrc >= 0.5) absorbing = 3;
    else if (nrc >= 0.3) absorbing = 2;
    else if (nrc >= 0.15) absorbing = 1;
  }

  // --- Damping score ---
  const damping = m.lossFactor >= 0.3 ? 5 : m.lossFactor >= 0.15 ? 4 : m.lossFactor >= 0.05 ? 3 : m.lossFactor >= 0.01 ? 2 : 1;

  const verdict = buildVerdict({ m, t, ms, fc, cL, blocking, absorbing, damping, tl500, tl125, nrc, dipDepth });

  return {
    material: m, thicknessMm: t,
    surfaceMass: ms,
    criticalFrequency: fc,
    longitudinalSpeed: cL,
    tl, tl500, tl125,
    absorption, nrc,
    scores: { blocking, absorbing, damping },
    coincidenceDipDb: dipDepth,
    ...verdict,
  };
}

function nearestBand(f) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N_BANDS; i++) {
    const d = Math.abs(Math.log(THIRD_OCTAVE_EXACT[i] / f));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function buildVerdict(x) {
  const { m, t, ms, fc, blocking, absorbing, tl500, nrc, dipDepth } = x;
  const lines = [];
  const warnings = [];

  const headline = (() => {
    if (blocking >= 4 && absorbing <= 1) return 'Strong isolator. Use it as a mass layer.';
    if (blocking >= 3 && absorbing <= 2) return 'Useful mass layer for isolation.';
    if (blocking <= 1 && absorbing >= 3) return 'Absorber only. This will NOT stop sound escaping.';
    if (blocking <= 1 && absorbing >= 2) return 'Weak on both counts at this thickness.';
    if (blocking >= 2 && absorbing >= 3) return 'Mixed use — modest mass, decent absorption.';
    if (m.role === 'damping') return 'Damping treatment. Improves other layers rather than blocking on its own.';
    if (m.role === 'structural') return 'Structural component, not an isolation layer.';
    return 'Marginal for isolation at this thickness.';
  })();

  lines.push(`At ${t} mm this gives ${ms.toFixed(1)} kg/m² of surface mass, which by itself is worth about ${tl500.toFixed(0)} dB of transmission loss at 500 Hz.`);

  if (absorbing >= 3 && blocking <= 1) {
    lines.push(`Its absorption is good (NRC ≈ ${nrc.toFixed(2)}), so it will make the inside of the booth sound drier and reduce the reverberant build-up. Reducing the internal level does help a little — but the mechanism is worth only 2-4 dB, not the 20-30 dB people expect from covering a wall in it.`);
    warnings.push('Do not count this material toward your isolation target. Sound blocking needs mass and airtightness; absorption is a different job.');
  }

  if (m.role === 'porous' && blocking <= 1) {
    lines.push(`Inside a wall cavity it earns its place differently: it damps the cavity so the mass-air-mass resonance and standing waves are suppressed, typically worth 3-8 dB in a double-leaf wall. That is a real isolation benefit — but it comes from the cavity, not from the material blocking anything.`);
  }

  if (fc > 200 && fc < 8000) {
    const sev = dipDepth > 10 ? 'significant' : dipDepth > 5 ? 'noticeable' : 'mild';
    lines.push(`Coincidence (critical) frequency is ${Math.round(fc)} Hz, producing a ${sev} dip of about ${dipDepth.toFixed(0)} dB there. ${fc > 800 && fc < 4000 ? 'That lands inside the speech and vocal range, which matters.' : ''}`);
    if (dipDepth > 8) {
      warnings.push(`The ${Math.round(fc)} Hz coincidence dip costs you real performance. Fixes: use two thinner sheets instead of one thick one, bond a damping compound between layers, or pair it with a different material so the two dips do not coincide.`);
    }
  }

  if (m.lossFactor < 0.005) {
    warnings.push(`Loss factor of ${m.lossFactor} is extremely low — this material rings. Without a bonded damping layer it will fall well short of mass law around its coincidence frequency.`);
  }

  if (m.role === 'membrane' && m.lossFactor > 0.1) {
    lines.push(`This is a genuinely limp material: negligible bending stiffness pushes the coincidence frequency above the audible range, so it follows mass law cleanly across the whole spectrum. That is the ideal behaviour for an isolation layer.`);
  }

  if (m.id === 'mlv') {
    warnings.push('Compare on cost per kg/m². MLV at 2.6 mm gives ~4.9 kg/m² for about £25/m²; a sheet of 12.5 mm plasterboard gives ~8.8 kg/m² for about £2.80/m². MLV wins only where thickness is genuinely constrained.');
  }

  if (m.role === 'mass' && ms > 40) {
    warnings.push(`At ${ms.toFixed(0)} kg/m² check the structure can carry it. A 2.4 m x 2.4 m wall at this density is ${(ms * 5.76).toFixed(0)} kg for that one wall alone.`);
  }

  return { headline, explanation: lines, warnings };
}

/**
 * Compare a set of materials on isolation value for money, at equal cost.
 * Answers "what is the cheapest way to add 10 kg/m^2?"
 */
export function costPerKgPerM2(m) {
  const c = m.costPerM2PerMm || 0;
  if (!c) return null;
  // cost per mm / mass per mm  =>  cost per kg/m^2
  return c / (m.density / 1000);
}

/** Rank all mass-capable materials by cost per unit surface mass. */
export function rankByValue(materials) {
  return Object.values(materials)
    .filter((m) => m.role === 'mass' || m.role === 'membrane' || m.role === 'glazing')
    .map((m) => ({ material: m, costPerKg: costPerKgPerM2(m) }))
    .filter((x) => x.costPerKg != null && isFinite(x.costPerKg))
    .sort((a, b) => a.costPerKg - b.costPerKg);
}

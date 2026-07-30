/**
 * Single-number rating calculators.
 *
 *  - STC  : ASTM E413  (125-4000 Hz, 16 bands)
 *  - Rw   : ISO 717-1  (100-3150 Hz, 16 bands)
 *  - C,Ctr: ISO 717-1 spectrum adaptation terms
 *  - NIC / Dw : field level-difference ratings
 *  - NR curves (ISO 1996 / Noise Rating) for the receiver-side verdict
 */

import { THIRD_OCTAVE, STC_BAND_INDEX, RW_BAND_INDEX } from './bands.mjs';

/** ASTM E413 reference contour, relative to the 500 Hz value, 125-4000 Hz. */
const STC_CONTOUR = [-16, -13, -10, -7, -4, -1, 0, 1, 2, 3, 4, 4, 4, 4, 4, 4];

/** ISO 717-1 reference contour, relative to the 500 Hz value, 100-3150 Hz. */
const RW_CONTOUR = [-19, -16, -13, -10, -7, -4, -1, 0, 1, 2, 3, 4, 6, 6, 6, 6];

/** ISO 717-1 spectrum No.1 (pink noise, A-weighted) -> C. */
const SPECTRUM_C = [-29, -26, -23, -21, -19, -17, -15, -13, -12, -11, -10, -9, -9, -9, -9, -9];
/** ISO 717-1 spectrum No.2 (urban traffic, A-weighted) -> Ctr. */
const SPECTRUM_CTR = [-20, -20, -18, -16, -15, -14, -13, -12, -11, -9, -8, -9, -10, -11, -13, -15];

/**
 * ASTM E413 Sound Transmission Class.
 * Rules: max deficiency in any single band <= 8 dB; sum of deficiencies <= 32 dB.
 * @param {number[]} tl24 transmission loss, 24-band 1/3-octave
 * @returns {{stc:number, deficiencies:number[], totalDeficiency:number, worstBand:number}}
 */
export function computeSTC(tl24) {
  const tl = STC_BAND_INDEX.map((i) => tl24[i]);
  let best = 0, bestDef = null;
  for (let stc = 0; stc <= 100; stc++) {
    const def = STC_CONTOUR.map((c, i) => Math.max(0, stc + c - tl[i]));
    const total = def.reduce((a, b) => a + b, 0);
    const worst = Math.max(...def);
    if (total <= 32 && worst <= 8) {
      best = stc;
      bestDef = def;
    }
  }
  const def = bestDef || STC_CONTOUR.map((c, i) => Math.max(0, best + c - tl[i]));
  const worstIdx = def.indexOf(Math.max(...def));
  return {
    stc: best,
    deficiencies: def,
    totalDeficiency: def.reduce((a, b) => a + b, 0),
    worstBand: THIRD_OCTAVE[STC_BAND_INDEX[worstIdx]],
  };
}

/**
 * ISO 717-1 weighted sound reduction index Rw, plus C and Ctr.
 * @param {number[]} tl24
 * @returns {{rw:number, c:number, ctr:number, rwC:number, rwCtr:number}}
 */
export function computeRw(tl24) {
  const tl = RW_BAND_INDEX.map((i) => tl24[i]);
  let best = 0;
  for (let rw = 0; rw <= 100; rw++) {
    const total = RW_CONTOUR.reduce((s, c, i) => s + Math.max(0, rw + c - tl[i]), 0);
    if (total <= 32.0) best = rw;
  }
  const adapt = (spec) => {
    let s = 0;
    for (let i = 0; i < spec.length; i++) s += Math.pow(10, (spec[i] - tl[i]) / 10);
    return -10 * Math.log10(s) - best;
  };
  const c = Math.round(adapt(SPECTRUM_C));
  const ctr = Math.round(adapt(SPECTRUM_CTR));
  return { rw: best, c, ctr, rwC: best + c, rwCtr: best + ctr };
}

/**
 * Noise Isolation Class (ASTM E413 contour applied to the measured
 * level difference rather than to TL). This is what a field measurement
 * of "inside dB minus outside dB" actually yields.
 */
export function computeNIC(levelDiff24) {
  return computeSTC(levelDiff24).stc;
}

/** NR (Noise Rating) curve value for a receiver octave spectrum. */
const NR_A = [55.4, 35.5, 22.0, 12.0, 4.8, 0.0, -3.5, -6.1];
const NR_B = [0.681, 0.79, 0.87, 0.93, 0.974, 1.0, 1.015, 1.025];

/**
 * @param {number[]} oct8 octave-band SPL, 63 Hz .. 8 kHz
 * @returns {{nr:number, governingBand:number}}
 */
export function computeNR(oct8) {
  let nr = -Infinity, gov = 63;
  const bands = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
  for (let i = 0; i < 8; i++) {
    const v = (oct8[i] - NR_A[i]) / NR_B[i];
    if (v > nr) { nr = v; gov = bands[i]; }
  }
  return { nr: Math.round(nr * 10) / 10, governingBand: gov };
}

/**
 * Plain-language description of an A-weighted level.
 */
export function describeLevel(dBA) {
  const scale = [
    [0, 'Threshold of hearing — inaudible'],
    [10, 'Anechoic / imperceptible'],
    [20, 'Rustling leaves — a very quiet bedroom at night'],
    [25, 'Recording-studio noise floor'],
    [30, 'Very quiet bedroom; audible only if you listen for it'],
    [35, 'Quiet library; meets most residential night criteria'],
    [40, 'Normal quiet room; a quiet neighbour would notice music'],
    [45, 'Quiet office; clearly audible in a still room'],
    [50, 'Refrigerator at 1 m; intrusive at night'],
    [55, 'Normal conversation; will disturb sleep'],
    [65, 'Loud conversation; complaint territory'],
    [75, 'Vacuum cleaner at 1 m'],
    [85, 'Hearing-damage risk over 8 h'],
    [100, 'Very loud — power tools'],
    [120, 'Threshold of pain'],
  ];
  let out = scale[0][1];
  for (const [v, d] of scale) if (dBA >= v) out = d;
  return out;
}

/**
 * Typical statutory / guideline limits, for the verdict panel.
 * Values are A-weighted receiver-side levels.
 */
export const CRITERIA = [
  { id: 'who-night', label: 'WHO night-noise guideline (bedroom)', limit: 30, note: 'WHO Night Noise Guidelines, indoor L_night' },
  { id: 'bs8233-night', label: 'BS 8233 bedroom, night', limit: 30, note: 'BS 8233:2014 indoor ambient, 23:00-07:00' },
  { id: 'bs8233-day', label: 'BS 8233 living room, day', limit: 35, note: 'BS 8233:2014 indoor ambient, 07:00-23:00' },
  { id: 'studio-nc25', label: 'Recording studio background (NC-25)', limit: 30, note: 'Typical control-room / live-room target' },
  { id: 'office', label: 'Private office', limit: 40, note: 'ANSI/ASA S12.2 NC-35 equivalent' },
  { id: 'nuisance', label: 'Statutory nuisance risk threshold', limit: 42, note: 'Indicative; UK EPA 1990 s.79 is judgement-based' },
];

/**
 * Frequency band definitions and frequency weightings.
 *
 * The engine computes internally in 1/3-octave bands (50 Hz .. 10 kHz, 24 bands)
 * because the physical effects that dominate isolation — mass-air-mass resonance,
 * coincidence dips, cavity standing waves, slit resonances — are narrow-band and
 * are smeared into nonsense by octave-band-only arithmetic.
 *
 * Results are then folded down to the 8 octave bands (63 Hz .. 8 kHz) for display,
 * by energy summation of the three constituent 1/3-octaves.
 */

/** Nominal 1/3-octave centre frequencies used by the engine (24 bands). */
export const THIRD_OCTAVE = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
];

/** Nominal octave centre frequencies for display (8 bands). */
export const OCTAVE = [63, 125, 250, 500, 1000, 2000, 4000, 8000];

/** Exact (base-10) 1/3-octave centres — used for all physics maths. */
export const THIRD_OCTAVE_EXACT = THIRD_OCTAVE.map((_, i) =>
  1000 * Math.pow(10, (i - 13) / 10)
);

/** Index ranges into THIRD_OCTAVE for each octave band. */
export const OCTAVE_MEMBERS = OCTAVE.map((_, k) => [3 * k, 3 * k + 1, 3 * k + 2]);

/** Band edges (lower, upper) for each 1/3-octave. */
export const THIRD_OCTAVE_EDGES = THIRD_OCTAVE_EXACT.map((fc) => [
  fc / Math.pow(2, 1 / 6),
  fc * Math.pow(2, 1 / 6),
]);

export const N_BANDS = THIRD_OCTAVE.length;

/** ASTM E413 STC band set: 125 Hz .. 4000 Hz (16 x 1/3-octave). */
export const STC_BAND_INDEX = THIRD_OCTAVE.map((f, i) => (f >= 125 && f <= 4000 ? i : -1)).filter((i) => i >= 0);
/** ISO 717-1 Rw band set: 100 Hz .. 3150 Hz (16 x 1/3-octave). */
export const RW_BAND_INDEX = THIRD_OCTAVE.map((f, i) => (f >= 100 && f <= 3150 ? i : -1)).filter((i) => i >= 0);

/**
 * IEC 61672-1 A-weighting, analytic form.
 * @param {number} f Hz
 * @returns {number} dB
 */
export function aWeight(f) {
  const f2 = f * f;
  const num = Math.pow(12194, 2) * f2 * f2;
  const den =
    (f2 + Math.pow(20.6, 2)) *
    Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) *
    (f2 + Math.pow(12194, 2));
  return 20 * Math.log10(num / den) + 2.0;
}

/** IEC 61672-1 C-weighting. */
export function cWeight(f) {
  const f2 = f * f;
  const num = Math.pow(12194, 2) * f2;
  const den = (f2 + Math.pow(20.6, 2)) * (f2 + Math.pow(12194, 2));
  return 20 * Math.log10(num / den) + 0.062;
}

/** Pre-computed weighting vectors over THIRD_OCTAVE_EXACT. */
export const A_WEIGHT = THIRD_OCTAVE_EXACT.map(aWeight);
export const C_WEIGHT = THIRD_OCTAVE_EXACT.map(cWeight);

/**
 * Fold a 24-band 1/3-octave dB spectrum into 8 octave bands (energy sum).
 * @param {number[]} thirds dB per 1/3-octave
 * @returns {number[]} dB per octave
 */
export function toOctaves(thirds) {
  return OCTAVE_MEMBERS.map((idx) => {
    let s = 0;
    for (const i of idx) s += Math.pow(10, thirds[i] / 10);
    return 10 * Math.log10(s);
  });
}

/**
 * Fold a 24-band *attenuation* spectrum (e.g. transmission loss) into octaves.
 * Attenuations must be combined on a transmission-coefficient (power) basis and
 * then averaged, not energy-summed — otherwise a 3-band octave gains 4.8 dB.
 * @param {number[]} thirds dB TL per 1/3-octave
 */
export function attenToOctaves(thirds) {
  return OCTAVE_MEMBERS.map((idx) => {
    let tau = 0;
    for (const i of idx) tau += Math.pow(10, -thirds[i] / 10);
    return -10 * Math.log10(tau / idx.length);
  });
}

/**
 * Interpolate an arbitrary (freq, level) curve onto the engine's 1/3-octave grid.
 * Log-frequency linear interpolation, flat extrapolation at the ends.
 * @param {number[]} freqs
 * @param {number[]} values
 * @returns {number[]} 24-band vector
 */
export function resample(freqs, values) {
  const pairs = freqs.map((f, i) => [Math.log10(f), values[i]]).sort((a, b) => a[0] - b[0]);
  return THIRD_OCTAVE_EXACT.map((fc) => {
    const x = Math.log10(fc);
    if (x <= pairs[0][0]) return pairs[0][1];
    if (x >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
    for (let i = 1; i < pairs.length; i++) {
      if (x <= pairs[i][0]) {
        const [x0, y0] = pairs[i - 1];
        const [x1, y1] = pairs[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return pairs[pairs.length - 1][1];
  });
}

/** Expand an 8-value octave spectrum to the 24-band grid (flat within octave). */
export function fromOctaves(oct) {
  return resample(OCTAVE, oct);
}

/** Convenience: constant 24-band vector. */
export const flat = (v) => new Array(N_BANDS).fill(v);

/**
 * Sound source library.
 *
 * Each source is a 24-band 1/3-octave *shape* (relative dB) plus a reference
 * overall level. The engine scales the shape so that the requested overall
 * level (dB SPL or dB(A)) is met, which is what a user actually controls with
 * the "how loud is it inside" slider.
 *
 * Spectra are drawn from published measurement literature:
 *  - Speech: ANSI S3.5 / Pearsons et al., raised and shouted voice effort
 *  - Singing: Sundberg, "The Science of the Singing Voice"; formant structure
 *  - Scream: Arnal et al. 2015 (screams concentrate energy 30-150 Hz *modulation*
 *    but spectrally peak 1-4 kHz); peak SPL at 1 m of 100-115 dB is typical
 *  - Instruments: Meyer, "Acoustics and the Performance of Music"
 *  - Drums: kick fundamental 50-80 Hz, snare 200 Hz + 3-6 kHz crack
 *
 * BANDS: 50 63 80 100 125 160 200 250 315 400 500 630 800 1k 1k25 1k6 2k 2k5 3k15 4k 5k 6k3 8k 10k
 */

/**
 * @typedef {Object} SoundSource
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {number[]} shape        relative dB, 24 bands
 * @property {number} refSpl         typical overall SPL at 1 m, dB
 * @property {number} [crestFactorDb] peak above the Leq, for the "worst case" mode
 * @property {string} notes
 */

/** @type {Record<string, SoundSource>} */
export const SOURCES = {
  'speech-normal': {
    id: 'speech-normal', name: 'Speech — normal conversation', category: 'Voice',
    shape: [-16, -12, -8, -3, 0, 1, 2, 2, 0, -1, -2, -3, -5, -6, -8, -10, -12, -14, -17, -20, -24, -28, -32, -36],
    refSpl: 60, crestFactorDb: 12,
    notes: 'Male/female average at 1 m. Energy centred 200-500 Hz with the consonant range 2-4 kHz well below it.',
  },
  'speech-raised': {
    id: 'speech-raised', name: 'Speech — raised voice', category: 'Voice',
    shape: [-18, -14, -9, -4, -1, 0, 1, 2, 2, 1, 0, -1, -2, -3, -5, -7, -9, -11, -14, -17, -21, -25, -29, -33],
    refSpl: 72, crestFactorDb: 12,
    notes: 'As vocal effort rises the spectrum tilts upward: the 500 Hz-2 kHz region gains more than the low end.',
  },
  'speech-shout': {
    id: 'speech-shout', name: 'Speech — shouting', category: 'Voice',
    shape: [-22, -18, -13, -8, -4, -2, 0, 1, 2, 2, 2, 1, 0, -1, -2, -4, -6, -8, -11, -14, -18, -22, -26, -30],
    refSpl: 88, crestFactorDb: 10,
    notes: 'Shouting adds most of its extra energy between 500 Hz and 2 kHz.',
  },
  scream: {
    id: 'scream', name: 'Human scream (full effort)', category: 'Voice',
    shape: [-26, -22, -18, -13, -9, -6, -4, -2, 0, 1, 2, 3, 3, 4, 4, 3, 2, 0, -3, -6, -10, -14, -19, -24],
    refSpl: 105, crestFactorDb: 8,
    notes: 'A scream peaks around 1-2.5 kHz, not in the bass. That is good news for isolation, because mass law gives you 6 dB per octave — a 2 kHz scream is far easier to contain than a 60 Hz kick drum of the same overall level. Trained screams reach 110-120 dB at 1 m.',
  },
  'singing-male': {
    id: 'singing-male', name: 'Singing — male (baritone/tenor)', category: 'Voice',
    shape: [-20, -14, -8, -2, 1, 2, 2, 1, 0, 0, 1, 1, 0, -1, -3, -5, -8, -11, -14, -18, -22, -26, -30, -34],
    refSpl: 92, crestFactorDb: 10,
    notes: 'Fundamental typically 100-250 Hz with the singer\'s formant near 2.8 kHz. The 100-160 Hz region is the hard part to contain.',
  },
  'singing-female': {
    id: 'singing-female', name: 'Singing — female (soprano/alto)', category: 'Voice',
    shape: [-28, -22, -16, -10, -5, -1, 1, 2, 2, 2, 2, 2, 1, 0, -1, -3, -6, -9, -12, -16, -20, -24, -28, -32],
    refSpl: 95, crestFactorDb: 10,
    notes: 'Higher fundamental (200-1000 Hz) shifts the whole problem upward, where walls perform better.',
  },
  'singing-belting': {
    id: 'singing-belting', name: 'Singing — belting / rock vocal', category: 'Voice',
    shape: [-24, -18, -12, -6, -2, 0, 1, 2, 2, 2, 3, 3, 3, 2, 1, 0, -2, -5, -8, -12, -16, -20, -25, -30],
    refSpl: 105, crestFactorDb: 8,
    notes: 'Sustained high-effort vocal. Often the real design case for a home vocal booth.',
  },
  guitar_acoustic: {
    id: 'guitar_acoustic', name: 'Acoustic guitar', category: 'Instrument',
    shape: [-18, -10, -4, 0, 2, 2, 1, 0, -1, -1, -2, -3, -4, -5, -7, -9, -11, -13, -16, -19, -22, -26, -30, -34],
    refSpl: 86, crestFactorDb: 14,
    notes: 'Body resonance around 90-110 Hz is the dominant low-frequency feature.',
  },
  'guitar-electric-amp': {
    id: 'guitar-electric-amp', name: 'Electric guitar amp (cranked)', category: 'Instrument',
    shape: [-14, -8, -3, 1, 3, 4, 4, 3, 2, 2, 2, 2, 1, 0, -2, -4, -7, -10, -14, -18, -23, -28, -33, -38],
    refSpl: 108, crestFactorDb: 8,
    notes: 'A 4x12 cabinet at gig volume. Strong 80-250 Hz content plus a hard 2-4 kHz edge.',
  },
  flute: {
    id: 'flute', name: 'Flute', category: 'Instrument',
    shape: [-45, -40, -34, -28, -22, -16, -10, -5, -1, 1, 2, 2, 2, 1, 0, -2, -4, -7, -10, -14, -18, -23, -28, -33],
    refSpl: 88, crestFactorDb: 12,
    notes: 'Almost no energy below 250 Hz, so a flute booth is much easier than a vocal booth.',
  },
  violin: {
    id: 'violin', name: 'Violin', category: 'Instrument',
    shape: [-40, -34, -28, -22, -15, -9, -4, 0, 2, 2, 2, 2, 2, 1, 0, -1, -2, -4, -7, -10, -14, -18, -23, -28],
    refSpl: 90, crestFactorDb: 12,
    notes: 'Lowest note G3 = 196 Hz. Bright, with substantial 2-6 kHz content.',
  },
  saxophone: {
    id: 'saxophone', name: 'Saxophone (alto/tenor)', category: 'Instrument',
    shape: [-30, -22, -15, -8, -3, 0, 2, 3, 3, 2, 2, 1, 0, -1, -3, -5, -7, -10, -13, -17, -21, -25, -30, -35],
    refSpl: 98, crestFactorDb: 10,
    notes: 'Loud, mid-heavy, and hard to keep quiet in a flat.',
  },
  trumpet: {
    id: 'trumpet', name: 'Trumpet', category: 'Instrument',
    shape: [-38, -30, -22, -15, -9, -4, 0, 2, 3, 4, 4, 4, 3, 2, 1, 0, -1, -3, -6, -9, -13, -18, -23, -28],
    refSpl: 105, crestFactorDb: 10,
    notes: 'Extremely directional and very loud in the 500 Hz-4 kHz range.',
  },
  drums_acoustic: {
    id: 'drums_acoustic', name: 'Acoustic drum kit (played hard)', category: 'Instrument',
    shape: [2, 4, 3, 1, 0, -1, -1, 0, -1, -2, -2, -2, -2, -2, -2, -2, -1, -1, -1, -2, -4, -7, -11, -16],
    refSpl: 110, crestFactorDb: 14,
    notes: 'The hardest case in this list. Kick fundamental 50-80 Hz with high crest factor. Mass law gives you the least help exactly where the drums put the most energy — expect to need a very deep cavity and a floating floor.',
  },
  'kick-drum': {
    id: 'kick-drum', name: 'Kick drum only', category: 'Instrument',
    shape: [6, 8, 6, 2, -2, -5, -8, -11, -13, -15, -17, -19, -21, -23, -25, -28, -31, -34, -37, -40, -44, -48, -52, -56],
    refSpl: 105, crestFactorDb: 16,
    notes: 'Almost all energy below 100 Hz. This is the spectrum that defeats booths.',
  },
  'studio-monitors': {
    id: 'studio-monitors', name: 'Studio monitors at mixing level', category: 'Playback',
    shape: [-4, -2, -1, 0, 0, 0, 0, 0, -1, -1, -1, -1, -2, -2, -2, -3, -3, -4, -5, -6, -8, -10, -13, -17],
    refSpl: 95, crestFactorDb: 12,
    notes: 'Roughly pink. Mixing at 85 dB(A) is common; 95 dB SPL peaks are normal.',
  },
  'subwoofer-music': {
    id: 'subwoofer-music', name: 'Music with subwoofer (club level)', category: 'Playback',
    shape: [8, 10, 9, 6, 3, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -11, -13, -15, -18, -21, -25, -29, -33],
    refSpl: 110, crestFactorDb: 10,
    notes: 'The worst realistic case for a domestic booth. If your design survives this, it survives anything.',
  },
  'pink-noise': {
    id: 'pink-noise', name: 'Pink noise (test signal)', category: 'Test',
    shape: new Array(24).fill(0),
    refSpl: 100, crestFactorDb: 4,
    notes: 'Equal energy per octave band. Use this to read the enclosure\'s raw transmission loss directly.',
  },
  'white-noise': {
    id: 'white-noise', name: 'White noise (test signal)', category: 'Test',
    // Constant energy per Hz: band energy doubles each octave, so +1 dB per 1/3-octave.
    shape: Array.from({ length: 24 }, (_, i) => i - 12),
    refSpl: 100, crestFactorDb: 4,
    notes: 'Rises 3 dB per octave (1 dB per 1/3-octave). Emphasises the high end where walls are strongest.',
  },
  'speech-tv': {
    id: 'speech-tv', name: 'Television / dialogue at normal volume', category: 'Playback',
    shape: [-14, -10, -6, -2, 0, 1, 1, 1, 0, 0, -1, -2, -3, -4, -6, -8, -10, -12, -15, -18, -22, -26, -30, -34],
    refSpl: 70, crestFactorDb: 14,
    notes: 'Useful as the *receiving* room source when checking whether a neighbour\'s TV masks your booth leakage.',
  },
};

/**
 * Build a 24-band absolute SPL spectrum for a source at a chosen overall level.
 * @param {SoundSource} src
 * @param {number} targetLevel  desired overall level
 * @param {'Z'|'A'} weighting   whether targetLevel is unweighted or A-weighted
 * @param {number[]} aWeights
 */
export function sourceSpectrum(src, targetLevel, weighting = 'Z', aWeights = null) {
  const shape = src.shape;
  // Level of the raw shape
  let sum = 0;
  for (let i = 0; i < shape.length; i++) {
    const w = weighting === 'A' && aWeights ? aWeights[i] : 0;
    sum += Math.pow(10, (shape[i] + w) / 10);
  }
  const shapeLevel = 10 * Math.log10(sum);
  const offset = targetLevel - shapeLevel;
  return shape.map((v) => v + offset);
}

/** Sources grouped by category for the UI. */
export function sourcesByCategory() {
  /** @type {Record<string, SoundSource[]>} */
  const out = {};
  for (const s of Object.values(SOURCES)) (out[s.category] ||= []).push(s);
  return out;
}

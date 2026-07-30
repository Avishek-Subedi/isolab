/**
 * Receiving-environment presets.
 *
 * The same booth produces very different "how loud is it outside" answers
 * depending on where the listener is. Three things matter:
 *   1. the receiving room's absorption (a bare stairwell is 8 dB louder than
 *      a carpeted bedroom for the same transmitted power)
 *   2. the distance and whether the listener is in the direct or reverberant field
 *   3. the background noise already present, which sets audibility
 *
 * Background spectra are indicative measured L90 values.
 * BANDS: 50 63 80 100 125 160 200 250 315 400 500 630 800 1k 1k25 1k6 2k 2k5 3k15 4k 5k 6k3 8k 10k
 */

/**
 * @typedef {Object} Environment
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {'room'|'freefield'} receiverType
 * @property {number} [volumeM3]
 * @property {number} [surfaceAreaM2]
 * @property {number} [alphaBar]         mean absorption coefficient
 * @property {number[]} background       24-band L90 background SPL
 * @property {number} defaultDistanceM
 * @property {number} directivity        Q at the receiver position (2 = on floor, 4 = wall/floor, 8 = corner)
 * @property {number} [flankingPenaltyDb] extra transmission through the building structure
 * @property {string} notes
 */

/** @type {Record<string, Environment>} */
export const ENVIRONMENTS = {
  'bedroom-rented': {
    id: 'bedroom-rented', name: 'Bedroom in a rented flat (booth in the room)', category: 'Residential',
    receiverType: 'room', volumeM3: 33, surfaceAreaM2: 62, alphaBar: 0.16,
    background: [34, 32, 30, 28, 26, 24, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5],
    defaultDistanceM: 1.5, directivity: 2, flankingPenaltyDb: 0,
    notes: 'A 4.0 x 3.0 x 2.75 m room with a bed, curtains and a rug. This is the level in the room the booth stands in — usually the least critical receiver.',
  },
  'apartment-neighbour': {
    id: 'apartment-neighbour', name: 'Neighbour through a party wall', category: 'Residential',
    receiverType: 'room', volumeM3: 40, surfaceAreaM2: 70, alphaBar: 0.14,
    background: [30, 28, 26, 24, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
    defaultDistanceM: 3.0, directivity: 2, flankingPenaltyDb: 0,
    notes: 'Their room, their quiet. Note the low background at night — 16 dB at 500 Hz means even 25 dB of leakage is clearly audible. The party wall itself adds its own transmission loss, set separately.',
  },
  'apartment-below': {
    id: 'apartment-below', name: 'Neighbour below (through the floor)', category: 'Residential',
    receiverType: 'room', volumeM3: 40, surfaceAreaM2: 70, alphaBar: 0.14,
    background: [30, 28, 26, 24, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
    defaultDistanceM: 3.0, directivity: 2, flankingPenaltyDb: 4,
    notes: 'The hardest neighbour to satisfy: structure-borne transmission through the floor dominates and mass alone will not fix it. Expect the floating floor to be the deciding component.',
  },
  'hallway-shared': {
    id: 'hallway-shared', name: 'Shared hallway / stairwell', category: 'Residential',
    receiverType: 'room', volumeM3: 60, surfaceAreaM2: 110, alphaBar: 0.06,
    background: [32, 30, 28, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6],
    defaultDistanceM: 2.0, directivity: 2,
    notes: 'Hard surfaces everywhere, so alpha is very low and the reverberant level is high. Leakage into a stairwell sounds much louder than the same power into a furnished room.',
  },
  'studio-live-room': {
    id: 'studio-live-room', name: 'Studio live room (booth inside it)', category: 'Studio',
    receiverType: 'room', volumeM3: 90, surfaceAreaM2: 130, alphaBar: 0.30,
    background: [26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2],
    defaultDistanceM: 2.0, directivity: 2,
    notes: 'Well treated, so the reverberant contribution is low. The background is a genuine studio noise floor around NR 20.',
  },
  'control-room': {
    id: 'control-room', name: 'Control room (mic bleed check)', category: 'Studio',
    receiverType: 'room', volumeM3: 55, surfaceAreaM2: 90, alphaBar: 0.35,
    background: [24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3],
    defaultDistanceM: 2.5, directivity: 2,
    notes: 'Use this when the question is "will the drummer bleed into the vocal take", not "will the neighbours complain".',
  },
  'office-open': {
    id: 'office-open', name: 'Open-plan office', category: 'Commercial',
    receiverType: 'room', volumeM3: 400, surfaceAreaM2: 420, alphaBar: 0.22,
    background: [40, 38, 37, 36, 36, 35, 35, 34, 34, 33, 33, 32, 31, 30, 29, 28, 26, 25, 23, 21, 19, 17, 15, 13],
    defaultDistanceM: 3.0, directivity: 2,
    notes: 'A relatively forgiving receiver: the HVAC and activity background around 40 dB(A) masks a lot. A pod that measures 45 dB(A) outside can still be perfectly acceptable here.',
  },
  'office-private': {
    id: 'office-private', name: 'Private office next door', category: 'Commercial',
    receiverType: 'room', volumeM3: 45, surfaceAreaM2: 78, alphaBar: 0.20,
    background: [34, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 13, 11, 9, 7, 5],
    defaultDistanceM: 2.5, directivity: 2,
    notes: 'Speech privacy is usually the criterion here rather than annoyance — the target is that words are unintelligible, not that nothing is heard.',
  },
  'outdoor-garden': {
    id: 'outdoor-garden', name: 'Outdoors — garden / neighbour boundary', category: 'Outdoor',
    receiverType: 'freefield',
    background: [36, 34, 32, 30, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 12, 10, 8, 6, 4],
    defaultDistanceM: 5.0, directivity: 2,
    notes: 'No reverberant build-up, so level falls 6 dB per doubling of distance. A garden studio is much easier than an indoor booth for this reason.',
  },
  'outdoor-street': {
    id: 'outdoor-street', name: 'Outdoors — urban street', category: 'Outdoor',
    receiverType: 'freefield',
    background: [52, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 38, 37, 35, 33, 31, 29, 27, 25, 22, 19, 16, 13],
    defaultDistanceM: 5.0, directivity: 2,
    notes: 'Traffic background masks a great deal. Note the low-frequency dominance — your booth\'s bass leakage is the part that will still stand out.',
  },
  'garage-workshop': {
    id: 'garage-workshop', name: 'Garage / workshop', category: 'Other',
    receiverType: 'room', volumeM3: 60, surfaceAreaM2: 100, alphaBar: 0.08,
    background: [34, 32, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 11, 9, 7, 5],
    defaultDistanceM: 2.0, directivity: 2,
    notes: 'Bare masonry and a concrete floor: low absorption means a high reverberant level, but also usually no-one to annoy.',
  },
};

/**
 * Party-wall / separating-element presets, applied *after* the booth for the
 * neighbour scenarios. These are the building's own construction, which the
 * booth designer does not control but must account for.
 */
export const SEPARATING_ELEMENTS = {
  none: { id: 'none', label: 'No separating element (same room)', rw: 0, tl: null },
  'stud-partition': { id: 'stud-partition', label: 'Timber stud partition, single board each side (Rw 34)', rw: 34 },
  'blockwork-100': { id: 'blockwork-100', label: '100 mm dense blockwork, plastered (Rw 45)', rw: 45 },
  'brick-215': { id: 'brick-215', label: '215 mm brick party wall, plastered (Rw 53)', rw: 53 },
  'concrete-200': { id: 'concrete-200', label: '200 mm concrete party wall (Rw 57)', rw: 57 },
  'twin-block': { id: 'twin-block', label: 'Twin-leaf blockwork with cavity (Rw 60)', rw: 60 },
  'timber-floor': { id: 'timber-floor', label: 'Timber joist floor, plasterboard ceiling (Rw 40)', rw: 40 },
  'concrete-floor': { id: 'concrete-floor', label: '200 mm concrete slab with screed (Rw 55)', rw: 55 },
};

/**
 * Expand a single-number Rw into a plausible 24-band TL curve by fitting the
 * ISO 717 reference contour shape. Used only for building elements the user
 * has not modelled in detail.
 * @param {number} rw
 */
export function tlFromRw(rw) {
  // Reference contour shape (100 Hz - 3150 Hz), extended to 50 Hz-10 kHz.
  const shape = [-25, -22, -19, -19, -16, -13, -10, -7, -4, -1, 0, 1, 2, 3, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6];
  return shape.map((s) => Math.max(0, rw + s));
}

/**
 * Wall / floor / ceiling assembly presets and door presets.
 *
 * These are real, buildable constructions with published or well-established
 * laboratory ratings, which double as the validation targets in tests/.
 */

import { MATERIALS as M } from './materials.mjs';
import { CONNECTIONS } from '../core/partition.mjs';
import { PERIMETER_SEALS, THRESHOLD_SEALS } from '../core/door.mjs';

const L = (id, mm, extra = {}) => ({ material: M[id], thicknessMm: mm, ...extra });

/**
 * @typedef {Object} AssemblyPreset
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {number} [labStc]  published laboratory STC, for validation
 * @property {number} [labRw]
 * @property {(area:number)=>import('../core/partition.mjs').Partition} build
 * @property {string} notes
 */

/** @type {Record<string, AssemblyPreset>} */
export const WALL_PRESETS = {
  /* ---------------- Single leaf ---------------- */
  'ply-18': {
    id: 'ply-18', name: '18 mm plywood, single skin', category: 'Single leaf', labStc: 26,
    build: (a) => ({ leaves: [{ layers: [L('plywood', 18)], widthM: 1.2, heightM: 2.4 }], cavities: [], connection: CONNECTIONS.none, areaM2: a }),
    notes: 'The typical "I built a box out of ply" starting point. About 11 kg/m². Works acoustically like a single sheet of plasterboard and has a coincidence dip right in the vocal range.',
  },
  'gypsum-125': {
    id: 'gypsum-125', name: '12.5 mm plasterboard, single skin', category: 'Single leaf', labStc: 28,
    build: (a) => ({ leaves: [{ layers: [L('gypsum', 12.5)], widthM: 1.2, heightM: 2.4 }], cavities: [], connection: CONNECTIONS.none, areaM2: a }),
    notes: 'Reference case for mass law: 8.75 kg/m², about 27 dB at 500 Hz.',
  },
  'mdf-18-ply-18': {
    id: 'mdf-18-ply-18', name: '18 mm MDF + 18 mm plywood, bonded', category: 'Single leaf', labStc: 33,
    build: (a) => ({ leaves: [{ layers: [L('mdf', 18), L('plywood', 18)], bonding: 'screwed', widthM: 1.2, heightM: 2.4 }], cavities: [], connection: CONNECTIONS.none, areaM2: a }),
    notes: 'Two dissimilar sheets screwed together: 24 kg/m² and the two coincidence dips do not coincide.',
  },
  'concrete-200': {
    id: 'concrete-200', name: '200 mm dense concrete', category: 'Single leaf', labStc: 56,
    build: (a) => ({ leaves: [{ layers: [L('concrete', 200)], widthM: 3, heightM: 2.6 }], cavities: [], connection: CONNECTIONS.none, areaM2: a }),
    notes: '460 kg/m². Single-leaf mass done properly. Note the low coincidence frequency around 120 Hz.',
  },

  /* ---------------- Double leaf, timber stud ---------------- */
  'stud-single-empty': {
    id: 'stud-single-empty', name: '2x4 timber studs, one 12.5 mm board each side, empty', category: 'Timber stud', labStc: 34,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5)], widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 12.5)], widthM: 0.4, heightM: 2.4 }],
      cavities: [{ depthMm: 89, fill: null, fillThicknessMm: 0 }],
      connection: CONNECTIONS['rigid-stud'], areaM2: a,
    }),
    notes: 'The standard domestic partition. Published STC 33-34.',
  },
  'stud-single-insulated': {
    id: 'stud-single-insulated', name: '2x4 timber studs, one board each side, insulated', category: 'Timber stud', labStc: 38,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5)], widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 12.5)], widthM: 0.4, heightM: 2.4 }],
      cavities: [{ depthMm: 89, fill: M['rockwool-flexi'], fillThicknessMm: 75 }],
      connection: CONNECTIONS['rigid-stud'], areaM2: a,
    }),
    notes: 'Adding insulation to the same wall is worth 4-5 dB. Published STC 36-39.',
  },
  'stud-double-board': {
    id: 'stud-double-board', name: '2x4 timber studs, two 12.5 mm boards each side, insulated', category: 'Timber stud', labStc: 43,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }],
      cavities: [{ depthMm: 89, fill: M['rockwool-flexi'], fillThicknessMm: 75 }],
      connection: CONNECTIONS['rigid-stud'], areaM2: a,
    }),
    notes: 'Doubling the boards on rigid studs. Diminishing returns set in because the studs now dominate. Published STC 42-45.',
  },
  'stud-damped': {
    id: 'stud-damped', name: '2x4 studs, two boards each side with damping compound', category: 'Timber stud', labStc: 51,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'damped', widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'damped', widthM: 0.4, heightM: 2.4 }],
      cavities: [{ depthMm: 89, fill: M['rockwool-flexi'], fillThicknessMm: 75 }],
      connection: CONNECTIONS['rigid-stud'], areaM2: a,
    }),
    notes: 'Same wall plus viscoelastic compound between the board layers. Published STC 50-54 — the best value upgrade available on a rigid stud wall.',
  },
  'resilient-channel': {
    id: 'resilient-channel', name: '2x4 studs, resilient bar one side, two boards, insulated', category: 'Timber stud', labStc: 50,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.6, heightM: 2.4 }],
      cavities: [{ depthMm: 102, fill: M['rockwool-flexi'], fillThicknessMm: 75 }],
      connection: CONNECTIONS['resilient-channel'], areaM2: a,
    }),
    notes: 'Resilient bar decouples one leaf. Published STC 47-52. Very sensitive to installation: one screw hitting a stud through the bar short-circuits the whole wall.',
  },
  'staggered-stud': {
    id: 'staggered-stud', name: 'Staggered studs on a common plate, insulated', category: 'Timber stud', labStc: 49,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }],
      cavities: [{ depthMm: 140, fill: M['rockwool-flexi'], fillThicknessMm: 100 }],
      connection: CONNECTIONS['staggered-stud'], areaM2: a,
    }),
    notes: 'No stud touches both leaves, but the shared top and bottom plates still bridge. Published STC 47-50.',
  },

  /* ---------------- Steel stud ---------------- */
  'steel-stud-double': {
    id: 'steel-stud-double', name: '92 mm steel C-studs, two 15 mm boards each side, insulated', category: 'Steel stud', labStc: 52,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum-acoustic', 15), L('gypsum-acoustic', 15)], bonding: 'screwed', widthM: 0.6, heightM: 2.4 }, { layers: [L('gypsum-acoustic', 15), L('gypsum-acoustic', 15)], bonding: 'screwed', widthM: 0.6, heightM: 2.4 }],
      cavities: [{ depthMm: 92, fill: M['rockwool-rwa45'], fillThicknessMm: 75 }],
      connection: CONNECTIONS['steel-stud'], areaM2: a,
    }),
    notes: 'The thin steel web flexes, so a steel stud is worth 3-6 dB over timber for the same build-up. Published Rw 52-55.',
  },

  /* ---------------- Decoupled ---------------- */
  'clips-hat-channel': {
    id: 'clips-hat-channel', name: 'Isolation clips + hat channel, two boards each side', category: 'Decoupled', labStc: 58,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 15), L('gypsum', 15)], bonding: 'damped', widthM: 0.6, heightM: 2.4 }, { layers: [L('gypsum', 15), L('gypsum', 15)], bonding: 'damped', widthM: 0.6, heightM: 2.4 }],
      cavities: [{ depthMm: 140, fill: M['rockwool-rwa45'], fillThicknessMm: 100 }],
      connection: CONNECTIONS['isolation-clip'], areaM2: a,
    }),
    notes: 'Rubber clips carrying a hat channel. Published STC 56-60. The best performance per millimetre of wall thickness.',
  },
  'double-stud': {
    id: 'double-stud', name: 'Double timber stud, fully separate frames, insulated', category: 'Decoupled', labStc: 59,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 15), L('gypsum', 15)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }, { layers: [L('gypsum', 15), L('gypsum', 15)], bonding: 'screwed', widthM: 0.4, heightM: 2.4 }],
      cavities: [{ depthMm: 190, fill: M['rockwool-rwa45'], fillThicknessMm: 150 }],
      connection: CONNECTIONS['separate-frame'], areaM2: a,
    }),
    notes: 'Two independent walls with a 25 mm air gap between the frames. Published STC 55-63 depending on gap. The only reliable way past STC 55 in timber.',
  },
  'room-in-room': {
    id: 'room-in-room', name: 'Room-in-room: separate frame, triple board, deep cavity', category: 'Decoupled', labStc: 68,
    build: (a) => ({
      leaves: [
        { layers: [L('gypsum', 15), L('gypsum', 15), L('plywood', 18)], bonding: 'damped', widthM: 0.4, heightM: 2.4 },
        { layers: [L('gypsum', 15), L('gypsum', 15), L('plywood', 18)], bonding: 'damped', widthM: 0.4, heightM: 2.4 },
      ],
      cavities: [{ depthMm: 250, fill: M['rockwool-rwa45'], fillThicknessMm: 200 }],
      connection: CONNECTIONS.none, areaM2: a,
    }),
    notes: 'A genuine room within a room, structurally independent including the floor. STC 65-72 in the lab. In the field, flanking through the building sets the ceiling — usually around 65.',
  },

  /* ---------------- Booth-scale builds ---------------- */
  'booth-budget': {
    id: 'booth-budget', name: 'Booth — budget: 18 mm MDF, 50 mm wool, 12.5 mm board', category: 'Booth', labStc: 40,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5)], widthM: 0.6, heightM: 2.0 }, { layers: [L('mdf', 18)], widthM: 0.6, heightM: 2.0 }],
      cavities: [{ depthMm: 63, fill: M['rockwool-rwa45'], fillThicknessMm: 50 }],
      connection: CONNECTIONS['rigid-stud'], areaM2: a,
    }),
    notes: 'A realistic first vocal booth on 63 mm CLS studs. Fine for speech, will not contain a scream to a neighbour standard.',
  },
  'booth-mid': {
    id: 'booth-mid', name: 'Booth — mid: 2x12.5 board + damping, 100 mm wool, 18 mm MDF', category: 'Booth', labStc: 50,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 12.5), L('gypsum', 12.5)], bonding: 'damped', widthM: 0.6, heightM: 2.0 }, { layers: [L('mdf', 18), L('gypsum', 12.5)], bonding: 'screwed', widthM: 0.6, heightM: 2.0 }],
      cavities: [{ depthMm: 100, fill: M['rockwool-rwa45'], fillThicknessMm: 75 }],
      connection: CONNECTIONS['resilient-channel'], areaM2: a,
    }),
    notes: 'The sweet spot for a home vocal booth: resilient bar, damped double board, decent cavity.',
  },
  'booth-pro': {
    id: 'booth-pro', name: 'Booth — pro: clips, 2x15 board + damping, 140 mm wool, 2x15 board', category: 'Booth', labStc: 58,
    build: (a) => ({
      leaves: [{ layers: [L('gypsum', 15), L('gypsum', 15)], bonding: 'damped', widthM: 0.6, heightM: 2.1 }, { layers: [L('gypsum', 15), L('plywood', 18)], bonding: 'damped', widthM: 0.6, heightM: 2.1 }],
      cavities: [{ depthMm: 140, fill: M['rockwool-rwa45'], fillThicknessMm: 100 }],
      connection: CONNECTIONS['isolation-clip'], areaM2: a,
    }),
    notes: 'Commercial vocal-booth standard. Expect STC 56-60 in the lab and 50-55 as built, limited by the door and the vent.',
  },
};

/** @type {Record<string, any>} */
export const DOOR_PRESETS = {
  hollow: {
    id: 'hollow', name: 'Hollow-core internal door, unsealed', labStc: 19,
    build: () => ({
      id: 'door', label: 'Hollow-core door',
      widthM: 0.838, heightM: 1.981,
      leaf: { layers: [L('plywood', 4), L('air', 27), L('plywood', 4)], bonding: 'screwed' },
      perimeterSeal: PERIMETER_SEALS.none, thresholdSeal: THRESHOLD_SEALS.undercut, frameSealed: false,
    }),
    notes: 'About 8 kg/m² of actual mass in the skins with a hollow core. Worth roughly 19 dB with a good seal, and about 14 dB as normally hung. The single worst component in most builds.',
  },
  'solid-core': {
    id: 'solid-core', name: '44 mm solid-core door, basic seals', labStc: 27,
    build: () => ({
      id: 'door', label: 'Solid-core door',
      widthM: 0.838, heightM: 1.981,
      leaf: { layers: [L('chipboard', 40), L('plywood', 4)], bonding: 'screwed' },
      perimeterSeal: PERIMETER_SEALS['foam-tape'], thresholdSeal: THRESHOLD_SEALS['brush-strip'], frameSealed: true,
    }),
    notes: '44 mm particle-core door, about 29 kg/m². Capable of 30 dB but the seals decide.',
  },
  'mdf-heavy': {
    id: 'mdf-heavy', name: 'Shop-built 2x18 mm MDF door, good seals', labStc: 32,
    build: () => ({
      id: 'door', label: 'Shop-built MDF door',
      widthM: 0.838, heightM: 1.981,
      leaf: { layers: [L('mdf', 18), L('damping-compound', 1), L('mdf', 18)], bonding: 'damped' },
      perimeterSeal: PERIMETER_SEALS['rubber-bulb'], thresholdSeal: THRESHOLD_SEALS['rubber-blade'], frameSealed: true,
    }),
    notes: 'Two sheets of MDF with damping compound between them, 27 kg/m². The best DIY door available; needs heavy hinges and an adjustable rebate.',
  },
  'acoustic-45': {
    id: 'acoustic-45', name: 'Proprietary acoustic door set, Rw 40', labStc: 40,
    build: () => ({
      id: 'door', label: 'Acoustic door set Rw 40',
      widthM: 0.838, heightM: 1.981,
      leaf: { layers: [L('gypsum-fibre', 12), L('chipboard', 30), L('steel', 0.7), L('gypsum-fibre', 12)], bonding: 'damped' },
      perimeterSeal: PERIMETER_SEALS.compression, thresholdSeal: THRESHOLD_SEALS['drop-seal'], frameSealed: true,
    }),
    notes: 'Factory-built, tested as a set with its frame and seals. About 55 kg/m². This is the point at which the door stops being the weakest path.',
  },
  'acoustic-54': {
    id: 'acoustic-54', name: 'Studio acoustic door set, Rw 47', labStc: 47,
    build: () => ({
      id: 'door', label: 'Studio acoustic door set Rw 47',
      widthM: 0.838, heightM: 2.04,
      leaf: { layers: [L('gypsum-fibre', 15), L('chipboard', 38), L('steel', 1.0), L('mlv', 2.6), L('gypsum-fibre', 15)], bonding: 'damped' },
      perimeterSeal: PERIMETER_SEALS['double-compression'], thresholdSeal: THRESHOLD_SEALS['drop-seal-double'], frameSealed: true,
      costOverride: 2400,
    }),
    notes: '70+ kg/m², twin compression gaskets, rebated threshold. Around £2,400 fitted.',
  },
  'double-airlock': {
    id: 'double-airlock', name: 'Two solid doors with a 600 mm air lock', labStc: 52,
    build: () => ({
      id: 'door', label: 'Twin doors + air lock',
      widthM: 0.838, heightM: 1.981,
      leaf: { layers: [L('mdf', 18), L('damping-compound', 1), L('mdf', 18)], bonding: 'damped' },
      perimeterSeal: PERIMETER_SEALS.compression, thresholdSeal: THRESHOLD_SEALS['drop-seal'], frameSealed: true,
      airlockDepthM: 0.6,
      secondDoor: {
        id: 'door2', label: 'Outer door',
        widthM: 0.838, heightM: 1.981,
        leaf: { layers: [L('mdf', 18), L('damping-compound', 1), L('mdf', 18)], bonding: 'damped' },
        perimeterSeal: PERIMETER_SEALS.compression, thresholdSeal: THRESHOLD_SEALS['drop-seal'], frameSealed: true,
      },
    }),
    notes: 'Two ordinary good doors in series beat one expensive one, and cost less. The air lock must be lined with absorption and its walls must be as good as the booth wall.',
  },
};

/** Floor build-ups. */
export const FLOOR_PRESETS = {
  direct: { id: 'direct', name: 'Booth sits directly on the existing floor', mounting: 'direct-on-timber', deck: null },
  'rubber-feet': { id: 'rubber-feet', name: 'Rubber feet under the frame', mounting: 'feet-on-timber', deck: null },
  'rubber-mat': { id: 'rubber-mat', name: 'Continuous rubber mat under the footprint', mounting: 'mat-on-timber', deck: null },
  'floating-wool': {
    id: 'floating-wool', name: 'Floating deck on 50 mm mineral wool raft', mounting: 'floating-raft-timber',
    deck: { layers: [L('plywood', 18), L('gypsum-fibre', 15), L('plywood', 18)], bonding: 'screwed' },
  },
  'floating-heavy': {
    id: 'floating-heavy', name: 'Floating deck: 50 mm wool + ply + 50 mm screed', mounting: 'floating-raft-slab',
    deck: { layers: [L('plywood', 18), L('screed', 50)], bonding: 'laminated' },
  },
  'spring-raft': {
    id: 'spring-raft', name: 'Spring-mounted concrete raft', mounting: 'springs-on-slab',
    deck: { layers: [L('concrete', 100)], bonding: 'laminated' },
  },
};

/** Ceiling build-ups. */
export const CEILING_PRESETS = {
  direct: { id: 'direct', name: 'Boards screwed straight to the booth frame', connection: 'rigid-stud' },
  resilient: { id: 'resilient', name: 'Resilient bar under the frame', connection: 'resilient-channel' },
  clips: { id: 'clips', name: 'Isolation clips + hat channel', connection: 'isolation-clip' },
  springs: { id: 'springs', name: 'Spring hangers, independent ceiling', connection: 'spring-hanger' },
};

/**
 * Design builders and complete scenario presets.
 */

import { WALL_PRESETS, DOOR_PRESETS, FLOOR_PRESETS, CEILING_PRESETS } from './assemblies.mjs';
import { DUCT_PRESETS } from '../core/duct.mjs';
import { MATERIALS } from './materials.mjs';
import { CONNECTIONS } from '../core/partition.mjs';

/**
 * Build a partition from an explicit layer specification.
 *
 * This is what the visual builder edits: rather than picking a named preset,
 * the user chooses the material and thickness of each leaf, the cavity depth
 * and its fill, and how the two leaves are connected. Every one of those is a
 * real input to the physics, so the 3D editor drives the engine directly
 * instead of mapping onto a fixed catalogue.
 *
 * @param {{leafA:{materialId:string,thicknessMm:number,layers?:number},
 *          leafB?:{materialId:string,thicknessMm:number,layers?:number},
 *          cavity?:{depthMm:number,fillId:string|null,fillFraction?:number},
 *          connection?:string, bonding?:string}} c
 * @param {number} area
 */
export function buildCustomPartition(c, area) {
  const mk = (leaf) => {
    const m = MATERIALS[leaf.materialId] || MATERIALS.gypsum;
    const n = Math.max(1, leaf.layers || 1);
    return {
      layers: Array.from({ length: n }, () => ({ material: m, thicknessMm: leaf.thicknessMm })),
      bonding: c.bonding || (n > 1 ? 'screwed' : 'screwed'),
      widthM: 0.6, heightM: 2.4,
    };
  };
  const leaves = [mk(c.leafA)];
  const cavities = [];
  if (c.leafB) {
    leaves.push(mk(c.leafB));
    const cav = c.cavity || { depthMm: 50, fillId: null };
    const fill = cav.fillId ? MATERIALS[cav.fillId] : null;
    cavities.push({
      depthMm: cav.depthMm,
      fill,
      fillThicknessMm: fill ? cav.depthMm * (cav.fillFraction ?? 0.7) : 0,
    });
  }
  const label = c.leafB
    ? `${MATERIALS[c.leafA.materialId]?.name || '?'} + ${c.cavity?.depthMm ?? 50} mm cavity + ${MATERIALS[c.leafB.materialId]?.name || '?'}`
    : `${MATERIALS[c.leafA.materialId]?.name || '?'} ${c.leafA.thicknessMm} mm`;
  return {
    leaves, cavities,
    connection: CONNECTIONS[c.connection || 'rigid-stud'] || CONNECTIONS['rigid-stud'],
    areaM2: area, label, custom: c,
  };
}

/**
 * Build a design from a compact specification. Everything has a sensible
 * default so a caller can override only what they care about.
 *
 * @param {Object} spec
 * @returns {import('../core/solver.mjs').Design}
 */
export function buildDesign(spec = {}) {
  const s = {
    name: 'Untitled booth',
    L: 1.2, W: 1.2, H: 2.1,
    wall: 'booth-mid',
    ceiling: null,          // defaults to the wall assembly
    floorAssembly: null,    // defaults to the wall assembly
    door: 'solid-core',
    doorHost: 'front',
    ventPreset: 'flex-2bend',
    ventAirflowLps: 12,
    ventCount: 2,
    fanSwl: 55,
    mounting: 'direct-on-timber',
    gaps: [],
    treatment: { materialId: 'rockwool-rwa45', thicknessMm: 50, coverage: 70 },
    sourceId: 'scream',
    level: 100,
    weighting: 'Z',
    sourceMode: 'internal-spl',
    envId: 'bedroom-rented',
    distanceM: 1.0,
    separatingElementId: 'none',
    occupants: 1,
    windows: [],
    /** Per-surface overrides: { front: 'preset-id' | {custom spec}, ... } */
    surfaceOverrides: {},
    ...spec,
  };

  const wallPreset = WALL_PRESETS[s.wall] || WALL_PRESETS['booth-mid'];
  const mk = (preset, area, label) => {
    const p = preset.build(area);
    return { ...p, label: label || preset.name, presetId: preset.id };
  };

  const areas = {
    front: s.W * s.H, back: s.W * s.H,
    left: s.L * s.H, right: s.L * s.H,
    ceiling: s.L * s.W, floor: s.L * s.W,
  };

  const ceilPreset = s.ceiling ? WALL_PRESETS[s.ceiling] : wallPreset;
  const floorPreset = s.floorAssembly ? WALL_PRESETS[s.floorAssembly] : wallPreset;

  const surfaces = {
    front: mk(wallPreset, areas.front),
    back: mk(wallPreset, areas.back),
    left: mk(wallPreset, areas.left),
    right: mk(wallPreset, areas.right),
    ceiling: mk(ceilPreset, areas.ceiling),
    floor: mk(floorPreset, areas.floor),
  };

  // Per-surface overrides from the visual builder take precedence over the
  // global wall/ceiling/floor choice, so a single wall can differ from the rest.
  for (const [key, ov] of Object.entries(s.surfaceOverrides || {})) {
    if (!ov || !(key in surfaces)) continue;
    if (typeof ov === 'string') {
      const p = WALL_PRESETS[ov];
      if (p) surfaces[key] = mk(p, areas[key]);
    } else {
      surfaces[key] = buildCustomPartition(ov, areas[key]);
    }
  }

  // Ceiling connection override from the ceiling preset list
  if (s.ceilingMount && CEILING_PRESETS[s.ceilingMount]) {
    surfaces.ceiling.connection = CONNECTIONS[CEILING_PRESETS[s.ceilingMount].connection] || surfaces.ceiling.connection;
  }

  const doors = [];
  if (s.door && DOOR_PRESETS[s.door]) {
    const dp = DOOR_PRESETS[s.door];
    doors.push({ ...dp.build(), host: s.doorHost, presetId: dp.id, label: dp.name });
  }

  const vents = [];
  if (s.ventPreset && DUCT_PRESETS[s.ventPreset]) {
    const vp = DUCT_PRESETS[s.ventPreset];
    vents.push({
      ...vp, label: vp.label + ' (supply)', count: 1, host: 'ceiling',
      airflowLps: s.ventAirflowLps, fanSwl: s.fanSwl,
      wallMaterial: MATERIALS.steel, wallThicknessMm: 0.5,
    });
    if (s.ventCount > 1) {
      vents.push({
        ...vp, label: vp.label + ' (extract)', count: s.ventCount - 1, host: 'ceiling',
        airflowLps: s.ventAirflowLps, fanSwl: s.fanSwl,
        wallMaterial: MATERIALS.steel, wallThicknessMm: 0.5,
      });
    }
  }

  const floorPresetObj = FLOOR_PRESETS[s.floorSystem] || null;

  return {
    name: s.name,
    geometry: { internalL: s.L, internalW: s.W, internalH: s.H },
    surfaces,
    doors,
    windows: s.windows,
    vents,
    gaps: s.gaps,
    occupants: s.occupants,
    mounting: { mountingId: floorPresetObj ? floorPresetObj.mounting : s.mounting, deck: floorPresetObj?.deck || null, presetId: s.floorSystem },
    internalTreatment: s.treatment,
    source: {
      sourceId: s.sourceId, level: s.level, weighting: s.weighting,
      mode: s.sourceMode, customSpectrum: s.customSpectrum,
    },
    receiver: {
      envId: s.envId, distanceM: s.distanceM,
      separatingElementId: s.separatingElementId,
    },
    calibration: s.calibration || {},
    _spec: s,
  };
}

/** Realistic end-to-end scenarios (Part 11). */
export const SCENARIOS = {
  'bedroom-diy': {
    id: 'bedroom-diy', name: 'DIY vocal booth in a rented bedroom',
    description: 'The classic first build: a 1.2 x 1.2 m plywood-and-MDF box in the corner of a rented bedroom, with a normal internal door and a hole in the wall for ventilation. Screaming at 100 dB inside.',
    spec: {
      name: 'DIY vocal booth', L: 1.2, W: 1.2, H: 2.1,
      wall: 'booth-budget', door: 'hollow', ventPreset: 'straight-unlined',
      mounting: 'direct-on-timber', ventAirflowLps: 8, ventCount: 1,
      gaps: [
        { label: 'Wall/floor junction, unsealed', shape: 'slit', widthMm: 2, lengthMm: 4800, depthMm: 80, host: 'floor' },
        { label: 'Unsealed socket back-box', shape: 'hole', widthMm: 60, depthMm: 35, host: 'left' },
      ],
      treatment: { materialId: 'acoustic-foam', thicknessMm: 50, coverage: 60 },
      sourceId: 'scream', level: 100, envId: 'bedroom-rented', distanceM: 1.0,
    },
  },
  'bedroom-good': {
    id: 'bedroom-good', name: 'Well-built vocal booth in a rented bedroom',
    description: 'Same room, same source, but built properly: resilient bar, damped double board, a shop-built MDF door with compression seals, and a lined labyrinth vent.',
    spec: {
      name: 'Good vocal booth', L: 1.4, W: 1.4, H: 2.1,
      wall: 'booth-mid', door: 'mdf-heavy', ventPreset: 'labyrinth',
      mounting: 'mat-on-timber', ventAirflowLps: 12, ventCount: 2,
      gaps: [{ label: 'Wall/floor junction, sealed', shape: 'slit', widthMm: 0.05, lengthMm: 5600, depthMm: 120, sealResistivity: 200000, sealFillFraction: 1, host: 'floor' }],
      treatment: { materialId: 'rockwool-rwa45', thicknessMm: 75, coverage: 80 },
      sourceId: 'scream', level: 100, envId: 'bedroom-rented', distanceM: 1.0,
    },
  },
  'apartment-neighbour': {
    id: 'apartment-neighbour', name: 'Booth in a flat — will the neighbour hear it?',
    description: 'A good booth in a flat, with the receiver in the neighbour\'s bedroom through a 215 mm brick party wall, at night when their background is 22 dB(A).',
    spec: {
      name: 'Flat booth vs neighbour', L: 1.5, W: 1.5, H: 2.1,
      wall: 'booth-pro', door: 'acoustic-45', ventPreset: 'silenced-pro',
      mounting: 'floating-raft-timber', floorSystem: 'floating-wool',
      ventAirflowLps: 14, ventCount: 2,
      treatment: { materialId: 'rockwool-rwa45', thicknessMm: 100, coverage: 85 },
      sourceId: 'singing-belting', level: 105,
      envId: 'apartment-neighbour', distanceM: 3.0, separatingElementId: 'brick-215',
    },
  },
  'studio-live-room': {
    id: 'studio-live-room', name: 'Drum booth inside a studio live room',
    description: 'A room-in-room drum booth. The question is mic bleed into the control room, not the neighbours.',
    spec: {
      name: 'Drum booth', L: 3.0, W: 2.6, H: 2.4,
      wall: 'room-in-room', door: 'double-airlock', ventPreset: 'silenced-pro',
      mounting: 'springs-on-slab', floorSystem: 'spring-raft',
      ventAirflowLps: 30, ventCount: 2, occupants: 1,
      windows: [{
        id: 'w1', label: 'Vision panel to control room', widthM: 1.2, heightM: 0.9, host: 'front', frameSealed: true, frameGapMm: 0.1,
        partition: {
          label: 'Twin 12.8 mm acoustic laminated, 150 mm gap',
          leaves: [
            { layers: [{ material: MATERIALS['glass-acoustic-laminated'], thicknessMm: 12.8 }], widthM: 1.2, heightM: 0.9 },
            { layers: [{ material: MATERIALS['glass-laminated'], thicknessMm: 8.8 }], widthM: 1.2, heightM: 0.9 },
          ],
          cavities: [{ depthMm: 150, fill: MATERIALS['rockwool-rwa45'], fillThicknessMm: 0 }],
          connection: CONNECTIONS.none, areaM2: 1.08,
        },
      }],
      treatment: { materialId: 'rockwool-rwa45', thicknessMm: 100, coverage: 75 },
      sourceId: 'drums_acoustic', level: 115,
      envId: 'control-room', distanceM: 2.5,
    },
  },
  'office-pod': {
    id: 'office-pod', name: 'Office phone booth / meeting pod',
    description: 'A demountable pod in an open-plan office. The criterion is speech privacy against a 40 dB(A) background, which is far more forgiving than a domestic scenario.',
    spec: {
      name: 'Office pod', L: 1.2, W: 1.0, H: 2.2,
      wall: 'booth-budget', door: 'solid-core', ventPreset: 'flex-2bend',
      mounting: 'mat-on-timber', ventAirflowLps: 10, ventCount: 2,
      windows: [{
        id: 'w1', label: 'Full-height glazed front', widthM: 0.9, heightM: 1.8, host: 'front', frameSealed: true, frameGapMm: 0.3,
        partition: {
          label: '10 mm laminated glass, single',
          leaves: [{ layers: [{ material: MATERIALS['glass-laminated'], thicknessMm: 10.8 }], widthM: 0.9, heightM: 1.8 }],
          cavities: [], connection: CONNECTIONS.none, areaM2: 1.62,
        },
      }],
      treatment: { materialId: 'acoustic-panel-fabric', thicknessMm: 50, coverage: 60 },
      sourceId: 'speech-raised', level: 72,
      envId: 'office-open', distanceM: 1.5,
    },
  },
  'garden-studio': {
    id: 'garden-studio', name: 'Garden studio vs the neighbour\'s boundary',
    description: 'A detached garden building. No shared structure, so no flanking, and free-field distance decay helps enormously.',
    spec: {
      name: 'Garden studio', L: 3.5, W: 3.0, H: 2.4,
      wall: 'double-stud', door: 'acoustic-45', ventPreset: 'labyrinth',
      mounting: 'direct-on-slab', ventAirflowLps: 25, ventCount: 2,
      treatment: { materialId: 'rockwool-rwa45', thicknessMm: 100, coverage: 60 },
      sourceId: 'drums_acoustic', level: 110,
      envId: 'outdoor-garden', distanceM: 8.0,
    },
  },
};

/** Instantiate a scenario. */
export function buildScenario(id) {
  const sc = SCENARIOS[id];
  if (!sc) throw new Error(`Unknown scenario: ${id}`);
  return buildDesign(sc.spec);
}

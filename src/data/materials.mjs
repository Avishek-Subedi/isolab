/**
 * Material database.
 *
 * Every entry carries the *physical* properties the engine needs, not a
 * pre-baked TL curve, so that any thickness and any layer combination can be
 * simulated rather than looked up.
 *
 * @typedef {Object} Material
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {'mass'|'porous'|'damping'|'membrane'|'structural'|'glazing'} role
 * @property {number} density            kg/m^3
 * @property {number} youngsModulus      Pa  (in-plane / flexural)
 * @property {number} poisson            -
 * @property {number} lossFactor         internal damping eta
 * @property {number} [flowResistivity]  Pa*s/m^2 — porous materials only
 * @property {number[]} [availableThicknessesMm]
 * @property {number} [costPerM2PerMm]   indicative UK retail, GBP
 * @property {number} [costPerM2Fixed]
 * @property {number} [maxThicknessMm]
 * @property {string} notes
 *
 * Sources: manufacturer data sheets, CIBSE Guide B, Bies & Hansen
 * "Engineering Noise Control" material tables, Cox & D'Antonio
 * "Acoustic Absorbers and Diffusers" for flow resistivities.
 * Costs are indicative UK retail, late 2025 / 2026, ex-VAT.
 */

/** @type {Record<string, Material>} */
export const MATERIALS = {
  /* ------------------------- Wood-based sheet ------------------------- */
  plywood: {
    id: 'plywood', name: 'Plywood (birch/softwood)', category: 'Wood', role: 'mass',
    density: 600, youngsModulus: 7.0e9, poisson: 0.30, lossFactor: 0.025,
    availableThicknessesMm: [6, 9, 12, 15, 18, 25], costPerM2PerMm: 0.87,
    notes: 'Stiff for its mass, so its coincidence dip lands in the speech range (about 1 kHz at 18 mm). Fine as a structural skin, mediocre as an isolation layer on its own.',
  },
  mdf: {
    id: 'mdf', name: 'MDF (medium-density fibreboard)', category: 'Wood', role: 'mass',
    density: 750, youngsModulus: 3.5e9, poisson: 0.25, lossFactor: 0.0260,
    availableThicknessesMm: [6, 9, 12, 15, 18, 22, 25, 30], costPerM2PerMm: 0.54,
    notes: 'Denser and less stiff than plywood, so more mass and a higher coincidence frequency. One of the best value mass layers for booths. Not moisture tolerant.',
  },
  osb: {
    id: 'osb', name: 'OSB3 (oriented strand board)', category: 'Wood', role: 'mass',
    density: 650, youngsModulus: 4.5e9, poisson: 0.30, lossFactor: 0.024,
    availableThicknessesMm: [9, 11, 15, 18, 22], costPerM2PerMm: 0.42,
    notes: 'Cheap structural sheathing with useful mass. Rough surface; usually paired with a smoother inner layer.',
  },
  chipboard: {
    id: 'chipboard', name: 'Particle board / chipboard', category: 'Wood', role: 'mass',
    density: 680, youngsModulus: 3.0e9, poisson: 0.25, lossFactor: 0.028,
    availableThicknessesMm: [12, 15, 18, 22, 25], costPerM2PerMm: 0.39,
    notes: 'Similar acoustically to MDF, slightly lighter. Good cheap mass.',
  },
  softwood: {
    id: 'softwood', name: 'Softwood timber (solid)', category: 'Wood', role: 'structural',
    density: 480, youngsModulus: 10.0e9, poisson: 0.30, lossFactor: 0.0150,
    availableThicknessesMm: [18, 22, 25, 38, 47, 63], costPerM2PerMm: 1.15,
    notes: 'Framing timber. Very stiff along the grain, which is why timber studs bridge a cavity so effectively — that stiffness is a liability for isolation.',
  },
  hardwood: {
    id: 'hardwood', name: 'Hardwood (oak/beech, solid)', category: 'Wood', role: 'mass',
    density: 720, youngsModulus: 13.0e9, poisson: 0.30, lossFactor: 0.012,
    availableThicknessesMm: [18, 22, 25, 32, 44], costPerM2PerMm: 4.5,
    notes: 'High mass but very stiff and lightly damped. Used for door leaves; benefits greatly from a bonded damping layer.',
  },

  /* ------------------------- Boards ------------------------- */
  gypsum: {
    id: 'gypsum', name: 'Gypsum plasterboard (standard)', category: 'Board', role: 'mass',
    density: 700, youngsModulus: 2.5e9, poisson: 0.30, lossFactor: 0.018,
    availableThicknessesMm: [9.5, 12.5, 15], costPerM2PerMm: 0.224,
    notes: 'The default mass layer worldwide. Low stiffness means a high coincidence frequency (about 2.6 kHz at 12.5 mm), which is exactly where you want it. Cheap, and two layers beat one thick one.',
  },
  'gypsum-acoustic': {
    id: 'gypsum-acoustic', name: 'Acoustic plasterboard (high density)', category: 'Board', role: 'mass',
    density: 900, youngsModulus: 2.8e9, poisson: 0.30, lossFactor: 0.02,
    availableThicknessesMm: [12.5, 15, 19], costPerM2PerMm: 0.327,
    notes: 'About 28% more mass than standard board for the same thickness. Worth the premium when wall thickness is constrained; otherwise two standard layers cost less per kg.',
  },
  'gypsum-fibre': {
    id: 'gypsum-fibre', name: 'Gypsum fibreboard (Fermacell type)', category: 'Board', role: 'mass',
    density: 1150, youngsModulus: 3.8e9, poisson: 0.25, lossFactor: 0.022,
    availableThicknessesMm: [10, 12.5, 15, 18], costPerM2PerMm: 0.64,
    notes: 'Dense, tough, well damped. Excellent mass layer; higher stiffness pulls the coincidence dip down a little compared to plasterboard.',
  },
  'cement-board': {
    id: 'cement-board', name: 'Cement particle board', category: 'Board', role: 'mass',
    density: 1300, youngsModulus: 8.0e9, poisson: 0.25, lossFactor: 0.018,
    availableThicknessesMm: [8, 10, 12, 16, 18], costPerM2PerMm: 1.83,
    notes: 'High mass and moisture tolerant, but stiff — the coincidence dip is lower than plasterboard. Best used as the outer of two dissimilar layers.',
  },
  'fibre-cement': {
    id: 'fibre-cement', name: 'Fibre cement board', category: 'Board', role: 'mass',
    density: 1450, youngsModulus: 12.0e9, poisson: 0.25, lossFactor: 0.016,
    availableThicknessesMm: [6, 9, 12, 15], costPerM2PerMm: 2.9,
    notes: 'Very dense per mm. Stiff, so pair it with a limp or damped layer to control the coincidence dip.',
  },
  'osb-plus-gypsum': {
    id: 'osb-plus-gypsum', name: 'Calcium silicate board', category: 'Board', role: 'mass',
    density: 900, youngsModulus: 4.5e9, poisson: 0.25, lossFactor: 0.016,
    availableThicknessesMm: [9, 12, 15, 20], costPerM2PerMm: 1.4,
    notes: 'Fire-rated dense board. Acoustically similar to gypsum fibreboard.',
  },

  /* ------------------------- Masonry ------------------------- */
  concrete: {
    id: 'concrete', name: 'Dense concrete (cast)', category: 'Masonry', role: 'mass',
    density: 2300, youngsModulus: 30.0e9, poisson: 0.20, lossFactor: 0.010,
    availableThicknessesMm: [75, 100, 150, 200, 250, 300], costPerM2PerMm: 0.18,
    notes: 'The gold standard for mass. 200 mm gives roughly 460 kg/m^2 and about STC 56 as a single leaf. Its coincidence frequency is low (about 120 Hz at 150 mm) but the sheer mass dominates.',
  },
  'concrete-block-dense': {
    id: 'concrete-block-dense', name: 'Dense concrete block (solid)', category: 'Masonry', role: 'mass',
    density: 2100, youngsModulus: 20.0e9, poisson: 0.20, lossFactor: 0.014,
    availableThicknessesMm: [100, 140, 190, 215], costPerM2PerMm: 0.22,
    notes: 'Must be fully bedded and parged (rendered) on at least one face — unparged blockwork leaks through the pores and mortar joints, typically losing 5-8 dB.',
  },
  'concrete-block-light': {
    id: 'concrete-block-light', name: 'Lightweight aerated block', category: 'Masonry', role: 'mass',
    density: 650, youngsModulus: 3.0e9, poisson: 0.20, lossFactor: 0.020,
    availableThicknessesMm: [100, 140, 200], costPerM2PerMm: 0.19,
    notes: 'Poor isolation for its thickness — a third the mass of dense block. Chosen for thermal performance, not acoustic.',
  },
  brick: {
    id: 'brick', name: 'Clay brick (solid, plastered)', category: 'Masonry', role: 'mass',
    density: 1900, youngsModulus: 16.0e9, poisson: 0.20, lossFactor: 0.015,
    availableThicknessesMm: [102, 215, 327], costPerM2PerMm: 0.30,
    notes: 'A 215 mm plastered brick wall is about 410 kg/m^2, around STC 54. Common as the party wall in apartment scenarios.',
  },
  screed: {
    id: 'screed', name: 'Sand/cement screed', category: 'Masonry', role: 'mass',
    density: 2100, youngsModulus: 25.0e9, poisson: 0.20, lossFactor: 0.015,
    availableThicknessesMm: [40, 50, 65, 75], costPerM2PerMm: 0.24,
    notes: 'Used as the mass on a floating floor. Its own mass sets the floating resonance, so more is better up to structural limits.',
  },

  /* ------------------------- Metals ------------------------- */
  steel: {
    id: 'steel', name: 'Steel sheet', category: 'Metal', role: 'mass',
    density: 7850, youngsModulus: 200e9, poisson: 0.30, lossFactor: 0.0002,
    availableThicknessesMm: [0.7, 1.0, 1.5, 2.0, 3.0, 6.0], costPerM2PerMm: 14,
    notes: 'Very high mass per mm but almost no internal damping, so it rings and its coincidence dip is severe. Undamped steel sheet badly underperforms mass law. Always bond a damping compound or a limp layer to it.',
  },
  aluminium: {
    id: 'aluminium', name: 'Aluminium sheet', category: 'Metal', role: 'mass',
    density: 2700, youngsModulus: 70e9, poisson: 0.33, lossFactor: 0.0001,
    availableThicknessesMm: [1.0, 1.5, 2.0, 3.0, 5.0], costPerM2PerMm: 15,
    notes: 'A poor isolation material: low mass, very high stiffness, essentially zero damping. Its coincidence dip at 3 mm sits near 4 kHz. Use only where weight matters more than performance.',
  },
  lead: {
    id: 'lead', name: 'Lead sheet (Code 3-5)', category: 'Metal', role: 'mass',
    density: 11340, youngsModulus: 16e9, poisson: 0.44, lossFactor: 0.015,
    availableThicknessesMm: [1.32, 1.80, 2.24, 2.65], costPerM2PerMm: 36,
    notes: 'Outstanding acoustically — enormous mass, low stiffness, high damping, so it follows mass law almost perfectly. Health, handling and building-regulation constraints usually rule it out; mass loaded vinyl is the modern substitute.',
  },
  'steel-stud': {
    id: 'steel-stud', name: 'Light-gauge steel C-stud', category: 'Metal', role: 'structural',
    density: 7850, youngsModulus: 200e9, poisson: 0.30, lossFactor: 0.0005,
    availableThicknessesMm: [0.5, 0.6, 0.7], costPerM2PerMm: 10,
    notes: 'Better than timber studs for isolation because the thin web flexes and partly decouples the leaves. Typically worth 3-6 dB over timber.',
  },

  /* ------------------------- Glazing ------------------------- */
  glass: {
    id: 'glass', name: 'Float glass (monolithic)', category: 'Glazing', role: 'glazing',
    density: 2500, youngsModulus: 70e9, poisson: 0.22, lossFactor: 0.002,
    availableThicknessesMm: [4, 6, 8, 10, 12, 15, 19], costPerM2PerMm: 7.5,
    notes: 'Very lightly damped, so the coincidence dip is deep and narrow (about 2 kHz at 6 mm). Two panes of *different* thickness in one frame outperform two equal panes because the dips do not line up.',
  },
  'glass-laminated': {
    id: 'glass-laminated', name: 'Laminated glass (PVB interlayer)', category: 'Glazing', role: 'glazing',
    density: 2450, youngsModulus: 65e9, poisson: 0.22, lossFactor: 0.050,
    availableThicknessesMm: [6.4, 6.8, 8.8, 10.8, 12.8], costPerM2PerMm: 11,
    notes: 'The PVB interlayer provides constrained-layer damping, which fills in the coincidence dip. Typically 3-5 dB better than monolithic glass of the same mass. The right choice for any vision panel.',
  },
  'glass-acoustic-laminated': {
    id: 'glass-acoustic-laminated', name: 'Acoustic laminated glass (soft interlayer)', category: 'Glazing', role: 'glazing',
    density: 2450, youngsModulus: 60e9, poisson: 0.22, lossFactor: 0.120,
    availableThicknessesMm: [8.8, 10.8, 12.8, 16.8], costPerM2PerMm: 17,
    notes: 'Purpose-made acoustic interlayer with very high loss factor. Essentially eliminates the coincidence dip.',
  },
  acrylic: {
    id: 'acrylic', name: 'Acrylic / PMMA', category: 'Glazing', role: 'glazing',
    density: 1190, youngsModulus: 3.2e9, poisson: 0.35, lossFactor: 0.040,
    availableThicknessesMm: [6, 10, 12, 15, 20, 25], costPerM2PerMm: 7,
    notes: 'Half the mass of glass but much better damped and far less stiff, so its coincidence dip is high and shallow. A 20 mm sheet is a reasonable booth window.',
  },
  polycarbonate: {
    id: 'polycarbonate', name: 'Polycarbonate', category: 'Glazing', role: 'glazing',
    density: 1200, youngsModulus: 2.3e9, poisson: 0.37, lossFactor: 0.060,
    availableThicknessesMm: [4, 6, 8, 10, 12, 15], costPerM2PerMm: 12,
    notes: 'Similar to acrylic but tougher and slightly better damped. Low mass limits it.',
  },

  /* ------------------------- Limp / membrane ------------------------- */
  mlv: {
    id: 'mlv', name: 'Mass loaded vinyl (MLV)', category: 'Membrane', role: 'membrane',
    density: 1900, youngsModulus: 0.02e9, poisson: 0.45, lossFactor: 0.200,
    availableThicknessesMm: [1.3, 2.6, 4.0], costPerM2PerMm: 9.6,
    notes: 'Genuinely limp: almost no bending stiffness, so its coincidence frequency is above the audible range and it follows mass law cleanly across the whole spectrum. Excellent, but expensive per kg — check whether an extra layer of plasterboard buys more mass for less money. Must be sealed and taped at every seam or it does nothing.',
  },
  'rubber-epdm': {
    id: 'rubber-epdm', name: 'EPDM rubber membrane', category: 'Membrane', role: 'membrane',
    density: 1400, youngsModulus: 0.01e9, poisson: 0.48, lossFactor: 0.300,
    availableThicknessesMm: [1.5, 2.0, 3.0, 5.0], costPerM2PerMm: 6,
    notes: 'Limp and very well damped. Lower density than MLV so less mass per mm, but cheaper and doubles as a decoupling layer.',
  },
  'bitumen-sheet': {
    id: 'bitumen-sheet', name: 'Bitumen / self-adhesive damping sheet', category: 'Membrane', role: 'damping',
    density: 1800, youngsModulus: 0.5e9, poisson: 0.45, lossFactor: 0.350,
    availableThicknessesMm: [1.5, 2.0, 3.0, 4.0], costPerM2PerMm: 7,
    notes: 'Primarily a damping treatment for thin resonant panels (steel, glass, thin ply). Adds modest mass but its real value is killing panel ring and filling in coincidence dips.',
  },
  'damping-compound': {
    id: 'damping-compound', name: 'Viscoelastic damping compound (Green Glue type)', category: 'Damping', role: 'damping',
    density: 1300, youngsModulus: 0.001e9, poisson: 0.49, lossFactor: 0.600,
    availableThicknessesMm: [0.5, 1.0], costPerM2PerMm: 0, costPerM2Fixed: 6.5,
    notes: 'Applied between two sheets it creates a constrained-layer damping system, raising the assembly loss factor from about 0.015 to 0.2. Worth 4-9 dB in the mid range for almost no thickness. Needs 7-30 days to cure to full performance.',
  },

  /* ------------------------- Porous absorbers ------------------------- */
  'rockwool-rwa45': {
    id: 'rockwool-rwa45', name: 'Rock wool slab, 45 kg/m^3 (RWA45)', category: 'Porous', role: 'porous',
    density: 45, youngsModulus: 1e6, poisson: 0.10, lossFactor: 0.30, flowResistivity: 12000,
    availableThicknessesMm: [25, 50, 75, 100], costPerM2PerMm: 0.104,
    notes: 'The standard cavity fill. Its job in a wall is not to block sound but to damp the cavity so the mass-air-mass resonance and standing waves are suppressed. Typically worth 3-8 dB in a double-leaf wall. Fill the cavity 60-100%; stuffing it tighter than that gains almost nothing.',
  },
  'rockwool-flexi': {
    id: 'rockwool-flexi', name: 'Rock wool flexible batt, 23 kg/m^3', category: 'Porous', role: 'porous',
    density: 23, youngsModulus: 0.3e6, poisson: 0.10, lossFactor: 0.30, flowResistivity: 8000,
    availableThicknessesMm: [50, 75, 100, 140], costPerM2PerMm: 0.09,
    notes: 'Friction-fit batt for stud cavities. Slightly less effective than a denser slab but easier to install and cheaper.',
  },
  'rockwool-rw3': {
    id: 'rockwool-rw3', name: 'Rock wool dense slab, 100 kg/m^3 (RW3)', category: 'Porous', role: 'porous',
    density: 100, youngsModulus: 4e6, poisson: 0.10, lossFactor: 0.28, flowResistivity: 30000,
    availableThicknessesMm: [25, 50, 75, 100], costPerM2PerMm: 0.22,
    notes: 'Dense slab used for floating floors and where the wool must carry a load. As a cavity absorber it is marginally better than 45 kg/m^3 at low frequency and no better above 500 Hz — do not pay for density you do not need.',
  },
  'mineral-wool-140': {
    id: 'mineral-wool-140', name: 'Mineral wool, 140 kg/m^3 (load bearing)', category: 'Porous', role: 'porous',
    density: 140, youngsModulus: 8e6, poisson: 0.10, lossFactor: 0.25, flowResistivity: 45000,
    availableThicknessesMm: [25, 30, 50], costPerM2PerMm: 0.34,
    notes: 'Structural resilient layer for floating floors. Its dynamic stiffness sets the floating resonance; check the manufacturer s\' value.',
  },
  'fibreglass-batt': {
    id: 'fibreglass-batt', name: 'Glass wool batt, 12 kg/m^3', category: 'Porous', role: 'porous',
    density: 12, youngsModulus: 0.1e6, poisson: 0.10, lossFactor: 0.30, flowResistivity: 8000,
    availableThicknessesMm: [50, 75, 100, 150, 200], costPerM2PerMm: 0.05,
    notes: 'Cheapest usable cavity fill. Almost as good as rock wool acoustically at typical cavity depths — the flow resistivity is what matters, not the brand.',
  },
  'fibreglass-703': {
    id: 'fibreglass-703', name: 'Rigid glass wool board, 48 kg/m^3 (703 type)', category: 'Porous', role: 'porous',
    density: 48, youngsModulus: 2e6, poisson: 0.10, lossFactor: 0.28, flowResistivity: 16000,
    availableThicknessesMm: [25, 50, 75, 100], costPerM2PerMm: 0.36,
    notes: 'Rigid board for duct lining and broadband room absorbers. Good flow resistivity for its density.',
  },
  'polyester-acoustic': {
    id: 'polyester-acoustic', name: 'Polyester acoustic batt (PET)', category: 'Porous', role: 'porous',
    density: 30, youngsModulus: 0.2e6, poisson: 0.10, lossFactor: 0.25, flowResistivity: 6000,
    availableThicknessesMm: [25, 50, 75, 100], costPerM2PerMm: 0.16,
    notes: 'Non-irritant alternative to mineral wool. Slightly lower flow resistivity, so a little less effective per mm; compensate with thickness.',
  },
  cellulose: {
    id: 'cellulose', name: 'Blown cellulose fibre', category: 'Porous', role: 'porous',
    density: 50, youngsModulus: 0.5e6, poisson: 0.10, lossFactor: 0.30, flowResistivity: 25000,
    availableThicknessesMm: [50, 100, 150, 200], costPerM2PerMm: 0.04,
    notes: 'Cheap, high flow resistivity, fills irregular cavities completely — which matters more than the material. Can settle over time and leave a void at the top of a wall.',
  },
  'sheep-wool': {
    id: 'sheep-wool', name: 'Sheep wool insulation', category: 'Porous', role: 'porous',
    density: 25, youngsModulus: 0.15e6, poisson: 0.10, lossFactor: 0.30, flowResistivity: 7000,
    availableThicknessesMm: [50, 75, 100], costPerM2PerMm: 0.14,
    notes: 'Acoustically comparable to glass wool. Chosen for handling and sustainability rather than performance.',
  },
  'denim-insulation': {
    id: 'denim-insulation', name: 'Recycled cotton/denim batt', category: 'Porous', role: 'porous',
    density: 25, youngsModulus: 0.2e6, poisson: 0.10, lossFactor: 0.30, flowResistivity: 9000,
    availableThicknessesMm: [50, 75, 90], costPerM2PerMm: 0.22,
    notes: 'Good flow resistivity, dust-free handling. Bulkier than mineral wool for the same result.',
  },

  /* ------------------------- Absorbers people misuse ------------------------- */
  'acoustic-foam': {
    id: 'acoustic-foam', name: 'Open-cell acoustic foam (wedge/pyramid)', category: 'Porous', role: 'porous',
    density: 28, youngsModulus: 0.05e6, poisson: 0.20, lossFactor: 0.35, flowResistivity: 10000,
    availableThicknessesMm: [25, 50, 75, 100], costPerM2PerMm: 0.28,
    notes: 'ABSORPTION ONLY. At 2.8 kg per m^2 of 100 mm foam it adds essentially no mass, so it blocks nothing — sticking foam on a wall changes the sound *inside* the room and does not change what the neighbours hear. Useful for controlling reflections and flutter echo inside the booth, and useful as cavity/duct lining. Never a substitute for mass.',
  },
  'acoustic-panel-fabric': {
    id: 'acoustic-panel-fabric', name: 'Fabric-wrapped acoustic panel', category: 'Porous', role: 'porous',
    density: 60, youngsModulus: 2e6, poisson: 0.10, lossFactor: 0.28, flowResistivity: 18000,
    availableThicknessesMm: [25, 50, 75, 100], costPerM2PerMm: 0.9,
    notes: 'A mineral-wool core in a frame. Excellent absorber, negligible isolator. Same caveat as foam: it treats the room, not the wall.',
  },
  'egg-box-foam': {
    id: 'egg-box-foam', name: 'Thin convoluted foam ("egg box")', category: 'Porous', role: 'porous',
    density: 22, youngsModulus: 0.03e6, poisson: 0.20, lossFactor: 0.35, flowResistivity: 6000,
    availableThicknessesMm: [15, 25, 40], costPerM2PerMm: 0.2,
    notes: 'Absorbs above about 1 kHz and nothing below. Does not isolate at all. Included so the simulator can demonstrate why.',
  },
  carpet: {
    id: 'carpet', name: 'Carpet on underlay', category: 'Porous', role: 'porous',
    density: 200, youngsModulus: 1e6, poisson: 0.20, lossFactor: 0.30, flowResistivity: 40000,
    availableThicknessesMm: [8, 12, 18, 25], costPerM2PerMm: 1.1,
    notes: 'Modest high-frequency absorption and a genuine reduction in impact noise. No airborne isolation benefit.',
  },

  /* ------------------------- Air ------------------------- */
  air: {
    id: 'air', name: 'Air cavity (empty)', category: 'Cavity', role: 'porous',
    density: 1.204, youngsModulus: 1.42e5, poisson: 0.0, lossFactor: 0.001, flowResistivity: 20,
    availableThicknessesMm: [10, 25, 50, 75, 100, 150, 200, 300],
    costPerM2PerMm: 0,
    notes: 'An empty cavity acts as a spring between the leaves. Deeper is better, but an empty cavity has strong standing waves at multiples of c/2d — fill at least 60% of it with mineral wool.',
  },
};

/** Materials grouped by category, for the UI selector. */
export function materialsByCategory() {
  /** @type {Record<string, Material[]>} */
  const out = {};
  for (const m of Object.values(MATERIALS)) {
    (out[m.category] ||= []).push(m);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Create a custom material, filling in sensible defaults and validating.
 * @param {Partial<Material> & {id:string, name:string, density:number}} spec
 * @returns {Material}
 */
export function createCustomMaterial(spec) {
  const m = {
    category: 'Custom',
    role: 'mass',
    youngsModulus: 3e9,
    poisson: 0.3,
    lossFactor: 0.02,
    availableThicknessesMm: [6, 9, 12, 18, 25, 50],
    costPerM2PerMm: 0,
    notes: 'User-defined material.',
    ...spec,
  };
  const errs = [];
  if (!(m.density > 0)) errs.push('density must be > 0');
  if (!(m.youngsModulus > 0)) errs.push('youngsModulus must be > 0');
  if (m.poisson < 0 || m.poisson >= 0.5) errs.push('poisson must be in [0, 0.5)');
  if (m.lossFactor <= 0 || m.lossFactor > 1) errs.push('lossFactor must be in (0, 1]');
  if (m.role === 'porous' && !m.flowResistivity) errs.push('porous materials need flowResistivity');
  if (errs.length) throw new Error('Invalid material: ' + errs.join('; '));
  return /** @type {Material} */ (m);
}

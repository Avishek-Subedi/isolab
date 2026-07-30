# 02 — Material Database

## Design principle: properties, not curves

Every material stores **physical properties**, never a pre-baked transmission-loss
curve. Transmission loss, coincidence frequency, absorption and resonance are all
*computed* from those properties.

This is why any thickness, any layer stack and any user-defined material work
immediately, with no data entry — and why the database is 45 entries rather than
45 × 8 thicknesses × 3 mounting conditions of tabulated curves that would
inevitably disagree with each other.

## Schema

```js
/**
 * @typedef {Object} Material
 * @property {string}   id
 * @property {string}   name
 * @property {string}   category           Wood|Board|Masonry|Metal|Glazing|
 *                                         Membrane|Damping|Porous|Cavity|Custom
 * @property {string}   role               'mass'|'porous'|'damping'|'membrane'|
 *                                         'structural'|'glazing'
 * @property {number}   density            kg/m³        → surface mass, mass law
 * @property {number}   youngsModulus      Pa           → bending stiffness, f_c
 * @property {number}   poisson            –            → plate stiffness
 * @property {number}   lossFactor         η            → coincidence dip depth
 * @property {number} [ flowResistivity ]  Pa·s/m²      → absorption (porous only)
 * @property {number[]} availableThicknessesMm
 * @property {number} [ costPerM2PerMm ]   indicative GBP
 * @property {number} [ costPerM2Fixed ]
 * @property {string}   notes              engineering guidance shown in the UI
 */
```

### Why each property is needed

| Property | Feeds | Consequence if wrong |
|---|---|---|
| `density` | `m_s = ρh` → mass law | Everything. This is the dominant term. |
| `youngsModulus`, `poisson` | `c_L = √(E/ρ(1−ν²))` → `f_c = c²/(1.8 c_L h)` | The coincidence dip lands in the wrong band |
| `lossFactor` | dip depth and plateau width via `η_tot` | Dip 10 dB too deep or too shallow |
| `flowResistivity` | Miki model → α, and cavity damping | Cavity resonance damping wrong by 10 dB |

`lossFactor` is the property most often quoted carelessly in the literature, with
ranges spanning a factor of five for the same material. Values here sit
mid-range: plasterboard 0.018 (published 0.006–0.03), plywood 0.025
(0.01–0.04), steel 0.0002, glass 0.002, MLV 0.20.

## Coverage — 45 materials

**Wood-based sheet** — plywood, MDF, OSB3, chipboard, softwood, hardwood
**Boards** — plasterboard, acoustic (high-density) plasterboard, gypsum
fibreboard, cement particle board, fibre cement, calcium silicate
**Masonry** — dense concrete, dense/lightweight block, brick, screed
**Metals** — steel sheet, aluminium, lead, light-gauge steel stud
**Glazing** — float glass, laminated, acoustic laminated, acrylic, polycarbonate
**Membranes & damping** — mass loaded vinyl, EPDM rubber, bitumen sheet,
viscoelastic damping compound
**Porous** — rock wool (23/45/100/140 kg/m³), glass wool batt, rigid glass wool
board, polyester, cellulose, sheep wool, recycled denim
**Absorbers commonly misused** — open-cell acoustic foam, fabric-wrapped panel,
thin convoluted foam, carpet
**Cavity** — air

The "commonly misused" category exists deliberately so the advisor can explain
why they do not isolate. Removing them would remove the tool's ability to correct
the single most expensive misunderstanding in the subject.

## Selected values

| Material | ρ kg/m³ | E GPa | η | `f_c` at listed thickness |
|---|---|---|---|---|
| Plasterboard | 700 | 2.5 | 0.018 | 2 600 Hz @ 12.5 mm |
| Acoustic plasterboard | 900 | 2.8 | 0.020 | 2 200 Hz @ 15 mm |
| Gypsum fibreboard | 1 150 | 3.8 | 0.022 | 2 000 Hz @ 12.5 mm |
| Plywood | 600 | 7.0 | 0.025 | 1 015 Hz @ 18 mm |
| MDF | 750 | 3.5 | 0.026 | 1 630 Hz @ 18 mm |
| Dense concrete | 2 300 | 30.0 | 0.010 | 120 Hz @ 150 mm |
| Steel sheet | 7 850 | 200 | **0.0002** | 12 300 Hz @ 1 mm |
| Aluminium | 2 700 | 70 | **0.0001** | 4 040 Hz @ 3 mm |
| Lead | 11 340 | 16 | 0.015 | above audible @ 2 mm |
| Float glass | 2 500 | 70 | **0.002** | 2 000 Hz @ 6 mm |
| Acoustic laminated glass | 2 450 | 60 | **0.120** | 1 500 Hz @ 12.8 mm |
| Mass loaded vinyl | 1 900 | **0.02** | 0.200 | above audible |
| Damping compound | 1 300 | 0.001 | **0.600** | n/a (interlayer) |
| Rock wool RWA45 | 45 | — | — | σ = 12 000 Pa·s/m² |
| Acoustic foam | 28 | — | — | σ = 10 000 Pa·s/m² |

The bold values carry the interesting physics. Steel and aluminium have almost no
internal damping, so they ring and badly underperform mass law near coincidence.
Float glass is similar, which is why laminated glass — where the PVB interlayer
raises η by a factor of 25 — outperforms monolithic glass of the same mass by
3–5 dB. MLV's near-zero Young's modulus pushes its coincidence frequency above
the audible range, so it follows mass law cleanly across the whole spectrum; that
is the ideal behaviour for an isolation layer, and the reason lead was historically
preferred.

## Layer stacks: bonding matters

```js
{ layers: [{ material, thicknessMm }, …], bonding: 'screwed'|'laminated'|'damped' }
```

| Bonding | `f_c` | `η` | Real-world meaning |
|---|---|---|---|
| `screwed` | of the individual sheets | mass-weighted mean | two boards screwed together — the normal case |
| `laminated` | composite `B`, **lower** `f_c` | mass-weighted mean | rigidly glued |
| `damped` | of the individual sheets | `max(η, 0.13)` | viscoelastic compound between |

**Two 12.5 mm sheets screwed together carry the mass of 25 mm but keep the
coincidence frequency of 12.5 mm.** That is the whole reason layering beats bulk,
and rigidly gluing them throws the advantage away by lowering `f_c` into the
speech range.

Worked comparison, single leaf, 500 Hz / STC:

| Build-up | kg/m² | `f_c` | STC |
|---|---|---|---|
| 1 × 25 mm plasterboard | 17.5 | 1 320 Hz | 31 |
| 2 × 12.5 mm, **laminated** (rigidly glued) | 17.5 | 1 310 Hz | 31 |
| 2 × 12.5 mm, **screwed** | 17.5 | 2 639 Hz | 34 |
| 2 × 12.5 mm, **damped** | 17.5 | 2 639 Hz | 36 |

Identical mass, identical thickness, identical cost of board — 5 STC points apart,
and the *laminated* case throws the whole benefit away by gluing the sheets into one
thick plate with a low coincidence frequency. It performs exactly like the single
25 mm sheet, which is what it has become.

## Custom materials

```js
import { createCustomMaterial } from './src/data/materials.mjs';

const myBoard = createCustomMaterial({
  id: 'my-board', name: 'Proprietary acoustic board',
  density: 1250, youngsModulus: 4.2e9, poisson: 0.25, lossFactor: 0.03,
  availableThicknessesMm: [12, 18, 25], costPerM2PerMm: 0.9,
  notes: 'From the manufacturer data sheet, batch 2026-01.',
});
```

Validated on construction: density and modulus positive, `0 ≤ ν < 0.5`,
`0 < η ≤ 1`, and `flowResistivity` required when `role === 'porous'`. Invalid
input throws rather than silently producing plausible-looking nonsense.

If a data sheet gives only a measured TL curve and not the physical properties,
`youngsModulus` can be back-calculated from the quoted coincidence frequency:

```
E = ρ(1−ν²) · [ c² / (1.8 f_c h) ]²
```

## The material advisor

`assessMaterial(material, thicknessMm)` → three independent 0–5 scores, an
explanation, and warnings. It exists to separate two jobs people constantly
conflate: **blocking** sound from getting out, and **absorbing** sound inside.

| Score | Driven by |
|---|---|
| **Blocking** | surface mass, penalised when the coincidence dip exceeds 13 dB |
| **Absorbing** | NRC from the Miki model at the given thickness |
| **Self-damping** | loss factor |

Example — 50 mm acoustic foam:

```
Absorber only. This will NOT stop sound escaping.

  Surface mass  1.4 kg/m²      NRC 0.65
  Blocking  ▰▱▱▱▱ 1/5    Absorbing  ▰▰▰▱▱ 3/5    Damping  ▰▰▰▰▰ 5/5

  At 50 mm this gives 1.4 kg/m² of surface mass, worth about 10 dB at 500 Hz.
  Its absorption is good, so it will make the booth sound drier and reduce
  reverberant build-up — worth 2-4 dB, not the 20-30 dB people expect.
  Inside a wall cavity it earns its place differently: it damps the cavity so
  the mass-air-mass resonance is suppressed, worth 3-8 dB in a double-leaf wall.

  ! Do not count this material toward your isolation target. Sound blocking
    needs mass and airtightness; absorption is a different job.
```

Note the model is not dismissive: it credits foam for the two things it genuinely
does (reverberant build-up, cavity damping) while refusing to credit it for
blocking. That distinction is the point.

Other warnings the advisor raises automatically:

- **Undamped metals ring.** `η < 0.005` triggers a warning that the material will
  fall well short of mass law near coincidence without a bonded damping layer.
- **MLV value check.** MLV at 2.6 mm gives 4.9 kg/m² for ~£25/m²; 12.5 mm
  plasterboard gives 8.8 kg/m² for ~£2.80/m². MLV wins only where thickness is
  genuinely constrained — the advisor says so on the MLV page.
- **Structural load.** Above 40 kg/m² it computes the mass of one 2.4 × 2.4 m wall
  and tells you to check the floor can carry it.
- **Coincidence dip location.** If the dip falls between 800 Hz and 4 kHz it says
  so explicitly, because that is inside the vocal range.

## Cost per unit mass

```bash
node cli/simulate.mjs --value
```

Since mass is what blocks sound, the most useful ranking is cost per kg/m²:

| Material | £ per kg/m² |
|---|---|
| Dense concrete | 0.08 |
| Lightweight block | 0.29 |
| Plasterboard | 0.32 |
| Acoustic plasterboard | 0.36 |
| OSB3 | 0.65 |
| MDF | 0.72 |
| Gypsum fibreboard | 0.56 |
| Plywood | 1.45 |
| Mass loaded vinyl | 5.05 |
| Float glass | 3.00 |
| Steel sheet | 1.78 |
| Lead | 3.17 |

Plasterboard is roughly **16 times better value per kilogram than MLV**, which is
the single most useful number in the table for anyone shopping for "soundproofing
products".

## Sources

Manufacturer data sheets; CIBSE Guide B; Bies & Hansen *Engineering Noise
Control* material tables; Cox & D'Antonio *Acoustic Absorbers and Diffusers* for
flow resistivities. Costs are indicative UK retail, late 2025/2026, ex-VAT,
materials only.

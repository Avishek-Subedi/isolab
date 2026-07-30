# IsoLab

**A frequency-resolved acoustic isolation simulator for booths, studios and enclosures.**

Answers one question:

> *If I build this exact design, from these exact materials, with this door, this
> ventilation system, these dimensions and this environment — how loud will it be
> outside?*

Not a decibel calculator. It solves an acoustic power balance across 24
one-third-octave bands and nine physical transmission mechanisms, identifies which
one is limiting your design, and tells you what to do about it.

```bash
npm test              # 171 tests, zero dependencies
npm run validate      # validation against 18 published lab constructions
npm start             # real-time UI at http://localhost:8080
node cli/simulate.mjs --scenario bedroom-diy
```

Node 18+. No dependencies, no build step, no network access.

(`npm run typecheck` is optional and needs `npm i -D typescript`; the engine itself
needs nothing.)

---

## What it models

| | Mechanism | Model |
|---|---|---|
| 1 | Transmission through materials | Mass law, coincidence frequency, damping plateau, forced-path bound |
| 2 | Multi-leaf walls | Sharp three-region + mass–air–mass resonance + cavity standing waves |
| 3 | Structural bridging | EN 12354 parallel path with connection-specific ceilings |
| 4 | Air leakage | Zwikker–Kosten viscothermal transmission line (real Bessel/Struve radiation) |
| 5 | Door leakage | Leaf + perimeter + threshold + frame + two-door air lock |
| 6 | Ventilation ducts | ASHRAE element chain, power-bounded breakout, airflow sizing |
| 7 | Wall resonance | Panel mode, coincidence, cavity modes, per-band mechanism diagnosis |
| 8 | Structural vibration | SDOF isolator theory, floating floors, impact improvement |
| 9 | Flanking | Parallel structural path + 75 dB in-building ceiling |

Plus: Miki porous-absorber model, diffuse-field room response, ISO 3744 near-field
distance law, party-wall chaining, background-noise audibility, STC / Rw / C / Ctr /
NIC / NR.

Everything is frequency-dependent. Nothing is a single number.

---

## Five results that surprise people

All fall out of the physics rather than being asserted:

1. **A 2 mm gap around a door can matter more than 30 m² of excellent wall.** A
   gap's transmission coefficient is thousands of times a good wall's, so a tiny
   area wins on `S·τ`.
2. **A 0.1 mm gap leaks far less than a tenth of what a 1 mm gap leaks.** The
   viscous boundary layer fills a narrow slit and chokes it — which is why gaskets
   work, and is invisible to an area-ratio model.
3. **Below the mass–air–mass resonance, a deeper cavity does nothing whatsoever.**
   The leaves move together as one mass. Only mass helps there.
4. **An isolator amplifies below its own resonance.** Rubber feet with a 28 Hz
   resonance make a 40 Hz kick-drum problem *worse* than a rigid connection.
5. **Acoustic foam blocks essentially nothing.** 100 mm is 2.8 kg/m². It has real
   jobs — drying the room, lining cavities and ducts — but covering a wall in it
   changes what you hear inside and leaves what the neighbours hear unaltered.

---

## Example

```bash
node cli/simulate.mjs --scenario bedroom-diy
```

```
INSIDE            100.0 dB SPL     99.3 dB(A)
                      ↓
BOOTH ISOLATION   − 23.0 dB        STC 24 / Rw 25
                      ↓
OUTSIDE            77.0 dB SPL     75.4 dB(A)

Background 25.8 dB(A) → perceived 75.5 dB(A)   excess +49.7 dB
Obtrusive. Expect complaints.

WHERE THE SOUND ESCAPES
  door        65.1%  ████████████████████████████
  leak        19.6%  ████████·············
  vent        11.3%  ████·················
  wall         4.0%  █····················

  22.6%  Door: frame-to-wall junction, unsealed (2 mm)
  15.1%  Door: threshold — 10 mm undercut
  15.0%  Door: leaf itself
  12.5%  Wall/floor junction, unsealed

[critical] 70% of the escaping sound is going through gaps, not through materials
```

The walls are transmitting 4 % of the total. Adding another layer of board would
change the answer by 0.2 dB. **That is the point of the tool** — the standard
advice is frequently the worst place to spend the next hundred pounds.

Nine complete worked examples, all real output: **[`docs/07-WORKED-EXAMPLES.md`](docs/07-WORKED-EXAMPLES.md)**

---

## Interfaces

**Browser UI** (`npm start`) — genuinely real-time. Every control recomputes the
full simulation in 1–4 ms: no debouncing, no interpolation, no server.

The **3D booth builder** is the centrepiece: click any wall, ceiling or floor to
change what it is made of — material, thickness, number of layers, cavity depth
and fill, and how the leaves are joined — and drag the handles on the length,
width and height edges to resize the booth. Faces are painted with the real
material (wood grain, brick courses, translucent glazing), and a second view
switches the same model to the leakage heat map with animated escape plumes.
Every surface is independent, so one wall can be concrete while the rest are
plasterboard.

Nine tabs in all: spectrum & leakage, 3D builder, diagnosis, physics detail,
optimiser, air-gap study, material advisor, reality calibration, and the
validation table.

**CLI** (`node cli/simulate.mjs`) — full engineering report with ASCII spectra,
leakage breakdown, diagnostics and cost. `--optimise`, `--compare`, `--material`,
`--value`, `--validate`, `--json`.

**Library** — `import { simulate } from './src/core/index.mjs'`. Pure,
synchronous, no I/O. See [`docs/08-API.md`](docs/08-API.md).

**Single-file build** (`npm run bundle`) — flattens all 24 modules, the
stylesheet and the markup into one self-contained ~364 KB HTML file with no
external requests, so it can be hosted on any static host or pasted into a
sandbox with a strict CSP:

```
dist/isolab.html            standalone page, open it directly
dist/isolab.artifact.html   fragment for hosts that supply the document skeleton
```

The bundler (`cli/bundle.mjs`) is a lazy module registry plus a mechanical
import/export rewrite — the graph is small and acyclic, so no build dependency
is needed.

---

## Accuracy

Validated against 18 published laboratory constructions:
**18/18 within tolerance, mean bias +0.67 STC, RMSE 1.89 STC.** Curve-shape RMSE
for single-leaf plasterboard is 1.46 dB across 125 Hz–4 kHz.

| Question | Expected accuracy |
|---|---|
| Is design B better than A, and by how much? | ±2 dB — **the model's strongest use** |
| Which path dominates? | reliable ranking |
| Absolute dB(A) at the receiver, well-described build | ±3–5 dB |
| Absolute octave band, 250 Hz–4 kHz | ±4 dB |
| Absolute octave band, 63–125 Hz | ±6–10 dB |
| Below 63 Hz | ±10 dB or worse |

**Laboratory ratings are a ceiling, not an expectation.** A construction tested at
STC 55 routinely measures 45–50 as built — which is precisely why this tool models
leaks, doors, ducts and flanking explicitly instead of quoting a lab number.

Use it to choose between designs, not to promise a number to a neighbour or a
planning officer. Every known limitation and every open residual is documented in
**[`docs/06-VALIDATION.md`](docs/06-VALIDATION.md) — read it before trusting a number.**

---

## Documentation

| Document | Contents |
|---|---|
| [`00-OVERVIEW.md`](docs/00-OVERVIEW.md) | orientation, what it models, how to read the output |
| [`01-PHYSICS.md`](docs/01-PHYSICS.md) | every equation, its source, and the file that executes it |
| [`02-MATERIALS.md`](docs/02-MATERIALS.md) | database schema, properties, custom materials, the advisor |
| [`03-ARCHITECTURE.md`](docs/03-ARCHITECTURE.md) | layers, data model, pipeline, persistence, testing |
| [`04-ALGORITHMS.md`](docs/04-ALGORITHMS.md) | solver, optimiser, calibration, diagnostics in pseudocode |
| [`05-UI-SPEC.md`](docs/05-UI-SPEC.md) | interface specification, real-time design, 3D visualisation |
| [`06-VALIDATION.md`](docs/06-VALIDATION.md) | **validation, accuracy, limitations** |
| [`07-WORKED-EXAMPLES.md`](docs/07-WORKED-EXAMPLES.md) | nine complete examples, all real output |
| [`08-API.md`](docs/08-API.md) | library reference |

---

## Project layout

```
src/core/     physics engine        panel, partition, leaks, door, duct,
                                    structure, ratings, solver, optimizer,
                                    calibration, validation, assess
src/data/     material & preset DB  45 materials, 20 sources, 11 environments,
                                    20 assemblies, 6 scenarios
src/ui/       browser interface     index.html, app.mjs, charts.mjs, viz3d.mjs
cli/          terminal + server     simulate.mjs, serve.mjs
tests/        171 tests             physics, leaks, system, validation
docs/         technical docs        nine documents
```

## Design decisions

- **Physics from properties, never lookup tables.** Materials carry density,
  Young's modulus, Poisson's ratio, loss factor and flow resistivity; TL and
  absorption are computed. Any thickness, any layer stack, any custom material
  works immediately.
- **One canonical currency, `S·τ`.** Every path reduces to an effective
  transmitting area per band, so paths add linearly on a power basis and the
  leakage breakdown is an exact power fraction rather than a heuristic.
- **Zero dependencies.** An acoustic tool whose numbers cannot be traced from the
  UI to the equation without passing through a bundler is not auditable. Type
  safety comes from JSDoc checked with `tsc --checkJs`.
- **Fitted constants are collected and labelled.** Each lives in an exported
  `*_CONSTANTS` object stating what it is, why it departs from the textbook, and
  which validation case pinned it.
- **The validation suite is the contract.** Any physics change that pushes a
  published construction out of tolerance is a regression. This caught three real
  bugs during development, including a double-counted forced-transmission path
  silently removing 3 dB from every leaf.

## Safety note

The engine treats inadequate ventilation as a **safety** issue before an acoustic
one. A sealed 2 m³ booth reaches uncomfortable CO₂ in about 15 minutes. Fire,
structural, thermal and condensation performance are **not modelled at all** and
can override any acoustic decision.

## Licence

MIT. Material properties and costs are indicative; verify against manufacturer
data for any real project.

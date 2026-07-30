# 00 — Overview

## What this is

**IsoLab** is a frequency-resolved acoustic isolation simulator for booths,
studios, enclosures and small rooms. It answers one question:

> *If I build this exact design, from these exact materials, with this door, this
> ventilation system, these dimensions and this environment — how loud will it be
> outside?*

It is not a decibel calculator. It solves an acoustic power balance in 24
one-third-octave bands across nine physical transmission mechanisms, tells you
which one is limiting your design, and tells you what to do about it.

## The question behind the question

Most people who build a booth ask "how thick should the walls be?" That is almost
never the binding constraint. Across the six built-in scenarios, the wall
assembly is the dominant transmission path in exactly one of them. The other five
are limited by a door, a vent, an air gap, a window, or the building's own
structure.

This tool exists because a single transmission-loss number for a wall cannot
express that, and because the standard advice — add mass, add insulation — is
frequently the *worst* place to spend the next hundred pounds.

## What it models

| Mechanism | Model | Module |
|---|---|---|
| Sound transmission through materials | Mass law, coincidence, plateau, forced-path bound | `panel.mjs` |
| Multi-leaf walls | Sharp three-region + mass–air–mass + cavity standing waves | `partition.mjs` |
| Structural bridging | EN 12354 parallel path, connection-specific ceilings | `partition.mjs` |
| Air leakage | Zwikker–Kosten viscothermal transmission line | `leaks.mjs` |
| Door leakage | Leaf + perimeter + threshold + frame + air lock | `door.mjs` |
| Ventilation ducts | ASHRAE element chain, bounded breakout, sizing | `duct.mjs` |
| Wall resonance | Panel mode, coincidence, cavity modes, per-band diagnosis | `panel.mjs` |
| Structural vibration | SDOF isolator theory, floating floors | `structure.mjs` |
| Flanking transmission | Parallel structural path + 75 dB building ceiling | `structure.mjs`, `solver.mjs` |
| Absorption | Miki porous model from flow resistivity | `acoustics.mjs` |
| Room and receiver | Diffuse field, ISO 3744 box envelope, party walls, background | `solver.mjs` |

Everything is frequency-dependent. Nothing is a single number.

## Five results that surprise people

These all fall out of the physics rather than being asserted:

1. **A 2 mm gap around a door can matter more than 30 m² of excellent wall.** A
   gap's transmission coefficient is thousands of times higher than a good wall's,
   so a tiny area wins on `S·τ`. → `docs/07`, Example 1
2. **A 0.1 mm gap leaks far less than a tenth of what a 1 mm gap leaks.** The
   viscous boundary layer fills a narrow slit and chokes it. This is why gaskets
   work at all, and it is invisible to an area-ratio model. → `docs/01` §6.1
3. **Below the mass–air–mass resonance, a deeper cavity does nothing whatsoever.**
   The leaves move together as one mass. Only mass helps there. → `docs/07`, Example 7
4. **An isolator amplifies below its own resonance.** Rubber feet with a 28 Hz
   resonance make a 40 Hz kick-drum problem worse than a rigid connection would.
   → `docs/01` §10
5. **Acoustic foam blocks essentially nothing.** 100 mm of it is 2.8 kg/m². It has
   a real job — drying the room, lining cavities and ducts — but covering a wall in
   it changes what you hear inside and leaves what the neighbours hear unaltered.
   → `docs/07`, Example 8

## How to use it

```bash
npm test              # 171 tests, no dependencies
npm run validate      # laboratory validation against 18 published constructions
npm start             # real-time UI at http://localhost:8080
node cli/simulate.mjs --help
```

Three interfaces over one engine:

- **Browser UI** — real-time. Every control recomputes the full simulation in
  1–4 ms: no debouncing, no interpolation, no server. Nine tabs covering spectrum,
  3D escape map, diagnosis, physics detail, optimiser, air-gap study, material
  advisor, calibration and validation.
- **CLI** — full engineering report with ASCII spectra, leakage breakdown,
  diagnostics, cost. Scriptable; `--json` emits the raw result.
- **Library** — `import { simulate } from './src/core/index.mjs'`. Pure,
  synchronous, no I/O.

## Reading the output

The headline is a three-stage chain:

```
INSIDE  100.0 dB SPL  (99.3 dB(A))
   ↓
BOOTH ISOLATION  −39.6 dB   STC 47 / Rw 46 (C+0, Ctr−4)
   ↓
OUTSIDE  60.4 dB SPL  (54.7 dB(A))
```

Then, in order of importance:

1. **Excess over background.** 30 dB(A) into a 16 dB(A) bedroom is obtrusive; the
   same 30 dB(A) into a 40 dB(A) office is inaudible. A level with no background
   answers nothing.
2. **The leakage breakdown.** Genuine power shares, so the percentages are real.
   The largest one is where to spend next.
3. **The octave-band table.** A single number hides whether what escapes is a
   muffled thump or an intelligible voice — which decides whether a neighbour
   complains.
4. **`Ctr`, not just `Rw`.** Both single-number ratings discard everything below
   100 Hz. `Ctr` is the low-frequency correction and is typically −4 to −9 for
   lightweight construction.
5. **The diagnostics.** Severity-ranked, each naming a mechanism and a fix.

## Accuracy in one paragraph

On a well-described build the engine predicts the receiver level to within about
**3–5 dB(A)**, and octave bands above 250 Hz to within about **4 dB**. Below 63 Hz
uncertainty exceeds 10 dB and the assumptions underpinning the whole method
(diffuse field) no longer hold. Its **relative** accuracy — is design B better
than design A, and which path limits it — is considerably better than its absolute
accuracy, and is what it should be used for. Laboratory validation gives RMSE
1.89 STC over 18 published constructions. Full treatment, including every known
limitation and the open residuals, in **`docs/06-VALIDATION.md`** — read it before
trusting a number.

## Document map

| Document | Contents |
|---|---|
| `00-OVERVIEW.md` | this file |
| `01-PHYSICS.md` | every equation, its source, and the file that executes it |
| `02-MATERIALS.md` | database schema, properties, custom materials, the advisor |
| `03-ARCHITECTURE.md` | layers, data model, pipeline, persistence, testing |
| `04-ALGORITHMS.md` | solver, optimiser, calibration, diagnostics in pseudocode |
| `05-UI-SPEC.md` | interface specification, real-time design, 3D visualisation |
| `06-VALIDATION.md` | **validation, accuracy, limitations — read this** |
| `07-WORKED-EXAMPLES.md` | nine complete examples, all real output |
| `08-API.md` | library reference |

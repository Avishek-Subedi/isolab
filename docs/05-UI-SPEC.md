# 05 — Interface Specification

```bash
npm start        # http://localhost:8080
```

## Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  IsoLab                                    engine 2.1 ms │ 24 × ⅓-oct      │
├──────────────────┬─────────────────────────────────────────────────────────┤
│                  │  ┌───────────┐   ┌──────────────┐   ┌───────────┐       │
│  Scenario        │  │  INSIDE   │ ↓ │  ISOLATION   │ ↓ │  OUTSIDE  │       │
│                  │  │ 100.0 dB  │   │   −39.6 dB   │   │  60.4 dB  │       │
│  Sound source    │  │ 99.3 dB(A)│   │ STC 47 / Rw46│   │54.7 dB(A) │       │
│   ├ source       │  └───────────┘   └──────────────┘   └───────────┘       │
│   ├ level slider │                                                         │
│   ├ level means  │  Obtrusive. Expect complaints.                          │
│   └ advanced EQ  │  Background 25.8 → perceived 54.8   Excess +29.0 dB     │
│                  │  ├───────────────────────────●──────────────────┤       │
│  Dimensions      │  0    20    30    40    50   55   65    80              │
│  Construction    │                                                         │
│  Ventilation     │  FAIL WHO night-noise (bedroom)   ≤30 dB(A)   −24.8     │
│  Treatment       │  FAIL BS 8233 bedroom, night      ≤30 dB(A)   −24.8     │
│  Air leaks       │  …                                                      │
│  Listener        ├─────────────────────────────────────────────────────────┤
│  Compare         │ Spectrum │ 3D map │ Diagnosis │ Physics │ Optimiser │ … │
│                  ├─────────────────────────────────────────────────────────┤
│                  │                  (active tab)                           │
└──────────────────┴─────────────────────────────────────────────────────────┘
```

Left column: every input, always visible, sticky-scrolled. Right column: the
result, with the headline chain permanently on screen so no interaction ever
hides the answer.

## Real-time behaviour

**Every control recomputes the entire simulation on `input`.** No debouncing, no
throttling, no partial updates, no interpolation between cached results, no worker,
no server round-trip. The measured cost is **1–4 ms** for a complete 24-band
simulation of a full booth including all interpretation, which is well inside a
16 ms frame budget.

This is a direct consequence of the architecture: the engine is a pure synchronous
function with no I/O. The `engine N ms` chip in the header displays the actual
elapsed time of the last run, so the claim is verifiable rather than asserted.

Dragging the level slider therefore produces a continuously updating outside level,
spectrum, breakdown, 3D heat map and diagnosis — which is the point. The
relationships between design choices are far easier to *feel* by dragging than to
read from a table.

## Sound source panel

| Control | Behaviour |
|---|---|
| Source | 20 measured spectra, grouped Voice / Instrument / Playback / Test. Selecting one shows its engineering note (e.g. why a scream is easier to contain than a kick drum). |
| Level | 30–130 dB in 1 dB steps, with a tick scale. Rescales the spectrum to that overall level. |
| Level means | `SPL measured inside` (used directly) or `Source SPL at 1 m free field` (adds the booth's reverberant build-up, 6–12 dB in a small hard booth). |
| Advanced | Per-octave sliders, 20–130 dB, vertical faders. Each sets the three ⅓-octaves inside that octave; the engine still computes in ⅓-octaves. |

The two "level means" modes exist because users mean different things. Someone with
a meter means the first; someone quoting "a scream is 100 dB" means the second, and
would otherwise under-predict by up to 12 dB.

## Tabs

### 1. Spectrum & leakage
- **Inside vs outside vs background**, log-frequency, 24 bands.
- **Transmission loss**: composite envelope, the wall assembly alone, and the level
  difference — plotted together, because *the gap between the wall's own curve and
  the composite is exactly what the door, vent and leaks are costing you.*
  Vertical dashed markers at `f₀` and each `f_c`.
- **Donut** of power share by group, with the outside level in the centre.
- **Individual paths** as horizontal bars, colour-coded by group.
- **Best possible gain per path** — "if you eliminated this entirely, the total
  falls by at most X dB". Usually the most actionable panel in the app.
- **Dominant path per octave** — answers "what leaks at 125 Hz?" separately from
  "what leaks overall", which are frequently different components.

### 2. 3D booth builder

A dependency-free renderer (no WebGL, no library): look-at + perspective
projection, painter's-algorithm depth sort, polygon hit-testing.

Two view modes share one model:

**Materials** — the default. Each face is painted with its outermost leaf's
real colour plus a procedural treatment drawn in the face's own UV space, so
grain, brick courses and metal sheen follow the perspective: wood gets wavy
grain, masonry gets courses, glazing goes translucent with a highlight, board
gets a fine speckle. Clicking a face opens the **wall editor**, which is a
direct view onto the physics inputs rather than a preset list:

| Control | Drives |
|---|---|
| Inner / outer leaf material | `density`, `E`, `ν`, `η` → mass law and `f_c` |
| Thickness, and number of layers | surface mass, `f_c`, bonding behaviour |
| Cavity depth | `f₀`, `f_l`, standing waves |
| Cavity fill | flow resistance → MAM damping, cavity absorption |
| How the leaves are joined | the bridging ceiling `Δ_max` |
| Layer bonding | `screwed` / `damped` / `laminated` |

Each leaf shows its live surface mass and coincidence frequency as you change
it, and the panel foot reports the resulting surface mass, build-up thickness,
STC, `f₀`, `f_c` and that surface's share of the escaping sound. Every surface
is independent — one wall can be concrete while the rest stay plasterboard —
with *Apply to all four walls*, *Apply to every surface* and *Reset* for the
common cases.

**Dimension handles.** Three round handles sit on the length, width and height
edges with dashed measure lines and live labels. Dragging one converts screen
movement into metres by projecting the drag onto that axis's on-screen
direction and dividing by its own pixel-per-metre scale, so it behaves
correctly from any camera angle. The sidebar sliders and the handles are two
views of the same value and stay in sync.

**Leakage** — the original heat map, kept as a second mode:

- Faces coloured by their share of escaping power on a green → yellow → red ramp.
- **Badges** overlaid on the face they belong to: **D**oor, **V**ent, **L**eak,
  **W**indow, **F**lanking. Radius scales with `√(percent)` and colour with the
  same heat ramp, so a dominant path is unmissable.
- **Animated escape plumes** — expanding rings from each significant leak, and from
  the source at the centre. Motion draws the eye to the problem faster than colour.
- **Explode slider** separates the faces so interior ones remain visible.
- **Drag** to orbit, **scroll** to zoom, **click** a face or badge to inspect it;
  the selection panel then lists every element on it with percentages and the
  maximum gain from fixing it.
- Back-facing faces render at 16 % opacity so the box reads as a solid while the
  far side stays legible.

The design intent: a leakage table is correct but abstract. Someone deciding
whether to spend £400 on a door needs to *see* that the door is 89 % of the problem.

### 3. Diagnosis
Severity-ranked cards (`critical → high → medium → info`), each with a named
mechanism, an explanation in plain language, and concrete fixes. This is the tab
that turns a prediction into advice.

### 4. Physics detail
- **Wall physics**: surface mass, build-up thickness, `f₀`, `f_l`, every `f_c`,
  `f₁₁`, cavity standing waves.
- **What limits each band** — the `limitedBy` vector rendered as frequency ranges
  against mechanism names (`mass (below MAM)`, `mass-air-mass resonance`,
  `cavity-coupled`, `decoupled`, `cavity standing wave`, `structural bridging`).
  This is the panel that answers *why* rather than *how much*.
- **Inside the booth**: RT60 at 125 and 500 Hz, treated fraction, first axial mode,
  the frequency above which a diffuse field exists, reverberant build-up.
- **Ventilation**: required vs specified airflow with a pass/fail, duct velocity,
  insertion loss per octave.
- **Cost** itemised, with an explicit note about what is excluded.

### 5. Optimiser
Target slider (15–60 dB(A)), budget slider (£200–8 000), checkboxes for which
groups to search. Outputs: verdict box, best single changes ranked by dB gained
with dB-per-£100, the Pareto front as a cost/level scatter with target and budget
lines drawn, the marginal-value table, and the recommended build with an
**Apply this design** button that writes it back into the controls.

### 6. Air-gap study
Choose two leaf materials and thicknesses, toggle cavity fill, and get overlaid TL
curves for 10/25/50/100/200/300 mm cavities plus a table of `f₀` and the four key
octave bands. Below it, the explanation of *when a deeper gap helps and when it
stops* — including the two cases people get wrong (below `f₀` it does nothing;
an empty deep cavity develops standing waves).

### 7. Material advisor
Material and thickness. Returns the three 0–5 scores, full physical properties,
the computed TL curve, the absorption curve where applicable, the plain-language
assessment and the warnings. This is where "acoustic foam does not block sound"
gets said in as many words.

### 8. Reality calibration
Measured inside / outside / background levels, weighting, and optional per-octave
measured spectrum. Returns predicted vs measured, overall error, spectral RMSE,
mean bias, the low/mid/high error profile, an accuracy grade, the residual
diagnosis, an overlay chart, and a suggested calibration with before/after RMSE.
The full measurement protocol is printed alongside, because a measurement taken
badly is worse than none.

### 9. Validation
The laboratory table live in the browser — 18 published constructions, predicted vs
published vs error, plus the two curve-shape comparisons plotted. Included in the
UI deliberately: a user is entitled to see the tool's own error bars without
reading the docs.

## Verdict presentation

Four things, in this order, because this is the order that matters:

1. **The chain** — inside → isolation → outside, with the outside card
   colour-coded (green ≤ 35, amber ≤ 45, red above).
2. **Audibility against background** — the plain-language verdict
   (*"Marginally audible. Detectable in a quiet moment if someone is listening for
   it."*) and the excess in dB. **A level without its background answers nothing.**
3. **The level scale** — a gradient bar with a pointer, annotated Silence / Quiet
   room / Very quiet / Normal quiet room / Conversation / Loud, so an unfamiliar
   number acquires meaning immediately.
4. **Criteria** — pass/fail with margins against WHO night noise, BS 8233 day and
   night, studio background (NC-25), private office, and the statutory nuisance
   indicative threshold. Each row carries its source in a tooltip.

## Accessibility and responsiveness

- Full light and dark theming via `prefers-color-scheme`, with all chart colours
  read from CSS custom properties at draw time so canvases follow the theme.
- Single-column reflow below 1080 px; tabs wrap; the 3D canvas and all charts
  resize with the container at device pixel ratio.
- Native form controls throughout — real `<select>`, `<input type=range>`,
  `<input type=checkbox>` — so keyboard navigation and screen-reader labelling work
  without custom ARIA scaffolding.
- Tabular numerals for every figure so digits do not jitter during live dragging.
- `touch-action: none` on the 3D canvas only, so page scrolling still works
  everywhere else on touch devices.

## Deliberate omissions

- **No dependencies.** Every chart, the 3D renderer and all layout are hand-written.
  An acoustic tool whose numbers cannot be traced from UI to equation without
  passing through a bundler is not auditable.
- **No auto-optimise on load.** The optimiser runs hundreds of simulations; it runs
  on an explicit button press.
- **No saved state.** The design object is plain serialisable JSON and trivially
  storable, but persistence is a deployment concern, not an engine one.

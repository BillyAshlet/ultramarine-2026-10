# Wind and plume

A small experiment for the 1985 Manchester 737 fire: does our solver show a pool fire leaning onto a fuselage as the wind rises?

Run the page from this folder (`python3 -m http.server 5192`). Re-run the numbers with `node tools/sweep.mjs`, `node tools/sensitivity.mjs` and `node tools/summary.cjs`.

## How it avoids circular reasoning

- **Fixed from the accident's published record, via Galea et al. 2017:** 16 m² pool, about 38 MW (their 35–40 MW), wind speeds.
- **Fixed against a textbook, before any wind ran:** `smagorinsky` 0.4, `burnTime` 3 s, against Heskestad's still-air plume. Do not retune them against the results below.
- **Only compared, never tuned to:** the AGA tilt correlation, and the paper's finding of a roughly 1 m gap at 1.5 m/s and contact at 2.0 m/s.
- **Assumed, and the results depend on them:** the pool's outline and the wind's angle off the nose.

## Results (0.5 m grid, 20 s average)

Still plume against Heskestad: within about 10% near the flame tip (12–14 m), then 50–70% too hot by 18–20 m. Peak speed is about 19 m/s against roughly 14 m/s.

Lean with no aircraft, against the AGA correlation:

| Wind (m/s) | Solver | AGA |
|---|---|---|
| 2 | 26° | 38° |
| 3 | 43° | 50° |
| 4 | 52° | 56° |

Gas above 300 °C against the fuselage, wind straight across:

| Wind (m/s) | Wings on: skin cells (of 1294) | Wings off: gap |
|---|---|---|
| 0 | 46 | 2.4 m |
| 1.5 | 63 | 1.9 m |
| 2 | 55 | 1.9 m |
| 3.5 | 47 | 1.3 m |

- The lean grows smoothly. **The paper's threshold does not appear.**
- With wings, hot gas already reaches the fuselage in still air, probably along the wing's underside. Moving the pool 2 m further out does not stop this. Without wings it never touches by 3.5 m/s. This may be partly an artefact of a wing one cell thick.
- With the wind 40° off the nose, contact falls away above about 2 m/s: the plume goes towards the tail instead.
- On a 0.35 m grid, the lean at 0 and 2 m/s changes by about 1°. The share of skin cells above 300 °C stays about the same at 2 m/s, and is about 1.3 times higher in still air.

## Conclusion so far

The solver gets the direction of the effect and rough tilt, but cannot yet confirm a threshold. The unknown pool outline and wind angle matter more than the solver's other errors. The next step is to read both from AAIB report 8/88, set them, and run again without touching the fire settings.

`300 °C` is an arbitrary line for "the plume"; the paper's own threshold for its plume surface is not known here.

`src/fluid3d.js` is an unchanged copy of `reference/fliud3d/src/fluid3d.js`.

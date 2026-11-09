# Wind and plume

A small experiment for the 1985 Manchester 737 fire: does our solver show a pool fire leaning onto a fuselage as the wind rises?

Run the page from this folder (`python3 -m http.server 5192`). Re-run the numbers with `node tools/calibrate.mjs`, `node tools/sweep.mjs`, `node tools/sensitivity.mjs` and `node tools/summary.cjs`. `node tools/budget.mjs` checks that the solver keeps heat.

## Two solvers

The first results were made with `src/windy.js` on `src/fluid3d.js` (a collocated grid). In the Duplex fire work we found that solver makes heat. After the pressure solve it zeroes any wind pointing into a wall (`blockWalls`), and its look-back advection then copies hot gas into the squeezed cells again and again. It does the same here against the ground (`budget-log.txt`):

| Heat check, no aircraft | Old solver | New solver |
|---|---|---|
| Domain + what has left, after 30 s, still air | 235% of the heat released | 100.0% |
| Same, wind 3 m/s | 140% | 100.0% |
| Heat carried up through the plane at 10 m / 18 m, still air (the fire releases 26.6 MW after radiation) | 62.6 / 63.4 MW | 26.5 / 26.5 MW |

So the old solver made more than twice the fire's heat in still air, but only 1.4 times as much in a 3 m/s wind. That made it too hot, and it also changed how the result depended on the wind.

The results below are now made with `src/windmac.js` on `src/mac3d.js`. `mac3d.js` is an unchanged copy of the Duplex's solver: wind on cell faces (a staggered grid), and heat and fuel moved face by face with a van Leer limiter, so what leaves a cell arrives next door. `windmac.js` adds what `windy.js` added: open sides and top, the wind, and the pool with the same random numbers. The old solver's results stay in `results/`, `sweep-log.txt` and `sensitivity-log.txt`. The new ones are in `results/mac/`, `sweep-log-mac.txt` and `sensitivity-log-mac.txt`. Run the old solver with `"solver":"old"` (or `tools/sweep.sh`).

## How it avoids circular reasoning

- **Fixed from the accident's published record, via Galea et al. 2017:** 16 m² pool, about 38 MW (their 35–40 MW), wind speeds.
- **Fixed against a textbook, before any wind ran:** `smagorinsky` 0.4 and `burnTime` 0.5 s, against Heskestad's still-air plume. The rule was written into `tools/calibrate.mjs` before any calibration run: of six pairs (Smagorinsky 0.2 or 0.4, burn time 0.5, 1.5 or 3 s), take the one closest to Heskestad's centreline temperature from 12 to 20 m. All six are in `calibration-log.txt`. Do not retune them against the results below. The old solver's pair was 0.4 and 3 s, chosen while it made heat.
- **Only compared, never tuned to:** the AGA tilt correlation, and the paper's finding of a roughly 1 m gap at 1.5 m/s and contact at 2.0 m/s.
- **Assumed, and the results depend on them:** the pool's outline and the wind's angle off the nose.

## Results (0.5 m grid, 20 s average), old solver → new

Still plume against Heskestad, centreline temperature as a share of his (his flame tip is at 11.4 m):

| Height | 12 m | 14 m | 16 m | 18 m | 20 m |
|---|---|---|---|---|---|
| Old | 92% | 113% | 133% | 153% | 173% |
| New | 81% | 95% | 109% | 123% | 136% |

From 12 to 16 m the new plume is close to Heskestad's. It still cools too slowly with height, and every pair tried does the same (`calibration-log.txt`). Keeping heat explains part of the old "50–70% too hot", but not all of it. Peak speed is 18 m/s (old 19), against about 14 m/s at Heskestad's flame tip.

Lean with no aircraft, against the AGA correlation:

| Wind (m/s) | Old | New | AGA |
|---|---|---|---|
| 2 | 26° | 29° | 38° |
| 3 | 43° | 47° | 50° |
| 4 | 52° | 55° | 56° |

Wind straight across. "Skin cells" are air cells against the fuselage whose mean gas is above 300 °C (1294 with wings, 1310 without). The wings-off gap is the shortest distance from gas above 300 °C to the fuselage's surface (`tools/where-hot.mjs`). The cells are 0.5 m, so read it to about ±0.5 m.

| Wind (m/s) | Wings on: skin cells, old → new | Wings off: gap, old → new |
|---|---|---|
| 0 | 46 → 16 | 2.4 → 2.1 m |
| 1 | 58 → 23 | 1.9 → 1.9 m |
| 1.5 | 63 → 30 | 1.9 → 1.4 m |
| 2 | 55 → 36 | 1.9 → 0.9 m |
| 2.5 | 49 → 51 | 1.4 m → touching, 18 skin cells |
| 3 | 46 → 76 | 1.4 m → touching, 46 |
| 3.5 | 47 → 127 | 1.3 m → touching, 92 |

What changed:

- **Without wings, the plume now reaches the fuselage.** The gap closes steadily, to about 1.4 m at 1.5 m/s and 0.9 m at 2 m/s, and gas above 300 °C touches the fuselage from 2.5 m/s. The old solver never got closer than 1.3 m by 3.5 m/s. The paper has a roughly 1 m gap at 1.5 m/s and contact at 2.0 m/s. We get the same order of events about 0.5 m/s later, which on this grid is about one cell of gap. Nothing was tuned to this.
- **With wings, skin heating now rises with the wind**: slowly up to 2 m/s, then quickly (36 cells at 2 m/s, 127 at 3.5 m/s). The old solver peaked at 1.5 m/s and then fell. So the old finding that "the paper's threshold does not appear" no longer holds as stated: the curve bends upward between 2 and 3 m/s. It does not jump, so there is still no sharp threshold to point at.
- **Still air, wings on:** hot gas still reaches the fuselage, about a third as much as before (16 cells, old 46), mostly at or below the wing's level. This may be partly an artefact of a wing one cell thick.
- **With the wind 40° off the nose**, contact still falls away, but only at 1.5–2 m/s (no cells above 300 °C). It comes back from 2.5 m/s (8, 19 and 31 cells at 2.5, 3 and 3.5 m/s), where the old solver stayed at zero.
- **Pool further out** (by 1 or 2 m): with the old solver, skin heating fell as the wind rose. Now it is flat to 2.5 m/s and rises from 3 m/s. With the pool 1 m further out: 12, 14, 14, 16, 35 and 58 cells at 0, 1.5, 2, 2.5, 3 and 3.5 m/s.
- **Grid:** on a 0.35 m grid, the lean at 0 and 2 m/s changes by 2° and 0° (old: about 1°). The share of skin cells above 300 °C at 2 m/s is 0.9 times the coarse grid's (old: 0.9). In still air it is 1.7 times (old: 1.3), so the grid does not settle the small still-air contact.

## Conclusion so far

On a solver that keeps heat, the free plume's lean moves closer to the AGA correlation. Without wings, the plume approaches and then touches the fuselage in the same order as the paper, about 0.5 m/s later. With wings, skin heating rises sharply between 2 and 3 m/s. The old conclusion was "a smooth lean and no threshold"; changing only the solver changed that, so part of the old conclusion came from the solver making heat, most of all in still air.

Still open:
- The plume still cools too slowly above 16 m.
- The unknown pool outline and wind angle still matter as much as the wind does (40° off the nose behaves differently).
- The still-air contact under the wing depends on the grid.

The next step is unchanged: read the pool outline and wind angle from AAIB report 8/88, set them, and run again without touching the fire settings.

`300 °C` is an arbitrary line for "the plume"; the paper's own threshold for its plume surface is not known here.

`src/fluid3d.js` is an unchanged copy of `reference/fliud3d/src/fluid3d.js`, and `src/mac3d.js` of `reference/3d rebuilt scene/室内建筑/duplex-fire/src/mac3d.js` (at commit a4ad2df).

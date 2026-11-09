# Duplex fire, step 1

The whole NIBS Duplex in the smoke solver, with a fire you can move. This is the first step of the chain we want to follow:

> fire → smoke and heat → a circuit fails → the exhaust fan stops → smoke builds up → when each detector goes off

This step covers only the first link: fire, smoke and heat.

## Run it

It reads the converted geometry in `../duplex-overlay/data`, which is not in git: build it first (see `../duplex-overlay/README.md`). Then serve the parent folder, so both are reachable:

```
cd ..   # 室内建筑
python3 -m http.server 5196
```

and open http://localhost:5196/duplex-fire/.

- Fire on Level 1 / Fire on Level 2, then click a floor on that storey: a see-through flame with a light pillar follows the pointer, grey where it can't go, and the other storey is drawn as a screen of dots meanwhile so it neither hides this one nor gets mistaken for it; so is anything nearer the eye than the ghost flame, so the walls in front don't hide where the fire is going. A click puts the fire there and restarts it from nothing; Esc cancels. While placing, a two-finger swipe on a trackpad turns the view instead of zooming (the house follows the fingers); a pinch still zooms. The storey is chosen first because guessing it from a click (the floor in front, Shift for the one below) still read as ambiguous: seen from above, the upper floor covers nearly all of the lower one. Dragging the flame moves it along its own storey. Double-clicking a floor no longer moves the fire: it was too easy to do while aiming at a door.
- Point at a door and it breathes, light and dark, even through walls. Double-click it to open or shut it; the fire keeps burning, so you can shut a door halfway through. The leaf swings in about half a second, an orange sector on the floor shows its swing as on an architect's plan, and the door glows for a moment so you can see which one moved. Doors stay more solid than the walls (never fainter than 0.6), or they vanish at the walls' see-through default. Opening frees the doorway as the leaf starts to move; shutting seals it only when the leaf reaches the frame. The IFC data has no hinge side, so the leaf is hinged at the doorway's low end and swings into the door's own room: a guess. The four outside doors stay shut: the solver has no outdoors yet.
- Both shows the whole house see-through; Level 1 / Level 2 cut it just under that storey's ceiling.
- Walls sets how see-through walls, floors, doors and furniture are (ceilings thin out faster, or two of them stacked into a haze over everything). The sun's shadows fade with it, so a faint wall throws a faint shadow. At 1 the walls are solid and hide the smoke behind them.
- Smoke sets how dense smoke (and heat, in the thermal view) is drawn, from ×0.1 to ×3. Drawing only; the simulation is the same.
- Gas, Electrical, Water and Heating show the MEP file's services in the overlay's colours, only to see where they run; they are not in the simulation. Pipes has its own opacity, apart from the walls'.
- Growth picks the design fire's growth rate.

The look (floorboards, tiles, skirting, low afternoon sun through the windows, soft shadows) is `src/dressing.js`, adapted from fliud3d's. It changes only the drawing. See-through surfaces do not write depth, so smoke behind a wall is drawn over the wall rather than tinted by it.

`node tools/bench.mjs [cell] [seconds] [room] [growth]` runs it headless and prints speed and where the smoke has got to. It needs a `node_modules` with `three` next to it; a symlink to `../../../fliud3d/node_modules` works.

## What is in it

| | From | Notes |
|---|---|---|
| Walls, floors, beams | Duplex Architecture IFC | voxelized at 20 cm with `voxelize.js` from fliud3d; the 12 cm stud partitions, thinner than a cell, get extra rays along their centre line (`addThinWalls` in `house.js`) |
| Ceilings | Duplex Architecture IFC | a few cm thick, so they are marked by ray pairs, keeping the holes over the stairs |
| Windows | Duplex Architecture IFC | all closed |
| Doors | Duplex Architecture IFC | inside doors start open, the four outside doors shut; inside doors can be opened and shut while it runs |
| Stairs, railings, furniture | not solid | thinner than a cell, they would plug the stairwell |
| Fire | **assumed** | a t² design fire (slow 2.93, medium 11.72, fast 46.9, ultra-fast 187.6 W/s², the standard values) up to 1 MW, on 0.6 × 0.6 m of floor |
| Solver | `mac3d.js` | wind on cell faces (a staggered grid); heat, soot and fuel moved face by face so their totals are kept and nothing crosses a wall. Burning, real units and eddy mixing as wind-plume's `windy.js`, sealed; fuel burns over 0.5 s |
| Walls taking heat | `walls.js` | every face as 12.7 mm gypsum board: EN 1991-1-2's convection and radiation to the surface, MQH's sqrt(kρc/t) into it |
| Smoke | **assumed** | soot in g/m³, made in proportion to what burns: heat of combustion 25 MJ/kg, soot yield 0.05. Both are placeholders, not looked up; soot yield varies about tenfold between wood and foam |

`voxelize.js` is an unchanged copy. `fluid3d.js` and `windy.js` are unchanged copies no longer used here: they made heat out of nothing (see Known problems, and the top of `mac3d.js`). `smoke-pass.js` is a copy with two changes, listed at its top.

## Checked

- **Grid**: 44 × 32 × 89 cells at 20 cm, 81,850 of them air.
- **The two units are sealed from each other**: flood-filling the air gives one region per unit, each holding all ten of its rooms and nothing of the other's.
- **A shut door seals its room**: with every inside door shut, flood-filling from the middle of each upstairs bedroom, bathroom and utility room reaches neither the hallway nor the room next door. Before the thin partitions were fixed, four upstairs walls were missing from the grid entirely, and in a 70 s ultra-fast fire a bedroom behind a shut door still filled to almost half the smoke of the one with its door open. After the fix, the same test (A202's door shut, ultra-fast fire in A102, 70 s, about 920 kW) gives 1.0 mg/m³ of soot above 1.2 m in A202 against 29 in A203 next door, whose door is open, and 138 in the hallway.
- **Speed**: about 43 ms a step under node, 41 ms in the browser, 44–60 ms while drawing. At 0.05 s a step that is 0.8–1.2 times real time.
- **Heat and soot are kept**: a fast fire in A102, walls off, after 60 s: the heat in the air plus the fuel not yet burned is 99.7% of the heat the fire put in (the old solver: 315%), and the house holds 6.72 g of soot of 6.72 g made. With walls on, after 90 s (380 kW): air, unburned fuel and walls together 99.6%, the walls having taken 47%. (A measured 1 MW room fire put about 74% into its walls, Hamins et al. 2008, over a longer burn.) The leftover net outflow of a cell after the pressure solve is about 10⁻⁷ m/s.
- **The plume against Heskestad**: a 150 kW fire held steady in A102, centreline averaged over 15 s. From 1.7 to 2.3 m it is 77–111% of Heskestad's temperature and 81–110% of his speed; at 1.3 m, just over the flame, 55% and 81%. At 60 kW the same: within about 15% from 1 m above the flame, too cool and slow nearer it. A 20 cm grid gives these fires 1.5–2 cells across, where FDS advises 4 or more.
- **Smoke goes where hot gas goes**: a fast fire in A102 Living Room after 90 s (380 kW), soot in g/m³ by height above each floor:

| Room | 0.3 m | 1.0 m | 1.5 m | 2.0 m | 2.4 m |
|---|---|---|---|---|---|
| A102 Living Room (fire) | 0.047 | 0.044 | 0.068 | 0.318 | 1.036 |
| A103 Kitchen | 0.001 | 0.003 | 0.018 | 0.239 | 0.741 |
| A101 Foyer | 0.005 | 0.012 | 0.014 | 0.070 | 0.301 |
| A105 Stair | 0.008 | 0.025 | 0.028 | 0.065 | 0.197 |
| A201 Hallway (upstairs) | 0.013 | 0.013 | 0.033 | 0.072 | 0.107 |
| A203 Bedroom 2 (upstairs) | 0.001 | 0.002 | 0.011 | 0.030 | 0.072 |

A layer under the ceiling of the fire room, spreading through the open plan and up the stairs. These numbers have not been compared with any experiment, and were measured before the thin partitions were fixed: upstairs they will have changed.

## Known problems

- **Fixed: the old solver made heat.** With walls off, after 60 s the air held three times the heat the fire had made, nearly all of it in the row of cells under the ceiling: fluid3d.js zeroed the updraft there after the pressure solve (blockWalls), and its look-back advection then copied the plume into that row. The same solver lost three quarters of the soot at the ceiling, which was being scaled back up every step. `mac3d.js` replaces it. The wind-plume experiment uses the old solver, so its plume being 50–70% too hot higher up may have the same cause.
- **Walls take heat but have no temperature of their own.** The radiation part takes the wall surface as ambient, and every face is gypsum board.
- **No oxygen.** The fire keeps growing to 1 MW in a sealed house, where a real one would run short of air.
- **The engine has not been compared with a room fire**, only with Heskestad's free plume (above).
- Gas does not expand when heated (the solver is incompressible), so a fire does not push smoke out of a room by its own volume.

## Next

Step 2: the six smoke detectors (positions from the MEP file) as probes, and the time each one goes off. Their alarm threshold is being looked up separately.

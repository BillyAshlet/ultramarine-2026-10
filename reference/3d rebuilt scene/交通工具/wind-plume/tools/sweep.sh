#!/bin/zsh
# Frozen before any wind run: smagorinsky 0.4, burnTime 3, chosen so a still
# plume matches Heskestad's correlation near the flame tip. Do not retune these
# against the wind results or the paper; that would make the comparison circular.
# This is the old solver's sweep (fluid3d.js + windy.js), kept to reproduce
# results/; the heat-keeping solver's is tools/sweep.mjs.
cd "$(dirname "$0")/.."
BASE='"solver":"old","smagorinsky":0.4,"burnTime":3,"seconds":40,"averageFrom":20'
{
  for w in 0 1 2 3 4; do echo "{\"name\":\"free-w$w\",\"wind\":$w,\"yaw\":90,\"aircraft\":false,\"saveVolume\":false,$BASE}"; done
  for y in 90 40; do for w in 0 0.5 1 1.5 2 2.5 3 3.5; do echo "{\"name\":\"ac-y$y-w$w\",\"wind\":$w,\"yaw\":$y,\"aircraft\":true,$BASE}"; done; done
} | xargs -P 8 -I{} node tools/run.mjs '{}'
echo SWEEP DONE

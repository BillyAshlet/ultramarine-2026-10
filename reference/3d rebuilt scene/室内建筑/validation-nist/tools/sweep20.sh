#!/bin/sh
# Test 20, bedroom fire with the door shut, three ways: as tested (shut, gaps
# let through), shut tight, and the same fire with the door open, which was
# never tested and is the model's prediction of what the door changed.
cd "$(dirname "$0")/.."
node tools/run.mjs '{"name":"sdc20-leaky","test":"sdc20"}' &
node tools/run.mjs '{"name":"sdc20-closed","test":"sdc20","bedroom3Door":"closed"}' &
node tools/run.mjs '{"name":"sdc20-open","test":"sdc20","bedroom3Door":"open"}' &
wait
echo SWEEP20 DONE

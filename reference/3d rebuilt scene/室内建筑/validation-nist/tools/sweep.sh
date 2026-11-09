#!/bin/sh
# The base case for both flaming-chair tests, then one change at a time.
cd "$(dirname "$0")/.."
node tools/run.mjs '{"name":"sdc25-base","test":"sdc25"}' &
node tools/run.mjs '{"name":"sdc26-base","test":"sdc26"}' &
node tools/run.mjs '{"name":"sdc25-dh15","test":"sdc25","heatOfCombustion":15e6}' &
node tools/run.mjs '{"name":"sdc25-dh25","test":"sdc25","heatOfCombustion":25e6}' &
wait
node tools/run.mjs '{"name":"sdc25-h5","test":"sdc25","wallH":5}' &
node tools/run.mjs '{"name":"sdc25-h30","test":"sdc25","wallH":30}' &
node tools/run.mjs '{"name":"sdc25-cell24","test":"sdc25","cell":0.24}' &
node tools/run.mjs '{"name":"sdc25-cell15","test":"sdc25","cell":0.15,"dt":0.04}' &
wait
echo SWEEP DONE

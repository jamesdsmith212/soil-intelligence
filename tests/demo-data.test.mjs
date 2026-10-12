import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anchorForField, estimateCurrentStatus } from '../app/planner/v2/planner-v2-adapter.ts';

const soil=JSON.parse(readFileSync(new URL('../data/soil-data.json',import.meta.url)));
const nutrients=JSON.parse(readFileSync(new URL('../data/nutrient-data.json',import.meta.url)));
test('demo is synthetic, contains sparse tests and retains the untested field',()=>{
  assert.equal(soil.synthetic,true); assert.equal(nutrients.synthetic,true);
  assert.equal(soil.fields.length,4); assert.equal(soil.grids.length,16);
  assert.equal(soil.grids.filter(g=>g.results.clay).length,6);
  assert.equal(soil.fields.at(-1).results.length,0);
});
test('synthetic anchors and rotations work with the retained v2 engine',()=>{
  const field=soil.fields[0]; const model=nutrients.fields[0];
  const anchor=anchorForField(field,model);
  assert.equal(anchor.valid,true);
  assert.equal(anchor.pMgL,11); assert.equal(anchor.kMgL,98);
  const missing=anchorForField(soil.fields[3],nutrients.fields[3]);
  assert.equal(missing.valid,false);
  assert.equal(model.rotations.filter(r=>r.economicForecast).length,3);
});
test('demo access must be explicit and both datasets must be marked synthetic',()=>{
  const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');
  assert.match(worker,/env\.DEMO_MODE === "true"[\s\S]*soilData[\s\S]*synthetic === true[\s\S]*nutrientData[\s\S]*synthetic === true/);
  assert.match(worker,/if \(!password\)[\s\S]*503/);
});
test('demo budgets consume the 2026 crop and include confirmed FYM without inventing an untested anchor',()=>{
  const operationalCosts={haulagePerTonne:0,handlingPerTonne:0,spreadingPerTonne:0,spreadingPerHa:12,fixedPassCostPerHa:0};
  const estimate=(index)=>estimateCurrentStatus({fieldModel:nutrients.fields[index],soilField:soil.fields[index],products:nutrients.products,operationalCosts,recycledOverride:null});
  const arable=estimate(0);
  assert.deepEqual(arable.status.includedRemovalYears,[2026]);
  assert.ok(arable.status.central.pMgL<arable.anchor.pMgL);
  assert.ok(arable.status.central.kMgL<arable.anchor.kMgL);
  const mixed=estimate(1);
  assert.equal(mixed.status.includedApplications.confirmed,1);
  assert.equal(mixed.status.applicationTrace.confirmedOnly.length,1);
  assert.ok(Number.isFinite(mixed.status.central.pMgL));
  assert.equal(estimate(3).status.central,null);
});

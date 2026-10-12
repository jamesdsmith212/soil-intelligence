import assert from "node:assert/strict";
import test from "node:test";

import {
  interpolateSpatialValue,
  selectInterpolationParameters,
} from "../app/spatial-interpolation.ts";

const samples = [
  {
    id: "a1",
    fieldId: "field-a",
    longitude: -1.7,
    latitude: 55.5,
    value: 10,
    supportRadiusM: 56,
  },
  {
    id: "a2",
    fieldId: "field-a",
    longitude: -1.699,
    latitude: 55.5,
    value: 12,
    supportRadiusM: 56,
  },
  {
    id: "b1",
    fieldId: "field-b",
    longitude: -1.6995,
    latitude: 55.5,
    value: 100,
    supportRadiusM: 56,
  },
];

test("management-responsive smoothing never borrows from another field", () => {
  const target = {
    fieldId: "field-a",
    longitude: -1.69955,
    latitude: 55.5,
  };
  const constrained = interpolateSpatialValue(
    target,
    samples,
    "field-constrained",
    { power: 2, neighbours: 3 },
  );
  const crossField = interpolateSpatialValue(
    target,
    samples,
    "cross-field",
    { power: 2, neighbours: 3 },
  );

  assert.ok(constrained);
  assert.ok(crossField);
  assert.ok(constrained.value >= 10 && constrained.value <= 12);
  assert.ok(crossField.value > constrained.value);
  assert.equal(constrained.contributors, 2);
});

test("smoothing refuses to extrapolate beyond the declared support distance", () => {
  const prediction = interpolateSpatialValue(
    { fieldId: "field-a", longitude: -1.5, latitude: 55.5 },
    samples,
    "field-constrained",
    { power: 2, neighbours: 3 },
    225,
  );
  assert.equal(prediction, null);
});

test("interpolation parameters are selected by leave-one-out RMSE", () => {
  const calibration = Array.from({ length: 6 }, (_, index) => ({
    id: `sample-${index}`,
    fieldId: "field-a",
    longitude: -1.7 + index * 0.001,
    latitude: 55.5,
    value: 10 + index,
    supportRadiusM: 56,
  }));
  const parameters = selectInterpolationParameters(
    calibration,
    "field-constrained",
  );
  assert.ok([1, 1.5, 2, 2.5, 3].includes(parameters.power));
  assert.ok([3, 5, 8].includes(parameters.neighbours));
  assert.ok(parameters.rmse !== null && parameters.rmse >= 0);
  assert.equal(parameters.validatedSamples, calibration.length);
});


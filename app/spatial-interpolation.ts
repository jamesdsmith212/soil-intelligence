export type SpatialSample = {
  id: string;
  fieldId: string;
  longitude: number;
  latitude: number;
  value: number;
  supportRadiusM: number;
};

export type InterpolationPolicy = "field-constrained" | "cross-field";

export type InterpolationParameters = {
  power: number;
  neighbours: number;
  rmse: number | null;
  validatedSamples: number;
};

export type InterpolationPrediction = {
  value: number;
  uncertainty: number;
  contributors: number;
  effectiveSamples: number;
  nearestDistanceM: number;
};

const EARTH_RADIUS_M = 6_371_008.8;

export const distanceMetres = (
  left: Pick<SpatialSample, "longitude" | "latitude">,
  right: Pick<SpatialSample, "longitude" | "latitude">,
) => {
  const latitude1 = (left.latitude * Math.PI) / 180;
  const latitude2 = (right.latitude * Math.PI) / 180;
  const deltaLatitude = ((right.latitude - left.latitude) * Math.PI) / 180;
  const deltaLongitude = ((right.longitude - left.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
};

const eligibleSamples = (
  samples: SpatialSample[],
  fieldId: string,
  policy: InterpolationPolicy,
) =>
  policy === "cross-field"
    ? samples
    : samples.filter((sample) => sample.fieldId === fieldId);

const weightedPrediction = (
  target: { longitude: number; latitude: number; fieldId: string },
  samples: SpatialSample[],
  policy: InterpolationPolicy,
  power: number,
  neighbours: number,
  maxDistanceM = Number.POSITIVE_INFINITY,
): InterpolationPrediction | null => {
  const candidates = eligibleSamples(samples, target.fieldId, policy)
    .map((sample) => {
      const centreDistanceM = distanceMetres(target, sample);
      return {
        sample,
        centreDistanceM,
        // Regularise distance by the composite sample's footprint. Unlike
        // subtracting the radius, this avoids a flat disc and a sharp edge.
        supportDistanceM: Math.hypot(centreDistanceM, Math.max(1, sample.supportRadiusM)),
      };
    })
    .filter((candidate) => candidate.centreDistanceM <= maxDistanceM)
    .sort((left, right) => left.supportDistanceM - right.supportDistanceM)
    .slice(0, neighbours);

  if (!candidates.length) return null;

  const weighted = candidates.map((candidate) => ({
    ...candidate,
    weight: 1 / candidate.supportDistanceM ** power,
  }));
  const weightTotal = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  const value =
    weighted.reduce(
      (sum, candidate) => sum + candidate.weight * candidate.sample.value,
      0,
    ) / weightTotal;
  const variance =
    weighted.reduce(
      (sum, candidate) =>
        sum + candidate.weight * (candidate.sample.value - value) ** 2,
      0,
    ) / weightTotal;
  const squaredWeightTotal = weighted.reduce(
    (sum, candidate) => sum + candidate.weight ** 2,
    0,
  );

  return {
    value,
    uncertainty: Math.sqrt(Math.max(0, variance)),
    contributors: weighted.length,
    effectiveSamples:
      squaredWeightTotal > 0 ? weightTotal ** 2 / squaredWeightTotal : 0,
    nearestDistanceM: weighted[0].centreDistanceM,
  };
};

export const selectInterpolationParameters = (
  samples: SpatialSample[],
  policy: InterpolationPolicy,
): InterpolationParameters => {
  const powers = [1, 1.5, 2, 2.5, 3];
  const neighbourCounts = [3, 5, 8];
  let best: InterpolationParameters = {
    power: 2,
    neighbours: 5,
    rmse: null,
    validatedSamples: 0,
  };

  for (const power of powers) {
    for (const neighbours of neighbourCounts) {
      const residuals = samples.flatMap((target) => {
        const prediction = weightedPrediction(
          target,
          samples.filter((sample) => sample.id !== target.id),
          policy,
          power,
          neighbours,
        );
        return prediction ? [prediction.value - target.value] : [];
      });
      if (residuals.length < 3) continue;
      const rmse = Math.sqrt(
        residuals.reduce((sum, residual) => sum + residual ** 2, 0) /
          residuals.length,
      );
      if (best.rmse === null || rmse < best.rmse) {
        best = {
          power,
          neighbours,
          rmse,
          validatedSamples: residuals.length,
        };
      }
    }
  }

  return best;
};

export const interpolateSpatialValue = (
  target: { longitude: number; latitude: number; fieldId: string },
  samples: SpatialSample[],
  policy: InterpolationPolicy,
  parameters: Pick<InterpolationParameters, "power" | "neighbours">,
  maxDistanceM = 225,
) =>
  weightedPrediction(
    target,
    samples,
    policy,
    parameters.power,
    parameters.neighbours,
    maxDistanceM,
  );

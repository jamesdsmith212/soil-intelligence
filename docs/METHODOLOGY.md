# Methodology and limits

## Soil maps

Field views use the mean of available grid results where appropriate, whole-field composite evidence where available, or explicitly labelled interpolation of suitable stable properties. Missing observations remain missing.

The smoothed view uses local inverse-distance weighting, with leave-one-out error used to select interpolation parameters. It renders continuous vector contours rather than enlarging a grid bitmap. P, K, pH and other management-responsive metrics remain field-constrained. Texture can use nearby measurements across boundaries. Within measured polygons, support is retained; outside them, extrapolation is restricted to the declared support distance.

A sampled cell represents a composite of cores, not a precise measurement at every point inside it. Sparse samples, irregular sampling patterns and uncertain boundaries limit spatial inference. A single sample supports a constant local estimate, not evidence of detailed within-cell variation. Cross-validation error is not a complete spatial uncertainty model.

Colours use a single scale and preserve laboratory index bands across displayed units. Lab methods, land use and index systems still matter. Above target does not mean agronomically better.

## Guidance

Interpretation compares RB209, AHDB/GREATsoils, SRUC/FAS and the Organic Research Centre. Agreement may be grouped; differing source scopes or targets remain separate. Permanent grass, mixed ley/arable rotations and permanent arable receive different context. Not every laboratory metric has a universal target.

Reference links are retained in `app/agronomy.ts`; publications are not redistributed. This is a software synthesis, not an official implementation certified by any publisher.

## Nutrient planning

The improved engine follows a measured soil anchor through recorded nutrient additions and estimated crop/straw removal, then models a forecast rotation and proposed applications. Application evidence cases, product effectiveness and soil-build coefficients distinguish uncertainty from confirmed nutrient input.

The soil-test concentration response to a nutrient balance is uncertain and site-dependent. The build coefficients in `app/domain/correction-requirement.ts` are explicitly uncalibrated illustrative scenarios. They are not a validated kg-to-ppm conversion. Soil index labels are band classifications, not a linear stock measure.

The crop-response functions, thresholds and maximum losses are planning priors. They need crop-, soil-, method- and region-specific calibration. Limited evidence, missing costs and unsuitable crops should remain visible; uncertainty is not a promise of yield benefit. Grass income is not automatically inferred from a wheat-equivalent response.

NPV separates application cost, uncertain crop response/value and, where enabled, terminal soil-capital value. It must not credit indefinitely increasing crop benefit above the relevant response plateau. Terminal value is an explicit scenario assumption, not independently realised revenue. Nutrient interactions must not be double counted.

All demo yields, soil measurements, crop values, material prices and application records are invented. They do not imply an effective recommendation or current market price. No regulatory compliance, nutrient-loss, environmental, manure-storage or food-safety determination is supplied by this application. Obtain qualified local agronomic advice before applying nutrients.

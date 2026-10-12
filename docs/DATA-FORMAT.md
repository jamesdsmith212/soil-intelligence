# Data format

The runnable fixtures are `data/soil-data.json` and `data/nutrient-data.json`. The deterministic generator is the complete, readable example of their structure. UI contracts are also defined in `app/SoilGridExplorer.tsx` and `app/planner/legacy/NutrientPlannerLegacy.tsx`.

## Soil data

Top-level keys: `generatedAt`, `synthetic`, `sources`, `fields`, `grids`, `metrics`.

- Fields have a stable `id`, name, area, GeoJSON Polygon/MultiPolygon geometry and dated results. The nutrient planner uses an explicitly selected result with `pValue` and `kValue` as its anchor.
- Results include `dateSort`, crop context, optional `samplingGridId`, and a `metrics` dictionary. Measurement objects carry reported value, unit, method and optional laboratory index/band, censoring operator or interpretation.
- Grids have a unique ID, field link, centroid, actual geometry, measured results and optional sample/date references. Empty results mean unmeasured, not zero.
- Metric metadata specifies units, numeric/categorical kind, counts, index availability and interpolation boundary policy.

Measurements in different extraction methods or units are not automatically interchangeable. Do not create an RB209 index for a broad-spectrum total-element measurement. Preserve detection limits and reported bands.

`cross-field` is appropriate only for stable properties such as measured texture. Management-responsive nutrients use `field-constrained`. A centroid is not a substitute for a validated grid polygon.

## Nutrient data

Top-level keys: `schemaVersion`, `generatedAt`, `synthetic`, `modelAsAt`, `sources`, `model`, `products`, `fields`.

- Each field links by `fieldId` and selects an exact `testDate`, with rotations and recorded applications.
- Crop-year records distinguish historical removal from economic forecast years, yields, uncertainty, straw removal and removal factors.
- Products separate nutrient percentages, material prices, operating costs and effectiveness. Missing values should be `null`, not invented zeroes. The demo's zero transport/handling costs are explicit example assumptions, not missing data.
- Recorded applications retain date, rate, evidence and nutrient amounts. An unquantified manure mention must not receive nutrient credit.
- The improved planner uses the domain-engine defaults where the older payload does not supply an override; review those defaults before using a private dataset.

N, P2O5 and K2O are not interchangeable element/oxide units. Products use percentage nutrient analysis and application rates in kg/ha, with explicit conversion for t/ha.

## Saved plans

The supplied migrations create empty `nutrient_plans` and `nutrient_plan_versions` tables. No saved plans or database snapshots are distributed. Versioned plan records distinguish `legacy_v1` from `nutrient_planner_v2`; an improved plan does not silently overwrite a legacy plan.

All demo IDs begin with `demo-`. The public-data check rejects replacement fixtures with real identifiers or non-schematic coordinates. Real datasets belong in a private downstream repository, never a contribution to this one.

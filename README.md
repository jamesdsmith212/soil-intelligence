# Soil Intelligence

Soil test maps and nutrient planning, with **only synthetic demo data** in this repository.

The application combines field histories, hectare-grid views, continuous interpolated maps, source-by-source agronomic interpretation, crop nutrient budgets and uncertain financial scenarios. It is decision-support software, not a fertiliser prescription or a validated yield forecast.

## Run locally

Requires Node.js 22.13+ and npm. Node.js 24 is tested.

```sh
npm ci
npm run db:migrate
npm run dev
```

Open the Local URL printed by the development server. No account or passphrase is needed for the explicitly synthetic demo. The demo uses a local Cloudflare D1 database; saved plans belong to this checkout, not any existing farm deployment.

```sh
npm run typecheck
npm test
npm run demo:generate
```

`demo:generate` deterministically regenerates both demo datasets. It never reads spreadsheets, lab reports, boundaries, private prices or farm records.

## What is included

- One map for field histories, sampling grids and continuous surfaces.
- Core, texture and trace metric filters; reported units and indices.
- Consistent legends, expandable explanations and land-use-aware guidance.
- Timeline and last-tested views, plus per-area evidence and history.
- Map-only zoom, Shift-click field fitting, panning and reset.
- Farm-wide and per-field nutrient planning, with FYM among the example products.
- Crop removal, straw assumptions and recorded-application evidence.
- Staged corrections, uncertain P/K response, crop value, costs and NPV.
- Original and improved planning engines, versioned plans and exports.

The demo has four invented fields, including an untested field, 16 schematic grid cells and 17 metrics. Texture and trace measurements are deliberately sparse. Field names, coordinates, results, crop rotations, application records and product prices are invented—not shuffled, shifted, redacted or derived from a real farm dataset.

## Data and methodology

See [data format](docs/DATA-FORMAT.md), [model limitations](docs/METHODOLOGY.md), and [public-release checks](docs/PUBLIC-RELEASE.md).

The source references RB209, AHDB/GREATsoils, SRUC/FAS and the Organic Research Centre. Those publications remain subject to their publishers' rights; copies of the publications are not included. Links and our software's interpretation are not an endorsement by those organisations.

The inherited planning timeline is a 2026 baseline with 2027–2029 example forecasts. Review the explicit year assumptions when adapting it. Soil-build and response coefficients are scenario assumptions, not universally valid scientific conversions.

## Real deployments

This repository is intended to stay data-free except for its synthetic fixtures. Use a **separate private checkout or private downstream repository** for real farm data. Never commit lab reports, boundaries, prices, exports, secrets or production data to this public repository.

For a private deployment:

1. Set `DEMO_MODE` to `"false"` in your private deployment configuration.
2. Configure your own `SOIL_VIEWER_PASSWORD` secret; no production credential is included here.
3. Create your own D1 database and replace the placeholder database ID.
4. Apply the empty-schema migrations to that database.
5. Supply your own validated data, with the `synthetic` marker removed or set to `false`.
6. Build and deploy using your own Cloudflare account and review security before sharing.

Anonymous demo access requires **both** datasets to be explicitly marked synthetic and `DEMO_MODE="true"`. Missing credentials otherwise fail closed. The source carries no hosting project ID, production database binding or connection to an existing website. No deployment is created by cloning the repository.

```sh
npm run build
```

Cloudflare/Vinext deployment and D1 configuration are intentionally account-specific. Do not deploy the placeholder database ID, and do not use anonymous demo mode with actual farm data.

## Contributions

See [contributing](CONTRIBUTING.md) and [security](SECURITY.md). Contributions must use invented fixtures and pass `npm run privacy:check` as well as the build and tests.

No private source history is included. This repository starts with a new initial commit.

## Licence

The project code and invented demo fixtures are available under the [MIT licence](LICENSE). Third-party packages and linked guidance retain their respective licences and rights.

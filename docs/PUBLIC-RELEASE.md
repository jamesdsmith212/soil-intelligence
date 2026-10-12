# Public-release boundary

This repository is an allowlisted source extraction with fresh Git history, not a clone of a private deployment.

Included: reusable application/engine code, generic empty database schemas, synthetic-data generation, synthetic fixtures, selected data-independent tests, generic configuration and these documents.

Excluded:

- Real field names, identifiers, boundaries, grid centroids and polygons.
- Soil readings, sample references, collection records and laboratory PDFs/images.
- Actual rotations, harvest volumes, applications, private quotes and product analyses.
- Saved plans, exports, SQLite/D1 data and runtime state.
- Environment files, passphrases, credentials and personal filesystem paths.
- Hosting project identities, private remote URLs, proprietary import scripts and private audit files.
- Private Git history, branches, tags and commit metadata.

The synthetic fixtures are generated independently. No real measurement is transformed into a demo measurement and no actual boundary is translated into a demo polygon.

`npm run privacy:check` rejects non-demo field/product IDs, non-schematic grid coordinates, private runtime files, hosting identifiers, local paths and common secret signatures. It is a release guardrail, not a proof that arbitrary future contributors cannot leak information. Review every new file, fixture, commit and release artifact before publication. Dependency lockfiles are included for reproducibility; dependencies are not vendored.

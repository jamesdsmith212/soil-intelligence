# Contributing

Use fictional fields and fixtures in all issues, screenshots, tests and pull requests. Never submit real soil reports, field coordinates, operational data, supplier quotes, plan exports or credentials.

```sh
npm ci
npm run db:migrate
npm run typecheck
npm test
```

Keep changes scoped, describe assumptions, and add tests for changed domain behaviour. Agricultural targets and crop-response changes need references, units, regional applicability and an explicit uncertainty discussion.

Run `npm run privacy:check` before committing. Do not add private data paths to its exclusions or weaken the synthetic-only demo guard. Build products and local databases must remain ignored.

# Security

Do not post credentials, field data or sensitive reproduction files in public issues. Report security problems through the repository maintainer's private reporting channel where available; otherwise request a private contact without publishing exploit details or private data.

The demo is deliberately anonymous and uses only synthetic data. It is not a template for anonymously exposing real farm records. Disable demo mode, configure a unique secret and review access controls before using a private dataset.

The shared-passphrase mechanism is basic access gating, not user-specific permissions, audit logging or a full identity system. Publicly deploying multi-user applications requires an additional security review. This project makes no claim of production hardening or regulatory certification.

## Dependency check — 12 October 2026

The release was checked with `npm audit --omit=dev`: no reported runtime-dependency vulnerabilities. The [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched upstream release as of this date. This project applies a verified local depth-limit patch to `braces@3.0.3` in both development-tool dependency chains. It does not change the dependency's version or suppress audit results. The full npm audit therefore still reports eight high-severity package entries for that upstream version and its dependency chains, despite the local protection. These are not eight independent defects.

### Local depth-limit fix

`scripts/patch-braces.mjs` runs after npm installation and before the documented dev, build, start and lint commands. It checks the dependency version and SHA-256 source hashes before applying small edits, handles nested installed copies, and refuses unrecognised source. Repeated runs verify the already-patched bytes. A dependency update must be reviewed rather than silently skipping the patch.

The parser rejects brace/parenthesis nesting beyond 100 levels, respecting escaped, quoted and character-class literals. The compile, expand and stringify walkers also bound traversal depth for direct AST inputs. Regression tests demonstrate that excessive nesting is rejected with a controlled error before stack exhaustion and that normal patterns, ranges and micromatch consumers still work. This addresses the reported recursion defect, not every possible expensive regular expression or expansion.

Run `npm run security:check` to verify the installed patch and its regression tests. Do not bypass lifecycle checks by invoking the underlying tools directly. Keep development servers bound to localhost and do not accept arbitrary user-supplied glob expressions. Remove this local patch only after reviewing an upstream fix and rerunning the tests. Do not treat npm audit or these tests as proof that the application is secure.

The fork updates the framework, React and Cloudflare tooling and pins compatible transitive fixes for `fflate` and the older esbuild loader. It does not silently downgrade tooling using `npm audit fix --force`.

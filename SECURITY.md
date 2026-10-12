# Security

Do not post credentials, field data or sensitive reproduction files in public issues. Report security problems through the repository maintainer's private reporting channel where available; otherwise request a private contact without publishing exploit details or private data.

The demo is deliberately anonymous and uses only synthetic data. It is not a template for anonymously exposing real farm records. Disable demo mode, configure a unique secret and review access controls before using a private dataset.

The shared-passphrase mechanism is basic access gating, not user-specific permissions, audit logging or a full identity system. Publicly deploying multi-user applications requires an additional security review. This project makes no claim of production hardening or regulatory certification.

## Dependency check — 12 October 2026

The release was checked with `npm audit --omit=dev`: no reported runtime-dependency vulnerabilities. The full audit still reports eight high-severity package entries arising from the unpatched [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and its development-tool dependency chains. These are not eight independent defects. Keep development servers bound to localhost, avoid untrusted glob patterns, and recheck the advisory before deploying. Do not treat a clean runtime audit as proof that the application is secure.

The fork updates the framework, React and Cloudflare tooling and pins compatible transitive fixes for `fflate` and the older esbuild loader. It does not silently downgrade tooling using `npm audit fix --force`.

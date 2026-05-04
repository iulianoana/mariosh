# Mariosh — Decisions Log

This file tracks design and engineering decisions made during the build.

## Phase 1 — Scaffold

- ESM-only, no CommonJS interop layer
- Module resolution: "Bundler" (matches tsx + chalk v5 ESM)
- React 18 (Ink 5 requires it)
- Path resolution for assets uses `import.meta.url` + node:url to stay ESM-safe
- No bundler — `tsc` directly to `dist/`

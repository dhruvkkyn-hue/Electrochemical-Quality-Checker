# Electrochemical Quality Checker

An interactive proof-of-concept dashboard for generating synthetic DPV signals, extracting features, and classifying signal quality.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/electrochemical-quality-checker/src/App.tsx` — signal generation, feature extraction, classifier scoring, and dashboard UI
- `artifacts/electrochemical-quality-checker/src/index.css` — instrument-console theme and responsive layout

## Architecture decisions

- Synthetic measurements run locally in the browser so the raw signal and derived features remain inspectable without external services.
- DPV traces use 101 points across 0.00–0.80 V, with seeded noise so repeated runs are varied but reproducible.
- The classifier is represented as transparent feature-based scoring for this proof of concept rather than a hidden model dependency.

## Product

Users can choose Good, Medium, or Bad sample conditions, tune noise variance, run a measurement, inspect an interactive DPV curve, review class probabilities, and audit extracted features including trapezoidal AUC.

## User preferences

None recorded.

## Gotchas

The dashboard is intentionally synthetic and should not be presented as a laboratory validation tool.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

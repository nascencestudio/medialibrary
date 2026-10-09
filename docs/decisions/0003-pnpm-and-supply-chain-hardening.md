# 0003. pnpm with strict supply-chain policies

- Status: Accepted
- Date: 2026-10-02

## Context

The user requires the most secure tooling available. npm-ecosystem supply-chain
attacks (hijacked maintainer accounts, malicious install scripts, typosquats)
are the most realistic threat to a project like this.

## Decision

Use **pnpm 12** exclusively and configure in `pnpm-workspace.yaml`:

- `minimumReleaseAge: 4320` (3 days). Most malicious releases are found and
  unpublished within hours.
- `trustPolicy: no-downgrade` with `trustPolicyIgnoreAfter: 259200` (180 days).
  Flag versions whose provenance is weaker than their predecessors', which is a
  takeover signal. The 180-day window avoids false positives on old,
  long-trusted manual publishes.
- `blockExoticSubdeps: true`: transitive dependencies only from the registry.
- `strictDepBuilds: true` with an explicit `allowBuilds` map: install scripts
  run only for packages we've approved.
- `saveExact`, `engineStrict`, `verifyDepsBeforeRun: error`.

Every exception carries an inline comment with the reason and an exit condition.

## Exceptions recorded so far

| Exception | Reason | Remove when |
| --- | --- | --- |
| `allowBuilds: esbuild, sharp` | Need their platform binaries | Never (core tooling) |
| `allowBuilds: @parcel/watcher=false, msgpackr-extract=false` | Optional native accelerators; prebuilt or JS fallback exists | n/a (denied) |
| ~~`allowBuilds: canvas=false`~~ | node-canvas via `@studiocms/wysiwyg` → fabric@4 | **Removed 2026-10-05** with the WYSIWYG plugin |
| ~~`patchedDependencies: @studiocms/html@0.4.2`~~ | Restored editor → form sync lost in 0.4.0 (known issue #20) | **Removed 2026-10-06** with the HTML plugin |
| ~~`overrides: why-is-node-running: 3.2.1`~~ | 3.2.2 lacks provenance; Vitest 5.0.3 pins 3.2.1 upstream | **Removed 2026-10-04** (upgraded to Vitest 5.0.3) |
| `trustPolicyIgnoreAfter: 180 days` | e.g. `undici-types@6.21.0` (Nov 2024, published by matteo.collina without provenance) | Revisit yearly |
| ~~`peerDependencyRules: studiocms>@libsql/client: 0.17`~~ | Inconsistent peers inside studiocms 0.6.0 | **Removed 2026-10-04** (upgraded to studiocms 0.6.1) |
| `auditConfig.ignoreGhsas`: GHSA-ch52-4w7c-c8xp, GHSA-vfj7-8cjw-p6xm | No patched versions; not exploitable here (see known issues) | Patched versions released; re-check 2026-11-01 |

## Alternatives considered

- **npm** with `--ignore-scripts`: weaker isolation (flat `node_modules`, phantom
  dependencies) and no release-age or trust policies.
- **Yarn Berry (PnP)**: strong isolation, but more friction with Astro/Vite
  tooling, and no comparable trust policy.
- **Bun**: fast, but younger, with less mature supply-chain controls.

## Consequences

- Fresh releases (including security patches) arrive 3 days late. For an urgent
  patch, add a temporary `minimumReleaseAgeExclude` entry with a devlog note.
- Installs occasionally fail on trust or peer issues. Each one is investigated
  and documented, never blanket-disabled.

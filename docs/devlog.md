# Devlog

Newest first. What changed, what was learned, what's next.

---

## 2026-10-09: Releases are staged

- 0.1.0 published (first release with a bootstrap token). Trusted publisher added with allowed
  actions **stage only**; a direct `pnpm publish` through it fails with 403 "OIDC permission
  denied for this action".
- `release.yml` now runs `pnpm stage publish --provenance` (no token): a release only goes live
  after a maintainer approves it with 2FA, so a compromised workflow can't ship a version.
- 0.1.1 (no code changes) validates the trusted publisher.

## 2026-10-08: Session 1: Own repository

**Request:** the user created separate GitHub repositories (`nascencestudio/tapestry`,
`nascencestudio/medialibrary`) and chose to move the media library out of Tapestry's
monorepo (npm provenance requires publishing each package from its own repository).

### Done
- Copied `packages/medialibrary` (source, tests, fixtures, scripts, README, LICENSE) with its
  design records (`docs/decisions/` 0003, 0016, 0018, 0019, from Tapestry).
- Standalone setup: `package.json` (repository/homepage/bugs, `packageManager`, lint scripts,
  `prepack` build), `pnpm-workspace.yaml` with Tapestry's supply-chain rules (release age,
  trust policy, exotic subdeps, build allowlist, the `source-map-js` override, one reviewed
  advisory), Biome, `.nvmrc`, `.gitignore`.
- GitHub: CI (lint, audit, types, unit tests, build, package contents), release workflow
  (provenance, trusted publishing; `NPM_TOKEN` fallback), Dependabot.

### Verified
- Install, build, 174 unit tests, typecheck, lint and audit pass standalone.

### Next
- Push, configure npm trusted publishing, release 0.1.0. Tapestry's repo then installs it from npm.

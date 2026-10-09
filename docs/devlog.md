# Devlog

Newest first. What changed, what was learned, what's next.

---

## 2026-10-09: Folders (0.2.0)

**Request:** folders for sorting media (Drupal's Media Library has none), kept in sync with the
file system. The user chose "mirror disk, stable URLs" after the trade-offs (URLs, public folder
names, user-typed paths, atomicity, one-way sync). [ADR 0100](decisions/0100-folders.md).

### Done
- `folders.ts` (pure): names, directory names (safe slugs), tree rules (depth 8, 1000 folders,
  no cycles). `disk.ts`: the layout and `syncFiles` (find files by unique name, move into place,
  remove stray empty directories). `keys.ts`: keys are plain file names; `YYYY/MM/` keys accepted.
- Runtime: `NascenceMediaFolders` table + `folderId` column; folders-store (create, rename, move,
  delete-if-empty, move items) with an in-process lock; `sync.ts` (startup, after failures, on a
  miss at most once a minute); `/files/<file name>` resolved through the database; API
  `/folders`, `/folders/:id`, `/move`, `folder=` on the item list and uploads.
- UI: folder list (drop target), folder bar (breadcrumb, new/rename/move/delete), Folder field,
  multiple selection, uploads into the current folder; the picker browses folders.
- Source maps embed their sources (`inlineSources`): the package doesn't ship `src/`, and Vite
  warned about every module in dev.
- 0.2.0. Tests: 237 unit (folder names incl. `..`, `.tmp`, reserved and bidi characters; disk
  layer on a temp dir incl. interrupted moves); Tapestry playground: new `media-folders` e2e suite
  (10 steps, checks the disk and URLs), a11y state with a folder selected; all 24 suites pass.
- Migration checked on real dev data: 6 files moved out of `2026/10`, keys rewritten, old URLs serve.

### Learned
- A dragged thumbnail `<img>` carries the image as a file: the upload drop zone uploaded copies.
- The playground's e2e harness used a fixed Chrome debugging port, so every run since 2026-10-07
  silently reused one leftover browser and its cached scripts (stale code looked like a bug). It
  now uses a port Chrome picks itself (the playground's devlog has details).

- Picker (user feedback): folder counts cover only what the field accepts (`GET /folders?kind=`),
  entries with nothing usable (counting subfolders) are greyed out but still clickable (to upload
  into), and a note says what the field takes ("Only images can be used here."). The Media page
  keeps counting everything. Covered in the playground's media-tapestry suite.

- Deleting a folder (user feedback): deletes everything in it like a file manager, after typing the
  folder's name (case-insensitive) in a dialog with Cancel / Delete (disabled until it matches); the
  server requires the same name. The dialog lists what's inside and the pages using any of it.
- Usage badges (user idea): each card shows how many pages use the item (stacked-pages icon and count,
  top-right corner); clicking lists the pages with links to their editors. Counts come from one query
  per page of items (`usageByItem`). Covered in the playground's media-tapestry, media-folders and
  a11y suites (dialog audited in both themes).

- Folder actions moved into a ⋮ menu per folder (user feedback): New subfolder and Rename edit in
  place in the list, Move and Delete open dialogs; "+ New folder" at the bottom under a separator;
  the bar above the grid is only the breadcrumb. The menu is `position: fixed` so the scrolling list
  doesn't clip it.
- Fixed: the usage badge's wrapper reused the class `ml-usage` of the details panel's "Used on"
  section, which then floated over the toolbar. Renamed (`ml-usage-anchor`); the media suite checks
  the section stays in normal layout.

### Next
- Release 0.2.0 (staged; approve on npm), then switch the playground to it.

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

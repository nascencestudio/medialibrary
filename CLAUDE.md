# CLAUDE.md: @nascencestudio/medialibrary

The source of truth for anyone (human or AI) working in this repo. Read it at the start
of every session and keep it current.

## What it is

A media library plugin for **StudioCMS** (Astro): a Media page in the dashboard (upload,
browse, tags, alt text, captions/subtitles, focal points, replace files, usage), safe
uploads (types from file bytes, sanitized SVG, admin-adjustable limits), resized WebP
variants via sharp, privacy-friendly remote video embeds, a picker and a `<Media>`
component. [Tapestry](https://github.com/nascencestudio/tapestry) uses it for `media`
props and images in rich text (it finds this package at runtime; there's no build-time
coupling). Folders (0.2.0, [ADR 0100](docs/decisions/0100-folders.md)) are mirrored on disk. Published as `@nascencestudio/medialibrary` (Nascence Studio, MIT).

History: developed inside Tapestry's monorepo until 2026-10-08, then moved here (the user's
decision, so it's released with provenance from its own repository). Older design records
are in `docs/decisions/` (copied); Tapestry's devlog has the full history.

## Non-negotiable rules

1. **Security first.** pnpm only (never npm/npx/yarn, not even `npm view`; use `pnpm view`).
   Don't weaken `pnpm-workspace.yaml` hardening without a written reason. Pin exact versions.
   New dependencies need a size, provenance and dependency-tree review recorded in an ADR.
   `pnpm audit` must pass. Uploads are untrusted input (detect types from bytes, sanitize SVG).
2. **Light.** The dashboard UI uses Preact (never React or other Meta libraries). Public
   pages get only what `<Media>` renders.
3. **Document everything.** Every session: an entry in `docs/devlog.md`; significant decisions
   as ADRs in `docs/decisions/`; update this file.
4. **Verify, don't assume.** StudioCMS docs lag its code; check `node_modules/studiocms`.
5. **Tests with every change**, adversarial ones for security-relevant code (detection, SVG,
   storage keys, URLs). Browser tests live in Tapestry's repo (its playground installs this
   package from npm): run them before releases that change the UI.

## Layout

```
src/
├── index.ts            ← plugin entry (options, routes, dashboard pages), exports
├── detect.ts, dimensions.ts, svg.ts, remote.ts, settings.ts       ← pure: types from bytes, sizes, SVG sanitizing, YouTube/Vimeo, settings
├── meta.ts, subtitles.ts, stored.ts, keys.ts, responsive.ts       ← pure (ADR 0019); keys = file names (ADR 0100)
├── folders.ts          ← pure: folder names, directory names (slugs), tree rules (ADR 0100)
├── disk.ts             ← storage layout on disk, root passed in (tested on a temp dir): paths, locate, move, syncFiles
├── runtime/            ← db, storage, receive, images (sharp), api/* (incl. folders, move), files, server,
│                         folders-store (folder changes, moving items), sync (disk ↔ database), lock,
│                         Media.astro, LibraryPage.astro, SettingsPage.astro, settings/variants endpoints
└── ui/                 ← Preact: Library, folders (list, bar, select), details (tags/focal/captions), picker; library.css (loaded on demand)
test/                   ← Vitest; fixtures for every format (generated with sharp/ffmpeg)
scripts/copy-assets.mjs ← copies .astro/.css/.d.ts into dist/
```

## Commands

| Command | |
| --- | --- |
| `pnpm install` | Install (supply-chain policies enforced) |
| `pnpm build` | Build to `dist/` |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` | Unit tests / types / Biome |
| `pnpm audit` | Known vulnerabilities |
| Release | Bump `version`, push, publish a GitHub release `v<version>` (`.github/workflows/release.yml`: **stages** it with provenance via trusted publishing), then a maintainer approves it on npmjs.com (2FA). Never publish locally; never enable "allow npm publish" on the trusted publisher. |

## Gotchas

- **Folders (ADR 0100):** the database is the truth; the disk follows (one-way, never import files
  found there). Change order: database first, then disk, inside `withLock`; on any disk failure call
  `syncUnlocked()` (never `syncNow()` while holding the lock: it would wait for itself). Stored keys
  are plain file names; a file's location is derived from the item's folder (`folderDir`), never
  stored. URLs are `/files/<file name>`: never put folder names in URLs.
- `YYYY/MM/<file name>` keys (before 0.2.0) are still valid input everywhere (`isStorageKey`); the
  startup sync migrates them. Don't drop that support while sites may still upgrade from 0.1.x.
- Deleting a folder deletes its contents (subfolders, items, files) only with `confirm` = the folder's
  name; the dialog and the server compare the same way (NFKC, trimmed, case-insensitive). Never add a
  way to delete contents without it.
- Page usage: use `usageByItem(ids)` (one query per 100 items) for lists; `usageOf` per item is for
  single items only.
- In the UI, folder actions resolve to success booleans instead of throwing: a rejection that went
  through a Preact handler chain was reported as uncaught.
- Thumbnails are `draggable={false}`: a dragged `<img>` carries a *file*, and the upload drop zone
  uploaded a copy of the image. Internal drags use `ITEMS_DRAG_TYPE` and the drop zone ignores them.

- Never `import sharp` statically in runtime code: a server build bundles this package and a
  bundled sharp can't find its native binary. `runtime/images.ts` resolves it from the
  package's install location.
- SQLite `LIKE` has no default escape: use `contains()` in `db.ts` (`LIKE ? ESCAPE '!'`).
- Content stores media **ids** (`m_` + 16 base-36), never file URLs. Storage keys may carry a
  suffix (`m_…-<token>.<ext>`): replaced files, variants and captions get new keys (files are
  cached as immutable). JSON columns (`tracks`, `variants`) are re-validated on read.
- Upload limits and the SVG switch are **runtime** settings (`loadMediaSettings()`); options are
  defaults and the ceiling. Behind a proxy, its body limit must be at least `maxUploadSize`.
- StudioCMS `usePluginData()` can't save in 0.6.1; use `SDKCoreJs.dbService.db` (Kysely).
- Never import CSS from browser code (Astro's script-to-page mapping puts it on every page):
  `ui/styles.ts` loads `library.css` on demand.
- StudioCMS's primary color is light purple in its dark theme: text on it uses `--text-inverted`.

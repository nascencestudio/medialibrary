# 0019. Media editing extras: replace file, tags, captions, focal point, resized images

- Status: Accepted
- Date: 2026-10-06

## Context

The media library (ADR 0016) listed follow-ups: replacing a file, folders/tags,
captions/subtitles, focal points, responsive image sizes and S3 storage. The user
asked for all of them except S3 ("no use for it"; maybe later). Constraints: files
are served with `Cache-Control: immutable` for a year; pages store item **ids**,
never URLs; uploads are the riskiest input (security.md); the target server is a
small Hetzner CPX; new dependencies need a size, provenance and tree review.

## Decision

1. **One schema step.** Columns `tags`, `focalX`, `focalY`, `tracks` (JSON) and
   `variants` (JSON) are added to `NascenceMediaItems` on first use (Kysely
   introspection, falling back to "add and ignore already-exists"), like the table
   itself. JSON columns are re-validated on every read (`stored.ts`); storage keys
   must match the key pattern before they become URLs.
2. **Storage keys get an optional suffix** (`YYYY/MM/<id>-<token>.<ext>`). A new
   upload has none; a replacement, a resized copy or a caption file gets a random
   one, so its URL is new and immutable caching stays correct.
3. **Replace file** (`POST /items/:id/file`): the same checks as an upload
   (`receive.ts`, shared), and the new file must be the **same kind** (components
   accept media by kind). The id, alt text, tags, focal point and captions stay; a
   name that is still the old file's name follows the new file. The old file and its
   resized copies are removed after the row is updated.
4. **Tags, not folders.** An item can have several tags (lowercase; letters, digits,
   spaces, `-`, `_`; ≤ 40 characters, ≤ 20 per item), stored as `|a|b|` so one tag
   matches with `LIKE '%|tag|%'`. A tag filter in the toolbar, chips with
   suggestions in the details. Tags cover what folders do (and more: one image can
   be in "homepage" and "team"), without a hierarchy UI.
5. **Captions** (`POST/DELETE /items/:id/tracks`): uploaded videos only. WebVTT, or
   SRT converted to WebVTT. The file is **rebuilt**, not stored as uploaded
   (`subtitles.ts`): valid UTF-8 only, timings normalized, known cue settings only,
   cue text limited to WebVTT's tags (b, i, u, c, v, lang, ruby, rt, timestamps),
   `-->` in text neutralized, STYLE (CSS could load outside URLs), REGION and NOTE
   blocks dropped; at most 2 MB and 20 tracks. Served inline as
   `text/vtt` with `nosniff` and the sandbox CSP. `Media.astro` adds `<track>`s.
6. **Focal point**: `{ x, y }` percent for images; set by clicking the image (arrow
   keys for keyboard users), with wide/square/tall crop previews. `Media.astro`
   applies it as `object-position`; components can use `item.focalPoint`.
7. **Resized copies** (`runtime/images.ts`): WebP copies at `imageWidths`
   (default 480, 960, 1440, 1920; only narrower than the original) for JPEG, PNG,
   WebP and AVIF, made right after upload/replace; `item.variants` and `item.srcset`;
   `Media.astro` emits `srcset` + `sizes`. **SVG is never decoded** (librsvg could
   follow references) and **GIF is skipped** (animation). The decoder runs with
   `limitInputPixels: 100 MP` (decompression bombs), `failOn: 'error'`, one image at
   a time, no cache; EXIF orientation is applied and metadata (GPS…) isn't copied.
   Failures leave the item without copies. An admin button (settings page) makes
   copies for older images, ~20 s per request.
8. **sharp is loaded at runtime from the media library's install location**
   (`createRequire` from `@nascencestudio/medialibrary/package.json`), never
   imported statically: Astro bundles workspace packages into the server build, and
   a bundled sharp can't find its native binary (known issue #30). If it can't load,
   uploads continue without copies.
9. **`LIKE` escaping fixed.** SQLite has no default `LIKE` escape, so the earlier
   backslash escaping made searches containing `_` or `%` match wrongly. Searches,
   tag filters and the usage check now use `… LIKE ? ESCAPE '!'` through Kysely's
   `sql` helper.

## Dependencies

| Package | Version | Why | Size | Provenance | Tree |
| --- | --- | --- | --- | --- | --- |
| `sharp` | 0.35.5 (2026-09-27) | Resizing (libvips) | 0.96 MB JS + one platform binary (`@img/sharp-<os>-<arch>` ~0.3–0.4 MB, `@img/sharp-libvips-<os>-<arch>` ~18 MB) | ✓ (all `@img/*` too) | `semver`, `detect-libc`, `@img/colour` (all with provenance); **no install scripts** (prebuilt binaries as optional dependencies) |
| `kysely` | 0.29.6 (2026-09-16) | `sql` helper for `ESCAPE` | 1.7 MB | ✓ | none; the version StudioCMS already installs, so no new code |

Licenses: sharp Apache-2.0; the bundled libvips binary is LGPL-3.0-or-later
(dynamically loaded, unmodified, which the LGPL allows); kysely MIT.

## Alternatives considered

- **Replace in place under the same URL.** Breaks immutable caching (visitors keep
  the old file for a year) or forces short cache times for every file.
- **Folders.** A hierarchy needs moving, nesting and a tree UI; tags are simpler and
  more flexible for a single site's library.
- **Storing caption files as uploaded.** Simpler, but keeps STYLE blocks with outside
  URLs and whatever else a file contains; rebuilding is small and testable.
- **A WebAssembly or pure-JS image library** instead of sharp: much slower and
  heavier on memory for the same work; sharp is the de facto standard, with
  provenance and no install scripts.
- **Making AVIF copies.** Smaller files, but encoding is several times slower on a
  small CPU; WebP is supported everywhere that matters. Revisit later.
- **Generating sizes on demand** (an image endpoint with `?w=`): an open resizing
  endpoint is a denial-of-service target and needs a cache; fixed sizes made once are
  simpler and safer.

## Consequences

- Uploads of large photos take longer (resizing runs in the request; ~1 s for a
  10 MB JPEG on a small server). Fine for an editor; revisit with a queue if needed.
- About 20 MB more in the Docker image (one platform's libvips).
- CI checks that sharp's binary resolves inside the production image (ADR 0020).
- Unit tests: meta, subtitles (adversarial cue text and blocks), stored JSON, keys,
  responsive widths; e2e suite `media-extras` (7 steps).

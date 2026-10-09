# 0018. Admins set media upload limits and the SVG switch from the dashboard

- Status: Accepted
- Date: 2026-10-06

## Context

The media library's size limits per kind and its SVG support (ADR 0016) were set
only in code (`mediaLibrary({ limits })`). The user asked for a settings page
like Tapestry's (Plugins → Tapestry, ADR 0014) where admins can change the
limits and turn SVG uploads on or off.

Constraints carried over from ADR 0014: StudioCMS's generated `settingsPage`
form can't show saved values, `usePluginData()` can't save (known issue #25),
the Plugins link has no slash (#27), and plugin dashboard pages make
`[dashboard]` routes lose to StudioCMS's catch-all (#28).

## Decision

1. **Developers set defaults and a ceiling; admins choose within it.** The
   plugin options `limits` and `allowSvg` (new, default `true`) are the defaults.
   The new `maxUploadSize` option (default 1 GB, `MEDIA_MAX_UPLOAD_MB`
   overrides it at runtime) is the highest limit anyone can set. A setting is
   only as trusted as an admin account, so a typo or a compromised admin can't
   allow multi-gigabyte uploads that fill the disk. Limits are also at least 1 MB.
2. **Page "Plugins → Media Library → Uploads"** (`SettingsPage.astro`), injected
   the same way as Tapestry's: an empty `settingsPage` with a 405 `onSave` stub
   gets the plugin listed; the page answers at `/dashboard/plugins@…` and
   `/dashboard/plugins/@…` (literal and `[dashboard]` routes), uses StudioCMS's
   `DashboardLayout` with an inner sidebar, and is admins only. A plain HTML form
   (works without JavaScript): four number inputs in whole MB, one checkbox.
3. **Strict form handling.** `POST /_media/settings`: same-origin `Origin`
   check, admin or owner session (fail closed), 8 KB body limit, redirect only to
   a same-origin path. Each limit must be a whole number of MB from 1 to the
   ceiling. Anything else saves **nothing** and returns `?error=<kinds>`, so a
   mistake is shown, not silently changed into a different number.
4. **Storage:** row `@nascencestudio/medialibrary-settings` in
   `StudioCMSPluginData` (`{ version: 1, limits, allowSvg }`, bytes), written
   directly through the SDK's database client like ADR 0014. Reading cleans
   the data again (each limit clamped to [1 MB, ceiling], bad values fall back to
   the default), so a ceiling lowered later also lowers saved limits.
5. **Enforced on the server, mirrored in the UI.** Each upload reads the
   settings fresh (one indexed lookup; no cache to go stale across processes).
   `detectType(…, { allowSvg })` refuses `.svg` with "SVG uploads are turned off."
   The library fetches `GET /_media/api/settings` (editors) to drop `.svg` from
   the file dialog and check sizes before uploading. That is only a convenience;
   the server is the check.
6. **Existing files stay.** Turning SVG off or lowering a limit only affects new
   uploads. Stored SVGs were sanitized on upload and are served with the sandbox
   CSP, so they stay usable.
7. **Reverse proxy follows the ceiling.** Caddy's `request_body max_size` reads
   `MEDIA_MAX_UPLOAD_MB` (default 1024 MiB), so the Docker stack has one knob.

## Alternatives considered

- **Let admins set any limit.** Simpler, but the disk on a small CPX server is
  the scarcest resource, and the limit also bounds how long an upload can occupy
  the server. A developer-set ceiling costs nothing for normal use.
- **Admins can only lower the developer limits** (like toolbars in ADR 0014).
  Doesn't meet the request: the user wants to raise them too (for example, longer
  videos).
- **Clamp invalid input instead of refusing it.** Typing 5000 and getting 1024
  saved without notice is surprising; refusing with a message is clearer.
- **Cache settings in memory.** Saves one tiny query per upload but goes stale
  with several server processes. Not worth it.

## Consequences

- One more admin page; the Plugins section now lists Media Library and Tapestry
  (the Tapestry settings e2e no longer assumes it's the only plugin).
- The Caddyfile depends on an env var with a default; `.env.production.example`
  documents it.
- e2e suite `media-settings` (7 steps); unit tests for parsing, the form, the
  env override and `detectType` with SVG off.

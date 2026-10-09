# 0016. A media library plugin (@nascencestudio/medialibrary)

- Status: Accepted
- Date: 2026-10-06

## Context

The user wanted Drupal's Media Library: upload images, video, audio and
documents (and remote videos) once, reuse them in components (e.g. a
background image) and in rich text, and manage them in one place. StudioCMS
0.6.1 has a pluggable storage layer and a raw file browser, but no media items
(no alt text, types, usage), no picker for fields, and only one storage plugin
(S3). Requirements from the user: a separate plugin; AVIF; SVG with
sanitizing; 10 MB images, 200 MB video; remote videos; hosting on a Hetzner
Cloud server with Docker.

## Decision

1. **A separate StudioCMS plugin**, `@nascencestudio/medialibrary`, in this repo.
   Tapestry integrates with it when it's installed (virtual modules generated at
   build time; Tapestry works without it).
2. **Media items in the database** (`NascenceMediaItems`, created on first use with
   Kysely's schema builder): id, kind (image, video, audio, document, remoteVideo),
   name, alt text, MIME type, size, dimensions, storage key or provider + video id,
   thumbnail, timestamps, uploader. **Content stores the id**, never a URL, so alt
   text or file changes apply everywhere and deletions can warn ("used on N pages").
3. **Local-disk storage** (`MEDIA_DIR` or `storageDir`, a Docker volume in
   production). Files are streamed to a temporary file (never buffered whole), then
   checked and moved to `YYYY/MM/<id>.<ext>`. StudioCMS's storage-manager API was
   not used for now: its only driver is S3, its interface is large and still
   changing, and a single server with a volume is the target. An S3 adapter can be
   added behind the same storage functions later.
4. **Uploads are checked by content**: the file's signature must match an allowlisted
   format and agree with the extension (JPEG, PNG, GIF, WebP, **AVIF**, SVG; MP4,
   WebM; MP3, M4A, Ogg, WAV, FLAC; PDF, Office/OpenDocument, TXT, CSV). Per-kind
   limits: image 10 MB, video 200 MB, audio 100 MB, document 25 MB (configurable).
   Image dimensions are read from headers (no image decoding, no native dependency).
5. **SVG is sanitized by rebuilding it from an allowlist** (elements, attributes,
   internal references only, CSS without external references; scripts, handlers,
   foreignObject, animations, links, images and DOCTYPEs removed), parsed with
   `ultrahtml`. Files are also served with a sandboxing CSP (defense in depth).
6. **Remote videos** (YouTube, Vimeo): the pasted URL is parsed into a provider and
   a validated id; watch, embed (youtube-nocookie.com, Vimeo with do-not-track),
   oEmbed and thumbnail URLs are built from that id only. Title and thumbnail come
   from oEmbed (5 s timeout, no redirects, thumbnails only from the providers' image hosts).
7. **API** (`/_media/api/*`, editors only, same-origin for changes) and **public file
   serving** (`/files/YYYY/MM/<id>.<ext>`, exact key pattern only, `nosniff`,
   sandbox CSP, immutable caching, byte ranges for video, Office/text files download).
8. **UI**: a "Media" page in the dashboard's main sidebar group (editors and up),
   and the same library as a **picker dialog** (`@nascencestudio/medialibrary/picker`)
   that other plugins open. Grid with type filters and search, uploads by button or
   drag and drop with progress, remote video by link, details with name, alt text,
   usage and delete (with a warning when used).
9. **Tapestry integration**: a `media` prop type (`accept` kinds; components receive
   the item or null) and a `media` rich text toolbar entry that inserts a media block,
   rendered by the library's `Media.astro` (image, video/audio player, privacy-friendly
   embed, or document link).

## Alternatives considered

- **StudioCMS's storage manager + file browser**: no media metadata, no picker, S3 only.
- **Build it into Tapestry**: the library is useful on any StudioCMS site; separate
  security review and updates are simpler.
- **Store HTML/URLs in content**: breaks when files move or alt text changes, and
  usage can't be tracked reliably.
- **DOMPurify for SVG**: needs a DOM on the server (jsdom, large). The allowlist
  rebuild is small, tested against known attacks, and backed by the serving CSP.
- **sharp for dimensions**: a native dependency for something a header read does.

## Consequences

- One server (SQLite file and media on one volume); horizontal scaling would need
  shared storage (S3 adapter) and a networked database (libSQL/Turso).
- Not yet: responsive image sizes, focal points, captions/subtitle tracks for video,
  folders/tags, replacing a file in place, S3 storage.
- e2e: "Media" (8 steps) and "Media + Tapestry" (8 steps) suites; 90 unit tests
  including real sample files for every format and hostile SVGs.

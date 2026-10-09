# @nascencestudio/medialibrary

**A media library for [StudioCMS](https://studiocms.dev):** upload, browse and
reuse images, video, audio, documents and remote videos (YouTube, Vimeo).

- A **Media** page in the dashboard: upload (drag and drop), search, filter by kind
  and tag, alt text, captions and subtitles, focal points, replace files, see where
  each item is used
- **Folders**, mirrored on disk: the storage directory has the same folders as the library,
  while file URLs never change when you move or rename things
- Safe uploads: file types are detected from the bytes, SVGs are sanitized, size
  limits per kind (adjustable by admins)
- Resized WebP copies of images for responsive `srcset`s (with [sharp](https://sharp.pixelplumbing.com))
- Privacy-friendly embeds for remote videos
- A picker and a `<Media>` component, used by [`@nascencestudio/tapestry`](https://github.com/nascencestudio/tapestry)
  for `media` props and images in rich text

## Requirements

- Node ≥ 22.12, Astro 7, StudioCMS 0.6, an on-demand (SSR) Astro adapter
- A writable directory for the files (default `./data/media`, or `MEDIA_DIR`)

## Install

```sh
pnpm add @nascencestudio/medialibrary
```

```js
// studiocms.config.mjs
import mediaLibrary from '@nascencestudio/medialibrary';
import { defineStudioCMSConfig } from 'studiocms/config';

export default defineStudioCMSConfig({
  plugins: [mediaLibrary({ storageDir: './data/media' })],
});
```

Tapestry finds the media library on its own when both are installed.

## Options

| Option | Default | |
| --- | --- | --- |
| `storageDir` | `./data/media` | Where files are stored (`MEDIA_DIR` overrides it) |
| `publicPath` | `/files` | URL prefix files are served from |
| `limits` | image 10 MB, video 200 MB, audio 100 MB, document 25 MB | Per-kind upload limits (admins can change them) |
| `allowSvg` | `true` | Whether sanitized SVG uploads are allowed (admins can change it) |
| `maxUploadSize` | 1 GB | The highest limit admins can set (`MEDIA_MAX_UPLOAD_MB` overrides it) |
| `imageWidths` | `[480, 960, 1440, 1920]` | Widths of the resized copies; `[]` turns resizing off |

## Folders

Create, rename, move and delete folders on the Media page; move items with the details
panel, by dragging cards onto a folder, or several at once (Ctrl/⌘/Shift-click). Uploads go
into the folder you're viewing.

The storage directory mirrors the folders: a file in "Photos / Team" lives at
`<storageDir>/photos/team/m_….jpg`. Directory names are derived from the folder names
(lowercase letters, digits and hyphens). The library keeps the disk in step: it never
reads files you add to the directory yourself, so add media through the library, which
checks every upload.

A file's URL is `/files/<file name>`, with no folder in it, so moving an item or renaming a
folder never breaks a link and folder names stay private. Media stored before 0.2.0
(`<storageDir>/YYYY/MM/…`) moves into the top level on the first start; its old URLs keep
working. Details: [ADR 0100](docs/decisions/0100-folders.md).

Run one server process per storage directory (moves are coordinated in-process).

## Showing media

```astro
---
import Media from '@nascencestudio/medialibrary/Media.astro';
---
<Media id="m_…" />
```

More: [the design decisions](docs/decisions/0016-media-library.md) ([folders](docs/decisions/0100-folders.md))
and the [deployment guide](https://github.com/nascencestudio/tapestry/blob/main/docs/guides/deployment.md) (file storage, upload limits behind a proxy).

## License

MIT © Nascence Studio

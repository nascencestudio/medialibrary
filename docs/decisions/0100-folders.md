# 0100. Folders, mirrored on disk, with permanent file URLs

- Status: Accepted (the user asked for folders that match the file system, and chose
  "Mirror disk, stable URLs", 2026-10-09)
- Date: 2026-10-09
- Supersedes in part: 0016 (storage layout `YYYY/MM/<id>.<ext>` and the `/files/YYYY/MM/…` URLs),
  0019 (key format)

## Context

Editors want to sort media into folders (Drupal's Media Library has none). The user also wants
the folders to exist on disk: the storage directory should look like the library.

Until now a file's storage key was its path and its URL (`2026/10/m_….jpg`,
`/files/2026/10/m_….jpg`). Mirroring folders with that coupling would make every move or
rename change public URLs (breaking direct links, and cached pages for up to 5 minutes), put
folder names into public URLs (they're often internal), and need folder paths in the
`storageKey` column (`varchar(128)`, enforced by Postgres and MySQL).

## Decision

1. **The file name is the identity.** A stored file is named `m_<id>[-<suffix>].<ext>` (unique:
   it starts with the item's id). The database stores only that name; its URL is
   `/files/<file name>`, whatever folder it's in. Content keeps storing media ids.
2. **Folders** (`NascenceMediaFolders`: id `f_<16>`, parent, display name, directory name) nest up
   to 8 levels, at most 1000 per library. Display names are cleaned (no control or bidi
   characters, 64 characters) and unique among siblings regardless of case. The **directory
   name** is derived from the display name: NFKD without accents, lowercase `[a-z0-9-]`, at most
   40 characters, `folder` when nothing is left, Windows-reserved names suffixed, made unique
   among siblings (`-2`, `-3`). So a user-typed name can never be `..`, hidden (`.tmp` is ours),
   reserved, or collide by case (one directory on macOS, two on Linux).
3. **The disk mirrors the database, one way.** A file lives at
   `<storage dir>/<directory names…>/<file name>`; every folder has its directory, empty ones
   too. The library writes to disk and never imports what it finds there: files dropped in over
   SFTP would skip the upload checks (type from bytes, SVG sanitizing, limits).
4. **Database first, disk second, sync repairs.** Every change (create, rename, move, delete a
   folder; move items) updates the database, then the disk (one directory rename for a folder;
   one rename per file for items), all through one in-process lock. If the disk step fails or
   is interrupted, `syncFiles` (disk.ts) makes the disk match: it finds each file where it
   belongs, else where a pre-folders key put it, else anywhere under the root by its unique
   name, and moves it; then removes empty directories that aren't folders. It runs at startup
   (background), after a failed directory rename, and when a requested file isn't where it
   belongs (at most once a minute, so requests can't make the server rescan the disk).
5. **Migration:** existing `YYYY/MM/<file name>` keys stay valid. The startup sync moves those
   files into their folder (the top level) and rewrites the keys to file names. Old URLs keep
   working: the file route looks files up by name, ignoring a `YYYY/MM/` prefix.
6. **Serving:** `/files/<file name>` looks up the item by the id in the name and serves the file
   only if the name is one of that item's stored files; no request path is ever used to build a
   disk path. Same headers as before (nosniff, sandbox CSP, immutable caching: the content at a
   URL never changes).
7. **Deleting** a folder deletes everything in it, like a file manager: its subfolders, their items
   and the items' files (the user's choice, replacing "empty folders only"). A confirmation dialog
   lists what's inside and the pages that use any of it (they'd show gaps), and Delete stays
   disabled until the folder's name is typed (case-insensitive). The server checks the same name
   (`confirm`), so only a deliberate request deletes contents. Directories are removed only once
   empty (anything someone else put there stays).
8. **Usage is visible:** each card carries a badge with the number of pages using the item, which
   opens the list of those pages (linked to their editors). One query per listed page of items
   (`usageByItem`), not one per item.
9. **UI:** a folder list (All media, Not in a folder, the tree; drop target for dragged items).
   Each folder has a ⋮ menu (New subfolder, Rename, Move…, Delete folder…; keyboard: arrows,
   Escape); renaming and new subfolders happen in place in the list, moving and deleting in
   dialogs; "+ New folder" is at the bottom of the list. A breadcrumb sits above the grid. Uploads
   and remote videos go into the folder being viewed; the details panel has a Folder field;
   Ctrl/⌘/Shift-click selects several items to move. The picker can browse folders.

## Alternatives considered

- **Disk path = URL** (folder names in URLs): moves and renames break direct links; folder names
  become public. Offered to the user, not chosen.
- **Folders only in the database:** simplest, but the disk wouldn't match. Offered, not chosen.
- **Two-way sync** (import files found on disk): bypasses every upload check; a separate import
  action that runs the same checks would be the safe form, if ever wanted.
- **Storing full paths in `storageKey`:** column length limits, and every rename rewrites every
  key below it; deriving the location from the folder tree avoids both.

## Consequences

- Moving and renaming are cheap for the database (one row) and need no URL changes; pages need
  no re-render.
- One server process per storage directory: the lock is in-process. Two processes sharing one
  directory and one database could race on moves (the sync repairs files, not concurrent intent).
- Serving a file costs a database lookup by primary key (files are cached as immutable, so
  browsers and CDNs rarely ask twice).
- The storage directory's `YYYY/MM` directories disappear after the first start with 0.2.0.

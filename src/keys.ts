/**
 * Stored file names and keys. A stored file is named `<media id>[-<suffix>].<ext>`:
 * the main file of a new upload has no suffix; a replacement file, a resized image
 * or a caption file gets a random suffix, so its URL is new (files are cached as
 * immutable). The file name is the file's identity and its public URL
 * (`/files/<file name>`); where it lives on disk follows the item's folder
 * (folders.ts, ADR 0100), so moving an item never changes a URL.
 *
 * Keys stored before folders existed carry the upload month: `YYYY/MM/<file name>`.
 * They are still accepted (and their old URLs still served); the library moves those
 * files into place and stores plain file names (runtime/sync.ts).
 *
 * Nothing outside these patterns is ever read, written or served. Pure functions only.
 */

const NAME = 'm_[a-z0-9]{16}(?:-[a-z0-9]{1,24})?\\.[a-z0-9]{2,5}';

/** A stored file name (also the last segment of every key). */
export const FILE_NAME = new RegExp(`^${NAME}$`);

/** A stored key: a file name, or a file name under its upload month (keys from before folders). */
export const STORAGE_KEY = new RegExp(`^(?:\\d{4}/\\d{2}/)?${NAME}$`);

export const isStorageKey = (value: unknown): value is string => typeof value === 'string' && STORAGE_KEY.test(value);

export const isFileName = (value: unknown): value is string => typeof value === 'string' && FILE_NAME.test(value);

/** Whether a key still carries its upload month (stored before folders). */
export const isLegacyKey = (key: string) => isStorageKey(key) && key.includes('/');

/** The file name of a key (its last segment). */
export const fileNameOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);

/** The media id a file name belongs to (`m_` + 16 characters). */
export const mediaIdOf = (fileName: string) => fileName.slice(0, 18);

/** A random lowercase base-36 token (for key suffixes). */
export function keyToken(length = 8): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** The file name of a new stored file. */
export function storageKeyFor(id: string, ext: string, suffix = ''): string {
	return `${id}${suffix ? `-${suffix}` : ''}.${ext}`;
}

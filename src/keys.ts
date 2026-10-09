/**
 * Storage keys of stored files: `YYYY/MM/<media id>[-<suffix>].<ext>`. The
 * main file of a new upload has no suffix; a replacement file, a resized image
 * or a caption file gets a random suffix, so its URL is new (files are cached
 * as immutable). Nothing outside this pattern is ever read, written or served.
 * Pure functions only.
 */

export const STORAGE_KEY = /^\d{4}\/\d{2}\/m_[a-z0-9]{16}(-[a-z0-9]{1,24})?\.[a-z0-9]{2,5}$/;

export const isStorageKey = (value: unknown): value is string => typeof value === 'string' && STORAGE_KEY.test(value);

/** A random lowercase base-36 token (for key suffixes). */
export function keyToken(length = 8): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export function storageKeyFor(id: string, ext: string, now = new Date(), suffix = ''): string {
	const month = String(now.getUTCMonth() + 1).padStart(2, '0');
	return `${now.getUTCFullYear()}/${month}/${id}${suffix ? `-${suffix}` : ''}.${ext}`;
}

/**
 * Editable metadata besides name and alt text: tags (for finding and grouping
 * items) and the focal point of images (the spot to keep when an image is
 * cropped). Pure functions only. See ADR 0019.
 */

/** At most this many tags per item. */
export const MAX_TAGS = 20;
/** At most this many characters per tag. */
export const MAX_TAG_LENGTH = 40;

/**
 * One tag, normalized: trimmed, inner whitespace collapsed, lowercase. Letters
 * (any script), digits, spaces, `-` and `_` only. Returns '' for anything else,
 * including the `|` used as the storage separator.
 */
export function normalizeTag(input: unknown): string {
	if (typeof input !== 'string') return '';
	const tag = input.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
	if (!tag || tag.length > MAX_TAG_LENGTH) return '';
	return /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(tag) ? tag : '';
}

/** A clean tag list: valid tags only, no duplicates, at most MAX_TAGS, sorted. */
export function normalizeTags(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	const tags = new Set<string>();
	for (const value of input) {
		const tag = normalizeTag(value);
		if (tag) tags.add(tag);
		if (tags.size >= MAX_TAGS) break;
	}
	return [...tags].sort((a, b) => a.localeCompare(b));
}

/** Storage form: `|a|b|` ('' for none), so one tag can be matched with LIKE '%|tag|%'. */
export const encodeTags = (tags: readonly string[]) => (tags.length ? `|${tags.join('|')}|` : '');

export const decodeTags = (stored: unknown): string[] =>
	typeof stored === 'string' ? normalizeTags(stored.split('|')) : [];

/** A focal point in percent of the width and height (0–100, whole numbers). */
export interface FocalPoint {
	x: number;
	y: number;
}

const percent = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;

/** A valid focal point, or null (no focal point: the center is used). */
export function normalizeFocalPoint(input: unknown): FocalPoint | null {
	if (typeof input !== 'object' || input === null) return null;
	const x = percent((input as { x?: unknown }).x);
	const y = percent((input as { y?: unknown }).y);
	return x === null || y === null ? null : { x, y };
}

/** CSS `object-position` / `background-position` for a focal point (center when none). */
export const focalPosition = (point: FocalPoint | null | undefined) => (point ? `${point.x}% ${point.y}%` : '50% 50%');

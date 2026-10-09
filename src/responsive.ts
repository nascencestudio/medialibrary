/**
 * Which resized copies to make of an image (responsive images). Pure
 * functions only; the resizing itself is runtime/images.ts. See ADR 0019.
 */

/** Default widths of resized copies, in pixels. */
export const DEFAULT_IMAGE_WIDTHS: readonly number[] = [480, 960, 1440, 1920];

/** Formats that get resized copies. SVG (vector, and never given to the image decoder) and GIF (animation) don't. */
export const RESIZABLE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** Largest image (in pixels) the resizer will decode: guards against decompression bombs. */
export const MAX_INPUT_PIXELS = 100_000_000;

/** Clean the `imageWidths` option: whole numbers from 64 to 8192, unique, ascending, at most 8. */
export function normalizeWidths(widths: readonly number[] | undefined): number[] {
	const list = widths ?? DEFAULT_IMAGE_WIDTHS;
	const clean = [...new Set(list.filter((w) => Number.isInteger(w) && w >= 64 && w <= 8192))].sort((a, b) => a - b);
	return clean.slice(0, 8);
}

/** The widths to make for an image `original` pixels wide: only narrower ones (at least 10% narrower). */
export function variantWidths(original: number | null, widths: readonly number[]): number[] {
	if (!original || original <= 0) return [];
	return widths.filter((w) => w <= original * 0.9);
}

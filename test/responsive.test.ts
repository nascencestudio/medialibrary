import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_WIDTHS, normalizeWidths, RESIZABLE_MIMES, variantWidths } from '../src/responsive.js';

describe('responsive image widths', () => {
	it('cleans the option', () => {
		expect(normalizeWidths(undefined)).toEqual([...DEFAULT_IMAGE_WIDTHS]);
		expect(normalizeWidths([960, 480, 480, 10, 9000, 1.5, 640])).toEqual([480, 640, 960]);
		expect(normalizeWidths([])).toEqual([]);
		expect(normalizeWidths(Array.from({ length: 20 }, (_, i) => 100 + i * 100))).toHaveLength(8);
	});

	it('only makes copies at least 10% narrower than the original', () => {
		expect(variantWidths(4000, DEFAULT_IMAGE_WIDTHS)).toEqual([480, 960, 1440, 1920]);
		expect(variantWidths(1000, DEFAULT_IMAGE_WIDTHS)).toEqual([480]);
		expect(variantWidths(1100, DEFAULT_IMAGE_WIDTHS)).toEqual([480, 960]);
		expect(variantWidths(500, DEFAULT_IMAGE_WIDTHS)).toEqual([]);
		expect(variantWidths(null, DEFAULT_IMAGE_WIDTHS)).toEqual([]);
	});

	it('never resizes SVG or GIF', () => {
		expect(RESIZABLE_MIMES.has('image/svg+xml')).toBe(false);
		expect(RESIZABLE_MIMES.has('image/gif')).toBe(false);
		expect(RESIZABLE_MIMES.has('image/avif')).toBe(true);
	});
});

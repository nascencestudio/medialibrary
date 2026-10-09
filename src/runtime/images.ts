/**
 * Resized copies of uploaded images (responsive images), made with sharp
 * (libvips) right after an upload or file replacement, and on request for
 * existing images (the settings page). Server only. See ADR 0019.
 *
 * Only JPEG, PNG, WebP and AVIF are decoded (never SVG); the decoder refuses
 * images over MAX_INPUT_PIXELS (decompression bombs) and stops on corrupt
 * data. EXIF orientation is applied and metadata (GPS location, camera…) is
 * not copied. Failures are logged and leave the item without copies: the
 * original is still served.
 *
 * sharp is loaded at runtime from this package's own location, never bundled:
 * Astro bundles workspace packages into the server build, and a bundled sharp
 * can't find its native binary (known issue #30). If sharp can't be loaded,
 * uploads still work, without resized copies.
 */
/// <reference path="../virtual.d.ts" />

import { createRequire } from 'node:module';
import config from 'virtual:medialibrary/config';
import type SharpType from 'sharp';
import { keyToken, storageKeyFor } from '../keys.js';
import { MAX_INPUT_PIXELS, RESIZABLE_MIMES, variantWidths } from '../responsive.js';
import type { StoredVariant } from '../stored.js';
import { getRow, type MediaRow, updateRow, variantsOf } from './db.js';
import { pathFor, removeFiles, writeFileAt } from './storage.js';

let sharpModule: typeof SharpType | null | undefined;

/** sharp, resolved from @nascencestudio/medialibrary's install location; null if unavailable. */
function loadSharp(): typeof SharpType | null {
	if (sharpModule !== undefined) return sharpModule;
	try {
		const fromHere = createRequire(import.meta.url);
		const packageJson = fromHere.resolve('@nascencestudio/medialibrary/package.json');
		sharpModule = createRequire(packageJson)('sharp') as typeof SharpType;
		// A small server: one image at a time, no libvips operation cache.
		sharpModule.concurrency(1);
		sharpModule.cache(false);
	} catch (cause) {
		console.warn('[medialibrary] sharp could not be loaded; images get no resized copies', cause);
		sharpModule = null;
	}
	return sharpModule;
}

const decode = (sharp: typeof SharpType, path: string) =>
	sharp(path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', sequentialRead: true, animated: false });

/** Whether an item should have resized copies (raster image with a known, large enough width). */
export function wantsVariants(row: Pick<MediaRow, 'kind' | 'mime' | 'storageKey'>): boolean {
	return row.kind === 'image' && RESIZABLE_MIMES.has(row.mime) && Boolean(row.storageKey);
}

/**
 * Make the resized copies of an image and store them on the row, replacing
 * any earlier copies. Returns the updated row (unchanged when nothing applies).
 */
export async function addVariants(row: MediaRow): Promise<MediaRow> {
	if (!wantsVariants(row) || !row.storageKey) return row;
	const sharp = loadSharp();
	if (!sharp) return row;
	const made: StoredVariant[] = [];
	try {
		const source = pathFor(row.storageKey);
		const meta = await decode(sharp, source).metadata();
		// Oriented size: a portrait phone photo is stored landscape with an EXIF rotation.
		const width = meta.autoOrient?.width ?? meta.width ?? row.width;
		const height = meta.autoOrient?.height ?? meta.height ?? row.height;
		const now = new Date();
		for (const target of variantWidths(width ?? null, config.imageWidths)) {
			const { data, info } = await decode(sharp, source)
				.autoOrient()
				.resize({ width: target, withoutEnlargement: true })
				.webp({ quality: 80, effort: 4 })
				.toBuffer({ resolveWithObject: true });
			const storageKey = storageKeyFor(row.id, 'webp', now, `${keyToken(6)}w${info.width}`);
			await writeFileAt(storageKey, data);
			made.push({ width: info.width, height: info.height, mime: 'image/webp', storageKey });
		}
		const old = variantsOf(row).map((v) => v.storageKey);
		const updated = await updateRow(row.id, {
			variants: JSON.stringify(made),
			width: width ?? row.width,
			height: height ?? row.height,
		});
		await removeFiles(old);
		return updated ?? row;
	} catch (cause) {
		console.warn(`[medialibrary] could not make resized copies of ${row.id}`, cause);
		await removeFiles(made.map((v) => v.storageKey));
		return (await getRow(row.id)) ?? row;
	}
}

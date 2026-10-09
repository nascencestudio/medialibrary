/**
 * Image dimensions from file headers (PNG, GIF, JPEG, WebP, AVIF), without
 * decoding the image. Returns null when the header can't be read; callers
 * store the item without dimensions then. Pure functions only.
 */

export interface Size {
	width: number;
	height: number;
}

const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number) =>
	(b[at] ?? 0) * 2 ** 24 + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0);
const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

const valid = (width: number, height: number): Size | null =>
	width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : null;

function png(b: Uint8Array): Size | null {
	return ascii(b, 12, 'IHDR') ? valid(u32be(b, 16), u32be(b, 20)) : null;
}

function gif(b: Uint8Array): Size | null {
	return valid(u16le(b, 6), u16le(b, 8));
}

function jpeg(b: Uint8Array): Size | null {
	let at = 2;
	while (at + 9 < b.length) {
		if (b[at] !== 0xff) return null;
		const marker = b[at + 1] ?? 0;
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		const length = u16be(b, at + 2);
		// Start-of-frame markers (baseline, progressive, …), excluding DHT, JPG and DAC.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return valid(u16be(b, at + 7), u16be(b, at + 5));
		}
		if (length < 2) return null;
		at += 2 + length;
	}
	return null;
}

function webp(b: Uint8Array): Size | null {
	if (ascii(b, 12, 'VP8 ')) return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
	if (ascii(b, 12, 'VP8L')) {
		const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
		return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (ascii(b, 12, 'VP8X')) return valid(u24le(b, 24) + 1, u24le(b, 27) + 1);
	return null;
}

/** AVIF: the first `ispe` (image spatial extents) property holds width and height. */
function avif(b: Uint8Array): Size | null {
	for (let at = 4; at + 16 <= b.length; at++) {
		if (ascii(b, at, 'ispe')) return valid(u32be(b, at + 8), u32be(b, at + 12));
	}
	return null;
}

/** Dimensions of an image file from its first bytes (64 KB is plenty for these formats). */
export function imageSize(head: Uint8Array, mime: string): Size | null {
	try {
		switch (mime) {
			case 'image/png':
				return png(head);
			case 'image/gif':
				return gif(head);
			case 'image/jpeg':
				return jpeg(head);
			case 'image/webp':
				return webp(head);
			case 'image/avif':
				return avif(head);
			default:
				return null;
		}
	} catch {
		return null;
	}
}

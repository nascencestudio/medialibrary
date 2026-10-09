/**
 * File type detection for uploads, from the file's first bytes (its
 * "signature"), never from the name or the browser-reported type alone. The
 * extension must agree with the detected type. Only the formats listed here
 * are accepted; everything else is refused. Pure functions only.
 */
import type { MediaKind } from './types.js';

export interface DetectedType {
	kind: Exclude<MediaKind, 'remoteVideo'>;
	mime: string;
	/** Extension the file is stored with (normalized). */
	ext: string;
}

interface Format extends DetectedType {
	/** Extensions accepted for this format (lowercase, without the dot). */
	exts: readonly string[];
	match: (head: Uint8Array) => boolean;
}

const ascii = (head: Uint8Array, offset: number, text: string) => {
	for (let i = 0; i < text.length; i++) if (head[offset + i] !== text.charCodeAt(i)) return false;
	return true;
};
const bytes = (head: Uint8Array, offset: number, values: number[]) => values.every((v, i) => head[offset + i] === v);

/** ISO base media file (MP4, M4A, AVIF…): `ftyp` box at offset 4 with a major/compatible brand. */
function ftypBrands(head: Uint8Array): string[] {
	if (!ascii(head, 4, 'ftyp')) return [];
	const size = (head[0] ?? 0) * 2 ** 24 + ((head[1] ?? 0) << 16) + ((head[2] ?? 0) << 8) + (head[3] ?? 0);
	const end = Math.min(size, head.length, 64);
	const brands: string[] = [];
	const read = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
	brands.push(read(8));
	for (let at = 16; at + 4 <= end; at += 4) brands.push(read(at));
	return brands;
}
const hasBrand = (head: Uint8Array, wanted: string[]) => ftypBrands(head).some((b) => wanted.includes(b));

/** EBML (Matroska/WebM) with DocType "webm" in the header. */
function isWebm(head: Uint8Array): boolean {
	if (!bytes(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return false;
	const text = String.fromCharCode(...head.subarray(0, Math.min(head.length, 64)));
	return text.includes('webm');
}

/** MP3: an ID3 tag or an MPEG audio frame sync. */
const isMp3 = (head: Uint8Array) =>
	ascii(head, 0, 'ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0 && ((head[1] ?? 0) & 0x06) !== 0);

const FORMATS: readonly Format[] = [
	// Images
	{
		kind: 'image',
		mime: 'image/jpeg',
		ext: 'jpg',
		exts: ['jpg', 'jpeg'],
		match: (h) => bytes(h, 0, [0xff, 0xd8, 0xff]),
	},
	{
		kind: 'image',
		mime: 'image/png',
		ext: 'png',
		exts: ['png'],
		match: (h) => bytes(h, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	},
	{
		kind: 'image',
		mime: 'image/gif',
		ext: 'gif',
		exts: ['gif'],
		match: (h) => ascii(h, 0, 'GIF87a') || ascii(h, 0, 'GIF89a'),
	},
	{
		kind: 'image',
		mime: 'image/webp',
		ext: 'webp',
		exts: ['webp'],
		match: (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'WEBP'),
	},
	{ kind: 'image', mime: 'image/avif', ext: 'avif', exts: ['avif'], match: (h) => hasBrand(h, ['avif', 'avis']) },
	// Video
	{
		kind: 'video',
		mime: 'video/mp4',
		ext: 'mp4',
		exts: ['mp4', 'm4v'],
		match: (h) => hasBrand(h, ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']),
	},
	{ kind: 'video', mime: 'video/webm', ext: 'webm', exts: ['webm'], match: isWebm },
	// Audio
	{ kind: 'audio', mime: 'audio/mpeg', ext: 'mp3', exts: ['mp3'], match: isMp3 },
	{ kind: 'audio', mime: 'audio/mp4', ext: 'm4a', exts: ['m4a'], match: (h) => hasBrand(h, ['M4A ', 'M4B ']) },
	{ kind: 'audio', mime: 'audio/ogg', ext: 'ogg', exts: ['ogg', 'oga', 'opus'], match: (h) => ascii(h, 0, 'OggS') },
	{
		kind: 'audio',
		mime: 'audio/wav',
		ext: 'wav',
		exts: ['wav'],
		match: (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'WAVE'),
	},
	{ kind: 'audio', mime: 'audio/flac', ext: 'flac', exts: ['flac'], match: (h) => ascii(h, 0, 'fLaC') },
	// Documents
	{ kind: 'document', mime: 'application/pdf', ext: 'pdf', exts: ['pdf'], match: (h) => ascii(h, 0, '%PDF-') },
	...(
		[
			['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
			['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
			['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
			['odt', 'application/vnd.oasis.opendocument.text'],
			['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
			['odp', 'application/vnd.oasis.opendocument.presentation'],
		] as const
	).map(
		([ext, mime]): Format => ({
			kind: 'document',
			mime,
			ext,
			exts: [ext],
			// Office/OpenDocument files are ZIP archives; the extension decides which one.
			match: (h) => bytes(h, 0, [0x50, 0x4b, 0x03, 0x04]),
		}),
	),
	{
		kind: 'document',
		mime: 'text/plain; charset=utf-8',
		ext: 'txt',
		exts: ['txt'],
		match: (h) => isText(h),
	},
	{ kind: 'document', mime: 'text/csv; charset=utf-8', ext: 'csv', exts: ['csv'], match: (h) => isText(h) },
];

/** Plain UTF-8 text: no NUL or other control bytes (except tab, CR, LF, FF), decodes as UTF-8. */
export function isText(head: Uint8Array): boolean {
	if (head.length === 0) return false;
	for (const b of head) if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c)) return false;
	try {
		// A multi-byte character may be cut off at the end of the sample; allow that.
		new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, trimPartialUtf8(head)));
		return true;
	} catch {
		return false;
	}
}

function trimPartialUtf8(head: Uint8Array): number {
	const end = head.length;
	for (let back = 1; back <= 3 && end - back >= 0; back++) {
		const b = head[end - back] ?? 0;
		if ((b & 0xc0) === 0x80) continue; // continuation byte
		if ((b & 0xe0) === 0xc0 && back < 2) return end - back;
		if ((b & 0xf0) === 0xe0 && back < 3) return end - back;
		if ((b & 0xf8) === 0xf0 && back < 4) return end - back;
		break;
	}
	return end;
}

/** Lowercase extension of a file name, without the dot ('' if none). */
export function extensionOf(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Does the start of a text file look like an SVG document? */
export function looksLikeSvg(head: Uint8Array): boolean {
	if (!isText(head)) return false;
	const text = new TextDecoder().decode(head).replace(/^﻿/, '').trimStart();
	return /^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text);
}

export type DetectResult = { ok: true; type: DetectedType } | { ok: false; reason: string };

/**
 * Detect an upload's type from its first bytes (at least 64 KB, or the whole
 * file if smaller) and its name. SVG is reported separately (`image/svg+xml`)
 * and must be sanitized before storing. `allowSvg: false` refuses SVGs (admin
 * setting).
 */
export function detectType(head: Uint8Array, fileName: string, options: { allowSvg?: boolean } = {}): DetectResult {
	const ext = extensionOf(fileName);
	if (ext === 'svg') {
		if (options.allowSvg === false) return { ok: false, reason: 'SVG uploads are turned off.' };
		return looksLikeSvg(head)
			? { ok: true, type: { kind: 'image', mime: 'image/svg+xml', ext: 'svg' } }
			: { ok: false, reason: 'The file is named .svg but is not an SVG image.' };
	}
	if (!FORMATS.some((f) => f.exts.includes(ext))) {
		return {
			ok: false,
			reason: ext ? `.${ext} files are not supported.` : 'Files need an extension (like .jpg or .pdf).',
		};
	}
	const matches = FORMATS.filter((f) => f.match(head));
	if (matches.length === 0) return { ok: false, reason: 'This file type is not supported.' };
	const agreeing = matches.find((f) => f.exts.includes(ext));
	if (!agreeing) {
		const expected = matches[0]?.exts.map((e) => `.${e}`).join(' or ');
		return { ok: false, reason: `The file's contents don't match its name (expected ${expected}).` };
	}
	return { ok: true, type: { kind: agreeing.kind, mime: agreeing.mime, ext: agreeing.ext } };
}

/** Accepted extensions per kind (for the upload dialog's `accept` and the docs). */
export const ACCEPTED_EXTENSIONS: Record<DetectedType['kind'], string[]> = {
	image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'],
	video: ['mp4', 'm4v', 'webm'],
	audio: ['mp3', 'm4a', 'ogg', 'oga', 'opus', 'wav', 'flac'],
	document: ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv'],
};

/** MIME type to serve a stored file with, from its (normalized) extension. */
export function mimeForExtension(ext: string): string | null {
	if (ext === 'svg') return 'image/svg+xml';
	if (ext === 'vtt') return 'text/vtt; charset=utf-8';
	return FORMATS.find((f) => f.ext === ext)?.mime ?? null;
}

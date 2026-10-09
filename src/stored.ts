/**
 * The JSON columns of a media row (caption tracks, image variants), parsed
 * defensively: anything malformed is dropped, and every storage key must match
 * the key pattern before it becomes a URL. Pure functions only.
 */
import { isStorageKey } from './keys.js';
import { normalizeLanguage, TRACK_KINDS, type TrackKind } from './subtitles.js';

export interface StoredTrack {
	id: string;
	kind: TrackKind;
	srclang: string;
	label: string;
	storageKey: string;
}

export interface StoredVariant {
	width: number;
	height: number;
	mime: string;
	storageKey: string;
}

export const TRACK_ID = /^t_[a-z0-9]{8}$/;

function parseArray(json: unknown): unknown[] {
	if (typeof json !== 'string' || !json) return [];
	try {
		const value = JSON.parse(json);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

/** A display label: control characters removed, trimmed, at most 80 characters. */
export function cleanLabel(input: unknown): string {
	if (typeof input !== 'string') return '';
	return (
		input
			// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
			.replace(/[\u0000-\u001f\u007f]/g, ' ')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, 80)
	);
}

export function parseTracks(json: unknown): StoredTrack[] {
	const tracks: StoredTrack[] = [];
	for (const raw of parseArray(json)) {
		if (typeof raw !== 'object' || raw === null) continue;
		const t = raw as Record<string, unknown>;
		const srclang = normalizeLanguage(t.srclang);
		const label = cleanLabel(t.label);
		if (
			typeof t.id === 'string' &&
			TRACK_ID.test(t.id) &&
			TRACK_KINDS.includes(t.kind as TrackKind) &&
			srclang &&
			label &&
			isStorageKey(t.storageKey) &&
			t.storageKey.endsWith('.vtt')
		) {
			tracks.push({ id: t.id, kind: t.kind as TrackKind, srclang, label, storageKey: t.storageKey });
		}
	}
	return tracks;
}

const VARIANT_MIMES = new Set(['image/webp']);

export function parseVariants(json: unknown): StoredVariant[] {
	const variants: StoredVariant[] = [];
	for (const raw of parseArray(json)) {
		if (typeof raw !== 'object' || raw === null) continue;
		const v = raw as Record<string, unknown>;
		const width = Number(v.width);
		const height = Number(v.height);
		if (
			Number.isInteger(width) &&
			width > 0 &&
			Number.isInteger(height) &&
			height > 0 &&
			typeof v.mime === 'string' &&
			VARIANT_MIMES.has(v.mime) &&
			isStorageKey(v.storageKey)
		) {
			variants.push({ width, height, mime: v.mime, storageKey: v.storageKey });
		}
	}
	return variants.sort((a, b) => a.width - b.width);
}

/** `srcset` from variants plus the original (when its width is known and larger), or null. */
export function srcsetFor(
	variants: readonly { url: string; width: number }[],
	original: { url: string; width: number | null },
): string | null {
	if (variants.length === 0) return null;
	const entries = variants.map((v) => `${v.url} ${v.width}w`);
	const largest = variants[variants.length - 1]?.width ?? 0;
	if (original.width && original.width > largest) entries.push(`${original.url} ${original.width}w`);
	return entries.join(', ');
}

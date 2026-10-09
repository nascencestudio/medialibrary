/**
 * Captions and subtitles for uploaded videos: WebVTT files (and SRT files,
 * converted to WebVTT). The file is rebuilt from what's allowed instead of
 * stored as uploaded: cue timings (normalized), known cue settings, and cue
 * text with only WebVTT's formatting tags (b, i, u, c, v, lang, ruby, rt,
 * timestamps). STYLE blocks (CSS that could load outside URLs), REGION and NOTE
 * blocks, and anything unparseable are dropped. Pure functions only. ADR 0019.
 *
 * Browsers render cue text with their own WebVTT parser (no HTML, no script),
 * and the file is served with `nosniff` and the sandbox CSP, so this is
 * defense in depth and keeps stored files small and predictable.
 */

export type TrackKind = 'subtitles' | 'captions';
export const TRACK_KINDS: readonly TrackKind[] = ['subtitles', 'captions'];

/** Largest accepted subtitle file. */
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
/** At most this many tracks per video. */
export const MAX_TRACKS = 20;

export type SubtitleResult = { ok: true; vtt: string; cues: number } | { ok: false; reason: string };

const TIME = /^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/;

/** Seconds from a WebVTT/SRT timestamp, or null. */
export function parseTime(value: string): number | null {
	const match = TIME.exec(value.trim());
	if (!match) return null;
	return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

/** `hh:mm:ss.ttt` (hours at least two digits). */
export function formatTime(seconds: number): string {
	const ms = Math.round(seconds * 1000);
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');
	return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** Cue settings we keep, with the values WebVTT allows. */
const SETTINGS: Record<string, RegExp> = {
	vertical: /^(rl|lr)$/,
	line: /^(-?\d{1,3}|\d{1,3}(\.\d+)?%)(,(start|center|end))?$/,
	position: /^\d{1,3}(\.\d+)?%(,(line-left|center|line-right))?$/,
	size: /^\d{1,3}(\.\d+)?%$/,
	align: /^(start|center|end|left|right)$/,
};

function cleanSettings(text: string): string {
	const kept: string[] = [];
	for (const part of text.trim().split(/[ \t]+/)) {
		const [name, value] = part.split(':');
		if (name && value && SETTINGS[name]?.test(value) && !kept.some((k) => k.startsWith(`${name}:`))) {
			kept.push(`${name}:${value}`);
		}
	}
	return kept.join(' ');
}

/** WebVTT cue tags we keep: b, i, u, c, v, lang, ruby, rt (with simple classes/annotations) and timestamps. */
const TAG = /<(\/?)([a-z]+)((?:\.[\w-]+)*)(?:[ \t]([^<>]*))?>|<(\d{1,3}:)?[0-5]\d:[0-5]\d\.\d{3}>/gi;
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'c', 'v', 'lang', 'ruby', 'rt']);

function cleanCueText(text: string): string {
	const withTags = text.replace(/<[^>]*>?/g, (tag) => {
		TAG.lastIndex = 0;
		const match = TAG.exec(tag);
		if (!match || match[0] !== tag) return '';
		if (!match[2]) return tag; // timestamp
		const name = match[2].toLowerCase();
		if (!ALLOWED_TAGS.has(name)) return '';
		if (match[1]) return `</${name}>`;
		const classes = match[3] ?? '';
		const annotation = (match[4] ?? '').replace(/[<>&]/g, '').trim().slice(0, 100);
		return annotation && (name === 'v' || name === 'lang')
			? `<${name}${classes} ${annotation}>`
			: `<${name}${classes}>`;
	});
	// A bare "-->" in cue text ends the cue in some parsers; WebVTT forbids it.
	return withTags.replace(/-->/g, '→').trim();
}

/** Text from bytes: valid UTF-8 only (BOM removed), no NUL or other control bytes except tab/newlines. */
export function decodeSubtitleText(bytes: Uint8Array): string | null {
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
	text = text.replace(/^﻿/, '');
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's refused
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
	return text.replace(/\r\n?/g, '\n');
}

interface Cue {
	start: number;
	end: number;
	settings: string;
	text: string;
	id: string;
}

function parseBlocks(text: string, srt: boolean): Cue[] {
	const cues: Cue[] = [];
	for (const block of text.split(/\n{2,}/)) {
		if (!block.trim()) continue;
		const lines = block.replace(/^\n+|\n+$/g, '').split('\n');
		const timingIndex = lines.findIndex((line) => line.includes('-->'));
		if (timingIndex < 0 || timingIndex > 1) continue; // header, NOTE, STYLE, REGION or junk
		const first = lines[0]?.trim() ?? '';
		if (/^(NOTE|STYLE|REGION)(\s|$)/.test(first) && timingIndex !== 0) continue;
		const [startText = '', rest = ''] = (lines[timingIndex] ?? '').split('-->');
		const [endText = '', ...settingParts] = rest.trim().split(/[ \t]+/);
		const start = parseTime(startText);
		const end = parseTime(endText);
		if (start === null || end === null || end < start) continue;
		const cueText = cleanCueText(lines.slice(timingIndex + 1).join('\n'));
		if (!cueText) continue;
		const id = timingIndex === 1 && !srt ? first.replace(/-->/g, '').slice(0, 100).trim() : '';
		cues.push({ start, end, settings: srt ? '' : cleanSettings(settingParts.join(' ')), text: cueText, id });
	}
	return cues;
}

/**
 * Clean WebVTT, or convert SRT, into a minimal WebVTT file. `fileName` decides
 * the format (`.vtt` or `.srt`); a .vtt file must start with `WEBVTT`.
 */
export function cleanSubtitles(bytes: Uint8Array, fileName: string): SubtitleResult {
	const ext = fileName.toLowerCase().split('.').pop();
	if (ext !== 'vtt' && ext !== 'srt') return { ok: false, reason: 'Captions must be .vtt (WebVTT) or .srt files.' };
	if (bytes.byteLength > MAX_SUBTITLE_BYTES) return { ok: false, reason: 'Caption files can be at most 2 MB.' };
	const text = decodeSubtitleText(bytes);
	if (text === null) return { ok: false, reason: 'The caption file must be UTF-8 text.' };
	if (ext === 'vtt' && !/^WEBVTT([ \t\n]|$)/.test(text)) {
		return { ok: false, reason: 'The file is named .vtt but is not a WebVTT file (it must start with WEBVTT).' };
	}
	const body = ext === 'vtt' ? text.slice(text.indexOf('\n') + 1 || text.length) : text;
	const cues = parseBlocks(`\n${body}`, ext === 'srt');
	if (cues.length === 0) return { ok: false, reason: 'No captions found in the file.' };
	const out = cues.map(
		(cue) =>
			`${cue.id ? `${cue.id}\n` : ''}${formatTime(cue.start)} --> ${formatTime(cue.end)}${cue.settings ? ` ${cue.settings}` : ''}\n${cue.text}`,
	);
	return { ok: true, vtt: `WEBVTT\n\n${out.join('\n\n')}\n`, cues: cues.length };
}

/** A BCP 47 language tag (simple form: `en`, `pt-BR`, `zh-Hant`), lowercase primary subtag, or ''. */
export function normalizeLanguage(input: unknown): string {
	if (typeof input !== 'string') return '';
	const tag = input.trim();
	if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/.test(tag)) return '';
	const [primary = '', ...rest] = tag.split('-');
	return [primary.toLowerCase(), ...rest].join('-');
}

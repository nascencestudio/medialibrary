import { describe, expect, it } from 'vitest';
import { cleanSubtitles, formatTime, normalizeLanguage, parseTime } from '../src/subtitles.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const clean = (text: string, name = 'captions.vtt') => cleanSubtitles(bytes(text), name);
const vtt = (text: string, name?: string) => {
	const result = clean(text, name);
	if (!result.ok) throw new Error(result.reason);
	return result.vtt;
};

describe('times', () => {
	it('parses WebVTT and SRT timestamps', () => {
		expect(parseTime('00:01.500')).toBe(1.5);
		expect(parseTime('01:02:03.004')).toBeCloseTo(3723.004);
		expect(parseTime('00:00:01,250')).toBe(1.25);
		expect(parseTime('1:2:3.4')).toBeNull();
		expect(parseTime('00:61.000')).toBeNull();
	});

	it('formats as hh:mm:ss.ttt', () => {
		expect(formatTime(3723.004)).toBe('01:02:03.004');
		expect(formatTime(1.5)).toBe('00:00:01.500');
	});
});

describe('cleanSubtitles: WebVTT', () => {
	it('keeps cues, ids, allowed settings and formatting tags', () => {
		const out = vtt(
			'WEBVTT - My film\n\nintro\n00:01.000 --> 00:04.000 align:start line:0 position:10%\n<v Narrator>Hello <b>there</b> <i>friend</i></v>\n\n00:05.000 --> 00:06.500\nSecond line\nwith two lines',
		);
		expect(out).toBe(
			'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:04.000 align:start line:0 position:10%\n<v Narrator>Hello <b>there</b> <i>friend</i></v>\n\n00:00:05.000 --> 00:00:06.500\nSecond line\nwith two lines\n',
		);
	});

	it('drops STYLE, REGION and NOTE blocks and unknown settings', () => {
		const out = vtt(
			'WEBVTT\n\nSTYLE\n::cue { background: url(https://tracker.example/x.png) }\n\nREGION\nid:a width:40%\n\nNOTE written by someone\n\n00:01.000 --> 00:02.000 region:a vertical:rl evil:1 align:middle\nText',
		);
		expect(out).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000 vertical:rl\nText\n');
		expect(out).not.toMatch(/tracker|STYLE|REGION|NOTE/);
	});

	it('strips HTML-like tags that WebVTT does not have, keeping their text', () => {
		const out = vtt(
			'WEBVTT\n\n00:01.000 --> 00:02.000\n<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">link</a> <c.yellow.big>ok</c> <00:01.500>karaoke',
		);
		expect(out).toContain('alert(1)link <c.yellow.big>ok</c> <00:01.500>karaoke');
		expect(out).not.toMatch(/<script|<img|<a |onerror/);
	});

	it('cleans annotations and forbids "-->" inside cue text', () => {
		const out = vtt('WEBVTT\n\n00:01.000 --> 00:02.000\n<v Bob"><x>>Hi\n--> fake timing');
		expect(out).not.toMatch(/\n--> fake/);
		expect(out).toContain('→ fake timing');
	});

	it('drops cues with bad timings and handles CRLF and a BOM', () => {
		const out = vtt(
			'﻿WEBVTT\r\n\r\n00:05.000 --> 00:01.000\r\nbackwards\r\n\r\nxx --> yy\r\nbroken\r\n\r\n00:01.000 --> 00:02.000\r\nkept',
		);
		expect(out).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nkept\n');
	});

	it.each([
		['not WebVTT', 'Hello\n\n00:01.000 --> 00:02.000\nx', /must start with WEBVTT/],
		['no cues', 'WEBVTT\n\nNOTE nothing here', /No captions/],
		['wrong extension', 'WEBVTT', /\.vtt.*\.srt/, 'captions.txt'],
	])('refuses %s', (_, text, reason, name = 'captions.vtt') => {
		const result = clean(text, name);
		expect(result.ok).toBe(false);
		expect(result.ok ? '' : result.reason).toMatch(reason);
	});

	it('refuses invalid UTF-8, control bytes and oversized files', () => {
		expect(cleanSubtitles(new Uint8Array([0x57, 0x45, 0xff]), 'a.vtt').ok).toBe(false);
		expect(clean('WEBVTT\n\n00:01.000 --> 00:02.000\nnull\u0000byte').ok).toBe(false);
		expect(cleanSubtitles(new Uint8Array(2 * 1024 * 1024 + 1), 'a.vtt')).toMatchObject({ ok: false });
	});
});

describe('cleanSubtitles: SRT', () => {
	it('converts SRT to WebVTT, keeping b/i/u and dropping font tags', () => {
		const out = vtt(
			'1\n00:00:01,000 --> 00:00:04,000\n<font color="red">Hello</font> <b>world</b>\n\n2\n00:00:05,000 --> 00:00:06,000\nBye',
			'film.srt',
		);
		expect(out).toBe(
			'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello <b>world</b>\n\n00:00:05.000 --> 00:00:06.000\nBye\n',
		);
	});
});

describe('normalizeLanguage', () => {
	it.each([
		['en', 'en'],
		['EN', 'en'],
		['pt-BR', 'pt-BR'],
		['zh-Hant-TW', 'zh-Hant-TW'],
	])('%s → %s', (input, output) => {
		expect(normalizeLanguage(input)).toBe(output);
	});

	it.each(['', 'e', 'english', 'en_US', 'en-', '"><script>', 5])('refuses %j', (input) => {
		expect(normalizeLanguage(input)).toBe('');
	});
});

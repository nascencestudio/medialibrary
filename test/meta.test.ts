import { describe, expect, it } from 'vitest';
import { isStorageKey, keyToken, storageKeyFor } from '../src/keys.js';
import {
	decodeTags,
	encodeTags,
	focalPosition,
	MAX_TAGS,
	normalizeFocalPoint,
	normalizeTag,
	normalizeTags,
} from '../src/meta.js';
import { cleanLabel, parseTracks, parseVariants, srcsetFor } from '../src/stored.js';

describe('tags', () => {
	it('normalizes case, spacing and Unicode', () => {
		expect(normalizeTag('  Summer   Campaign ')).toBe('summer campaign');
		expect(normalizeTag('Café')).toBe('café');
		expect(normalizeTag('2026_q3-launch')).toBe('2026_q3-launch');
		expect(normalizeTag('日本')).toBe('日本');
	});

	it.each(['', '   ', 'a|b', '<script>', '-leading', '_x', 'semi;colon', '%', 'x'.repeat(41), 42, null])(
		'refuses %j',
		(input) => {
			expect(normalizeTag(input)).toBe('');
		},
	);

	it('dedupes, sorts and caps lists', () => {
		expect(normalizeTags(['b', 'A', 'a', 'bad|tag', 'c'])).toEqual(['a', 'b', 'c']);
		expect(normalizeTags(Array.from({ length: 50 }, (_, i) => `tag ${i}`))).toHaveLength(MAX_TAGS);
		expect(normalizeTags('a,b')).toEqual([]);
	});

	it('round-trips through the storage form', () => {
		expect(encodeTags(['a', 'b c'])).toBe('|a|b c|');
		expect(encodeTags([])).toBe('');
		expect(decodeTags('|a|b c|')).toEqual(['a', 'b c']);
		expect(decodeTags('|ok|<bad>|')).toEqual(['ok']);
		expect(decodeTags(null)).toEqual([]);
	});
});

describe('focal point', () => {
	it('accepts percentages and rounds them', () => {
		expect(normalizeFocalPoint({ x: 30.4, y: 70.6 })).toEqual({ x: 30, y: 71 });
		expect(normalizeFocalPoint({ x: 0, y: 100 })).toEqual({ x: 0, y: 100 });
	});

	it.each([null, {}, { x: 50 }, { x: -1, y: 50 }, { x: 50, y: 101 }, { x: '50', y: 50 }, { x: Number.NaN, y: 1 }])(
		'refuses %j',
		(input) => {
			expect(normalizeFocalPoint(input)).toBeNull();
		},
	);

	it('gives a CSS position', () => {
		expect(focalPosition({ x: 20, y: 80 })).toBe('20% 80%');
		expect(focalPosition(null)).toBe('50% 50%');
	});
});

describe('storage keys', () => {
	it('allow an optional suffix for replacements, variants and captions', () => {
		expect(storageKeyFor('m_abcdefghijklmnop', 'jpg', new Date('2026-03-04'))).toBe('2026/03/m_abcdefghijklmnop.jpg');
		const key = storageKeyFor('m_abcdefghijklmnop', 'webp', new Date('2026-03-04'), `${keyToken()}w960`);
		expect(isStorageKey(key)).toBe(true);
		expect(keyToken()).toMatch(/^[a-z0-9]{8}$/);
	});

	it.each([
		'2026/03/m_abcdefghijklmnop.jpg/../../etc',
		'2026/03/m_abcdefghijklmnop-.jpg',
		'2026/03/m_abcdefghijklmnop-UPPER.jpg',
		'2026/03/m_abcdefghijklmnop-a.b.jpg',
		'../2026/03/m_abcdefghijklmnop.jpg',
		'2026/03/m_abcdefghijklmnop',
	])('refuses %s', (key) => {
		expect(isStorageKey(key)).toBe(false);
	});
});

describe('stored JSON columns', () => {
	const track = {
		id: 't_abcd1234',
		kind: 'captions',
		srclang: 'EN',
		label: ' English ',
		storageKey: '2026/03/m_abcdefghijklmnop-x1.vtt',
	};

	it('keeps valid tracks (normalized) and drops invalid ones', () => {
		const json = JSON.stringify([
			track,
			{ ...track, id: 'nope' },
			{ ...track, kind: 'chapters' },
			{ ...track, srclang: 'english language' },
			{ ...track, label: '' },
			{ ...track, storageKey: '../../etc/passwd' },
			{ ...track, storageKey: '2026/03/m_abcdefghijklmnop-x1.html' },
			null,
			'x',
		]);
		expect(parseTracks(json)).toEqual([{ ...track, srclang: 'en', label: 'English' }]);
		expect(parseTracks('not json')).toEqual([]);
		expect(parseTracks('{"a":1}')).toEqual([]);
	});

	it('keeps valid variants, sorted by width', () => {
		const v = (width: number, extra = {}) => ({
			width,
			height: width / 2,
			mime: 'image/webp',
			storageKey: `2026/03/m_abcdefghijklmnop-k${width}.webp`,
			...extra,
		});
		const json = JSON.stringify([v(960), v(480), v(100, { mime: 'text/html' }), v(200, { width: -1 }), v(300.5)]);
		expect(parseVariants(json).map((x) => x.width)).toEqual([480, 960]);
	});

	it('builds a srcset with the original when it is wider', () => {
		const variants = [
			{ url: '/a-480.webp', width: 480 },
			{ url: '/a-960.webp', width: 960 },
		];
		expect(srcsetFor(variants, { url: '/a.jpg', width: 1200 })).toBe(
			'/a-480.webp 480w, /a-960.webp 960w, /a.jpg 1200w',
		);
		expect(srcsetFor(variants, { url: '/a.jpg', width: null })).toBe('/a-480.webp 480w, /a-960.webp 960w');
		expect(srcsetFor([], { url: '/a.jpg', width: 1200 })).toBeNull();
	});

	it('cleans labels', () => {
		expect(cleanLabel(' English\n(US) ')).toBe('English (US)');
		expect(cleanLabel('x'.repeat(200))).toHaveLength(80);
		expect(cleanLabel(5)).toBe('');
	});
});

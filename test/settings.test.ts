import { describe, expect, it } from 'vitest';
import { detectType } from '../src/detect.js';
import {
	defaultSettings,
	FORM,
	MB,
	maxUploadSizeFrom,
	parseMediaSettings,
	type SettingsBounds,
	settingsFromForm,
} from '../src/settings.js';
import { DEFAULT_LIMITS } from '../src/types.js';

const bounds: SettingsBounds = { limits: DEFAULT_LIMITS, allowSvg: true, maxUploadSize: 1024 * MB };

const form = (values: Record<string, string>) => new URLSearchParams(values);
const validForm = (extra: Record<string, string> = {}) =>
	form({
		[FORM.limit('image')]: '20',
		[FORM.limit('video')]: '500',
		[FORM.limit('audio')]: '100',
		[FORM.limit('document')]: '25',
		...extra,
	});

describe('parseMediaSettings', () => {
	it('uses the developer defaults when nothing is stored', () => {
		expect(parseMediaSettings(undefined, bounds)).toEqual({ limits: DEFAULT_LIMITS, allowSvg: true });
		expect(parseMediaSettings({ version: 2, allowSvg: false }, bounds).allowSvg).toBe(true);
	});

	it('applies stored values', () => {
		const settings = parseMediaSettings({ version: 1, limits: { image: 20 * MB }, allowSvg: false }, bounds);
		expect(settings).toEqual({ limits: { ...DEFAULT_LIMITS, image: 20 * MB }, allowSvg: false });
	});

	it('holds limits between 1 MB and the ceiling, whatever is stored', () => {
		const settings = parseMediaSettings(
			{ version: 1, limits: { image: 10 ** 15, video: 5, audio: -1, document: Number.NaN } },
			bounds,
		);
		expect(settings.limits).toEqual({ ...DEFAULT_LIMITS, image: 1024 * MB, video: MB });
	});

	it.each([null, 'x', [], { version: 1, limits: 'big', allowSvg: 'yes' }, { version: 1, limits: { image: '50' } }])(
		'ignores malformed data: %j',
		(raw) => {
			expect(parseMediaSettings(raw, bounds)).toEqual(defaultSettings(bounds));
		},
	);

	it('lowers defaults that are above the ceiling', () => {
		expect(defaultSettings({ ...bounds, maxUploadSize: 50 * MB }).limits.video).toBe(50 * MB);
	});
});

describe('settingsFromForm', () => {
	it('reads whole megabytes and the SVG checkbox', () => {
		expect(settingsFromForm(validForm({ [FORM.allowSvg]: 'on' }), bounds)).toEqual({
			ok: true,
			settings: {
				version: 1,
				limits: { image: 20 * MB, video: 500 * MB, audio: 100 * MB, document: 25 * MB },
				allowSvg: true,
			},
		});
		const off = settingsFromForm(validForm(), bounds);
		expect(off.ok && off.settings.allowSvg).toBe(false);
	});

	it.each(['0', '-5', '1.5', '1e3', '', ' ', '0x10', '2000', '99999999', '10 MB'])(
		'refuses the limit %j without saving anything',
		(value) => {
			const result = settingsFromForm(validForm({ [FORM.limit('video')]: value }), bounds);
			expect(result.ok).toBe(false);
			expect(result.ok ? {} : result.errors).toEqual({ video: 'Enter a whole number of MB from 1 to 1024.' });
		},
	);

	it('accepts the ceiling itself', () => {
		expect(settingsFromForm(validForm({ [FORM.limit('video')]: '1024' }), bounds).ok).toBe(true);
	});
});

describe('maxUploadSizeFrom', () => {
	it('uses MEDIA_MAX_UPLOAD_MB when it is a positive whole number', () => {
		expect(maxUploadSizeFrom(1024 * MB, '300')).toBe(300 * MB);
		expect(maxUploadSizeFrom(1024 * MB, undefined)).toBe(1024 * MB);
		expect(maxUploadSizeFrom(1024 * MB, '0')).toBe(1024 * MB);
		expect(maxUploadSizeFrom(1024 * MB, 'lots')).toBe(1024 * MB);
	});
});

describe('detectType with SVG turned off', () => {
	const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

	it('refuses SVGs with a clear message', () => {
		expect(detectType(svg, 'logo.svg', { allowSvg: false })).toEqual({
			ok: false,
			reason: 'SVG uploads are turned off.',
		});
		expect(detectType(svg, 'logo.svg', { allowSvg: true }).ok).toBe(true);
	});

	it('never lets SVG content in as an image under another extension', () => {
		expect(detectType(svg, 'logo.png', { allowSvg: false }).ok).toBe(false);
		// As .txt it's plain text (served as a text/plain download), not an image.
		expect(detectType(svg, 'logo.txt', { allowSvg: false })).toMatchObject({
			ok: true,
			type: { kind: 'document', mime: expect.stringMatching(/^text\/plain/) },
		});
	});
});

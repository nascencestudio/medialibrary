import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectType, extensionOf, isText, looksLikeSvg, mimeForExtension } from '../src/detect.js';
import { imageSize } from '../src/dimensions.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const text = (s: string) => new TextEncoder().encode(s);

describe('detectType: real files', () => {
	it.each([
		['sample.png', 'image', 'image/png'],
		['sample.jpg', 'image', 'image/jpeg'],
		['sample.gif', 'image', 'image/gif'],
		['sample.webp', 'image', 'image/webp'],
		['lossless.webp', 'image', 'image/webp'],
		['sample.avif', 'image', 'image/avif'],
		['sample.mp4', 'video', 'video/mp4'],
		['sample.webm', 'video', 'video/webm'],
		['sample.mp3', 'audio', 'audio/mpeg'],
		['sample.m4a', 'audio', 'audio/mp4'],
		['sample.ogg', 'audio', 'audio/ogg'],
		['sample.wav', 'audio', 'audio/wav'],
		['sample.flac', 'audio', 'audio/flac'],
		['sample.pdf', 'document', 'application/pdf'],
		['sample.csv', 'document', 'text/csv; charset=utf-8'],
	])('%s is %s (%s)', (file, kind, mime) => {
		const result = detectType(fixture(file), file);
		expect(result).toMatchObject({ ok: true, type: { kind, mime } });
	});

	it('accepts alternative extensions and normalizes the stored one', () => {
		expect(detectType(fixture('sample.jpg'), 'Photo.JPEG')).toMatchObject({ ok: true, type: { ext: 'jpg' } });
	});

	it('detects Office documents by ZIP signature plus extension', () => {
		const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
		expect(detectType(zip, 'report.docx')).toMatchObject({ ok: true, type: { kind: 'document', ext: 'docx' } });
		expect(detectType(zip, 'archive.zip')).toMatchObject({ ok: false });
	});
});

describe('detectType: refusals', () => {
	it('refuses a file whose contents disagree with its name', () => {
		const result = detectType(fixture('sample.png'), 'photo.jpg');
		expect(result).toMatchObject({ ok: false });
		expect(result.ok ? '' : result.reason).toMatch(/\.png/);
	});

	it.each([
		['page.html', '<!doctype html><script>alert(1)</script>'],
		['script.js', 'alert(1)'],
		['evil.exe', 'MZ\u0090\u0000'],
		['shell.php', '<?php system($_GET[1]); ?>'],
		['empty.txt', ''],
	])('refuses %s', (name, content) => {
		expect(detectType(text(content), name).ok).toBe(false);
	});

	it('names the problem: unsupported extension vs contents that do not match', () => {
		expect(detectType(text('<html></html>'), 'page.html')).toEqual({
			ok: false,
			reason: '.html files are not supported.',
		});
		expect(detectType(text('hello'), 'README')).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/extension/),
		});
	});

	it('refuses an HTML file renamed to .png or .txt with binary content', () => {
		expect(detectType(text('<html><script>alert(1)</script></html>'), 'image.png').ok).toBe(false);
		expect(detectType(new Uint8Array([0x41, 0x00, 0x42]), 'notes.txt').ok).toBe(false);
	});

	it('accepts SVG only when the content is an SVG document', () => {
		expect(detectType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.svg')).toMatchObject({
			ok: true,
			type: { mime: 'image/svg+xml' },
		});
		expect(detectType(text('<?xml version="1.0"?>\n<!-- x -->\n<svg viewBox="0 0 1 1"></svg>'), 'a.svg').ok).toBe(true);
		expect(detectType(text('<html><body></body></html>'), 'a.svg').ok).toBe(false);
		expect(looksLikeSvg(fixture('sample.png'))).toBe(false);
	});
});

describe('helpers', () => {
	it('extensionOf ignores paths and dotfiles', () => {
		expect(extensionOf('a/b/C.Jpg')).toBe('jpg');
		expect(extensionOf('.bashrc')).toBe('');
		expect(extensionOf('noext')).toBe('');
	});

	it('isText tolerates a multi-byte character cut off at the end of the sample', () => {
		const bytes = text('héllo wörld');
		expect(isText(bytes.subarray(0, bytes.length - 1))).toBe(true);
		expect(isText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
	});

	it('mimeForExtension serves only known types', () => {
		expect(mimeForExtension('avif')).toBe('image/avif');
		expect(mimeForExtension('svg')).toBe('image/svg+xml');
		expect(mimeForExtension('html')).toBeNull();
	});
});

describe('imageSize', () => {
	it.each([
		['sample.png', 'image/png', 37, 23],
		['sample.jpg', 'image/jpeg', 37, 23],
		['sample.gif', 'image/gif', 37, 23],
		['sample.webp', 'image/webp', 37, 23],
		['lossless.webp', 'image/webp', 40, 30],
		['sample.avif', 'image/avif', 37, 23],
	])('%s is %ix%i', (file, mime, width, height) => {
		expect(imageSize(fixture(file), mime)).toEqual({ width, height });
	});

	it('returns null for truncated or garbage headers', () => {
		expect(imageSize(new Uint8Array([0x89, 0x50]), 'image/png')).toBeNull();
		expect(imageSize(new Uint8Array(100), 'image/jpeg')).toBeNull();
		expect(imageSize(fixture('sample.png'), 'image/svg+xml')).toBeNull();
	});
});

/**
 * GET/HEAD /files/<YYYY>/<MM>/<id>.<ext>: serves uploaded files (public, like
 * any published media). Only keys of that exact shape are served, with the
 * type taken from the extension. Byte ranges are supported (video seeking).
 *
 * Every file gets `nosniff` and a sandboxing Content-Security-Policy, so an
 * SVG opened directly can't run script even if sanitizing missed something.
 * Office documents and text files download instead of opening on the site.
 */
import type { APIRoute } from 'astro';
import { mimeForExtension } from '../detect.js';
import { fileInfo, readStream, STORAGE_KEY } from './storage.js';

export const prerender = false;

const DOWNLOAD = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv']);
const SANDBOX = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
	let start: number;
	let end: number;
	if (match[1] === '') {
		start = Math.max(0, size - Number(match[2]));
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
	}
	return start <= end && start < size ? { start, end } : 'invalid';
}

const serve: APIRoute = async (context) => {
	const key = context.params.path ?? '';
	if (!STORAGE_KEY.test(key)) return notFound();
	const ext = key.slice(key.lastIndexOf('.') + 1);
	const mime = mimeForExtension(ext);
	if (!mime) return notFound();
	const info = await fileInfo(key);
	if (!info) return notFound();

	const headers = new Headers({
		'Content-Type': mime,
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': SANDBOX,
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Accept-Ranges': 'bytes',
		'Last-Modified': info.mtime.toUTCString(),
	});
	if (DOWNLOAD.has(ext)) headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);

	const range = parseRange(context.request.headers.get('range'), info.size);
	if (range === 'invalid') {
		headers.set('Content-Range', `bytes */${info.size}`);
		return new Response(null, { status: 416, headers });
	}
	const head = context.request.method === 'HEAD';
	if (range) {
		headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
		headers.set('Content-Length', String(range.end - range.start + 1));
		return new Response(head ? null : readStream(key, range), { status: 206, headers });
	}
	headers.set('Content-Length', String(info.size));
	return new Response(head ? null : readStream(key), { status: 200, headers });
};

export const GET = serve;
export const HEAD = serve;

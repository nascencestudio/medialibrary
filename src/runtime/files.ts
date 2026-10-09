/**
 * GET/HEAD /files/<file name>: serves uploaded files (public, like any published
 * media). The file name (`m_<id>[-<suffix>].<ext>`) must be one of its item's
 * stored files; where it lives on disk follows the item's folder (ADR 0100), so the
 * URL never changes when the item moves. Links from before folders
 * (`/files/<YYYY>/<MM>/<file name>`) keep working the same way. The type comes from
 * the extension. Byte ranges are supported (video seeking).
 *
 * Every file gets `nosniff` and a sandboxing Content-Security-Policy, so an
 * SVG opened directly can't run script even if sanitizing missed something.
 * Office documents and text files download instead of opening on the site.
 */
import type { APIRoute } from 'astro';
import { mimeForExtension } from '../detect.js';
import { fileNameOf, isStorageKey, mediaIdOf } from '../keys.js';
import { filesOf, getRow } from './db.js';
import { fileInfo, locateFile, readStream } from './storage.js';

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
	const requested = context.params.path ?? '';
	if (!isStorageKey(requested)) return notFound();
	const name = fileNameOf(requested);
	const ext = name.slice(name.lastIndexOf('.') + 1);
	const mime = mimeForExtension(ext);
	if (!mime) return notFound();
	const row = await getRow(mediaIdOf(name));
	const key = row && filesOf(row).find((k) => fileNameOf(k) === name);
	if (!row || !key) return notFound();
	const path = await locateFile(row.folderId ?? null, key);
	const info = path && (await fileInfo(path));
	if (!path || !info) return notFound();

	const headers = new Headers({
		'Content-Type': mime,
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': SANDBOX,
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Accept-Ranges': 'bytes',
		'Last-Modified': info.mtime.toUTCString(),
	});
	if (DOWNLOAD.has(ext)) headers.set('Content-Disposition', `attachment; filename="${name}"`);

	const range = parseRange(context.request.headers.get('range'), info.size);
	if (range === 'invalid') {
		headers.set('Content-Range', `bytes */${info.size}`);
		return new Response(null, { status: 416, headers });
	}
	const head = context.request.method === 'HEAD';
	if (range) {
		headers.set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
		headers.set('Content-Length', String(range.end - range.start + 1));
		return new Response(head ? null : readStream(path, range), { status: 206, headers });
	}
	headers.set('Content-Length', String(info.size));
	return new Response(head ? null : readStream(path), { status: 200, headers });
};

export const GET = serve;
export const HEAD = serve;

/**
 * Shared request guards and responses for the media API.
 */
import type { APIContext } from 'astro';
import { getMediaViewer, type MediaViewer } from './viewer.js';

export const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});

export const error = (status: number, message: string) => json({ error: message }, status);

/**
 * Editors only; state-changing methods must come from the same origin (CSRF).
 * Returns the viewer, or a response to send instead.
 */
export async function guard(context: APIContext): Promise<MediaViewer | Response> {
	const method = context.request.method;
	if (method !== 'GET' && method !== 'HEAD' && context.request.headers.get('origin') !== context.url.origin) {
		return error(403, 'Cross-origin request refused');
	}
	const viewer = await getMediaViewer(context);
	if (!viewer.isEditor) return error(403, 'Editors only');
	return viewer;
}

/** Read a small JSON body (max 16 KB). */
export async function readJson(context: APIContext): Promise<Record<string, unknown> | null> {
	const text = await context.request.text();
	if (text.length > 16 * 1024) return null;
	try {
		const value = JSON.parse(text);
		return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}

export class BodyTooLargeError extends Error {}

/** Read a request body up to `max` bytes (streamed; stops early when it's larger). */
export async function readBody(context: APIContext, max: number): Promise<Uint8Array> {
	if (Number(context.request.headers.get('content-length') ?? 0) > max) throw new BodyTooLargeError();
	const reader = context.request.body?.getReader();
	if (!reader) return new Uint8Array(0);
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			throw new BodyTooLargeError();
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

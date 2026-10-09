/**
 * GET /_media/api/settings: what uploads currently allow (size limit per kind,
 * SVG on or off), for the library's upload dialog and its size check. Editors
 * only. The upload endpoint enforces the same settings itself.
 */
import type { APIRoute } from 'astro';
import { guard, json } from '../http.js';
import { loadMediaSettings } from '../settings-store.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	return json({ settings: await loadMediaSettings() });
};

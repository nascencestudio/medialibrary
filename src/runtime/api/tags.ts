/**
 * GET /_media/api/tags: every tag in use with its item count, most used first
 * (for the library's tag filter and suggestions). Editors only.
 */
import type { APIRoute } from 'astro';
import { listTags } from '../db.js';
import { guard, json } from '../http.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	return json({ tags: await listTags() });
};

/**
 * GET /_media/api/items?kind=image,video&q=…&tag=…&folder=…&offset=0&limit=60: list media items,
 * newest first. `folder`: a folder id (items directly in it), `top` (items not in a folder), or
 * absent (every item). Editors only. Also returns `usage`: how many pages use each listed item
 * (items on no page are left out).
 */
import type { APIRoute } from 'astro';
import { isFolderId } from '../../folders.js';
import { normalizeTag } from '../../meta.js';
import { MEDIA_KINDS, type MediaKind } from '../../types.js';
import { listRows, toItem, usageByItem } from '../db.js';
import { error, guard, json } from '../http.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const params = context.url.searchParams;
	const kinds = (params.get('kind') ?? '')
		.split(',')
		.filter((k): k is MediaKind => (MEDIA_KINDS as readonly string[]).includes(k));
	const search = (params.get('q') ?? '').trim().slice(0, 100);
	const tag = normalizeTag(params.get('tag') ?? '') || undefined;
	const folderParam = params.get('folder');
	const folder = folderParam === 'top' ? null : isFolderId(folderParam) ? folderParam : undefined;
	if (folderParam && folder === undefined) return error(400, 'Unknown folder');
	const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0));
	const limit = Math.min(200, Math.max(1, Math.floor(Number(params.get('limit')) || 60)));
	try {
		const { rows, total } = await listRows({ kinds, search, tag, folder, offset, limit });
		const usage = await usageByItem(rows.map((row) => row.id));
		return json({
			items: rows.map(toItem),
			total,
			usage: Object.fromEntries([...usage].map(([id, pages]) => [id, pages.length])),
		});
	} catch (cause) {
		console.error('[medialibrary] listing failed', cause);
		return error(500, 'Listing media failed');
	}
};

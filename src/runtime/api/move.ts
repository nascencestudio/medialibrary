/**
 * POST /_media/api/move { ids: [...], folderId }: move up to 200 items into a folder
 * (`null`: the top level). Their files move on disk; their URLs don't change.
 * Editors only, same origin only (ADR 0100).
 */
import type { APIRoute } from 'astro';
import { isMediaId } from '../../types.js';
import { toItem } from '../db.js';
import { FolderError, moveItems, targetFolder } from '../folders-store.js';
import { error, guard, json, readJson } from '../http.js';

export const prerender = false;

const MAX_ITEMS = 200;

export const POST: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const body = await readJson(context);
	if (!body || !Array.isArray(body.ids)) return error(400, 'Expected { ids, folderId }');
	const ids = [...new Set(body.ids.filter(isMediaId))];
	if (ids.length === 0 || ids.length > MAX_ITEMS) return error(400, `Move 1 to ${MAX_ITEMS} items at a time.`);
	try {
		const rows = await moveItems(ids, await targetFolder(body.folderId));
		return json({ items: rows.map(toItem) });
	} catch (cause) {
		if (cause instanceof FolderError) return error(cause.status, cause.message);
		console.error('[medialibrary] moving items failed', cause);
		return error(500, 'Moving the items failed');
	}
};

/**
 * /_media/api/folders (editors only, same origin for changes; ADR 0100)
 * - GET: every folder with its item count, plus the top level's count and the total.
 * - POST { name, parentId? }: create a folder (under `parentId`, default the top level).
 */
import type { APIRoute } from 'astro';
import { createFolder, FolderError, listFolders } from '../folders-store.js';
import { error, guard, json, readJson } from '../http.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	return json(await listFolders());
};

export const POST: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const body = await readJson(context);
	if (!body) return error(400, 'Expected a JSON object');
	try {
		return json({ folder: await createFolder({ name: body.name, parentId: body.parentId }) }, 201);
	} catch (cause) {
		if (cause instanceof FolderError) return error(cause.status, cause.message);
		console.error('[medialibrary] creating a folder failed', cause);
		return error(500, 'Creating the folder failed');
	}
};

/**
 * /_media/api/folders (editors only, same origin for changes; ADR 0100)
 * - GET ?kind=image,video: every folder with its item count, plus the top level's count and the
 *   total (only items of the listed kinds, when given).
 * - POST { name, parentId? }: create a folder (under `parentId`, default the top level).
 */
import type { APIRoute } from 'astro';
import { MEDIA_KINDS, type MediaKind } from '../../types.js';
import { createFolder, FolderError, listFolders } from '../folders-store.js';
import { error, guard, json, readJson } from '../http.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const kinds = (context.url.searchParams.get('kind') ?? '')
		.split(',')
		.filter((k): k is MediaKind => (MEDIA_KINDS as readonly string[]).includes(k));
	return json(await listFolders(kinds));
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

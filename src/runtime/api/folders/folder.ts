/**
 * /_media/api/folders/:id (editors only, same origin; ADR 0100)
 * - PATCH { name?, parentId? }: rename a folder and/or move it (`parentId: null` = the top
 *   level). Its directory on disk follows; file URLs don't change.
 * - DELETE: delete an empty folder (409 while it has items or folders in it).
 */
import type { APIRoute } from 'astro';
import { isFolderId } from '../../../folders.js';
import { changeFolder, deleteFolder, FolderError } from '../../folders-store.js';
import { error, guard, json, readJson } from '../../http.js';

export const prerender = false;

const failed = (cause: unknown, what: string) => {
	if (cause instanceof FolderError) return error(cause.status, cause.message);
	console.error(`[medialibrary] ${what} failed`, cause);
	return error(500, `${what[0]?.toUpperCase()}${what.slice(1)} failed`);
};

export const PATCH: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isFolderId(id)) return error(404, 'Not found');
	const body = await readJson(context);
	if (!body) return error(400, 'Expected a JSON object');
	const input: { name?: unknown; parentId?: unknown } = {};
	if ('name' in body) input.name = body.name;
	if ('parentId' in body) input.parentId = body.parentId;
	try {
		return json({ folder: await changeFolder(id, input) });
	} catch (cause) {
		return failed(cause, 'changing the folder');
	}
};

export const DELETE: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isFolderId(id)) return error(404, 'Not found');
	try {
		await deleteFolder(id);
		return new Response(null, { status: 204 });
	} catch (cause) {
		return failed(cause, 'deleting the folder');
	}
};

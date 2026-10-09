/**
 * /_media/api/items/:id (editors only)
 * - GET: the item and the pages that use it.
 * - PATCH { name?, alt?, tags?, focalPoint? }: rename, set alt text, tags (array) or the
 *   focal point of an image ({ x, y } in percent, or null for the center).
 * - DELETE (?force=1 to delete an item that's in use): delete the item and its file.
 */
import type { APIRoute } from 'astro';
import { encodeTags, normalizeFocalPoint, normalizeTags } from '../../meta.js';
import { isMediaId } from '../../types.js';
import { deleteRow, filesOf, getRow, type RowPatch, toItem, updateRow, usageOf } from '../db.js';
import { error, guard, json, readJson } from '../http.js';
import { removeFiles } from '../storage.js';

export const prerender = false;

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
const CONTROL = /[\u0000-\u001f\u007f]/g;

export const GET: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isMediaId(id)) return error(404, 'Not found');
	const row = await getRow(id);
	if (!row) return error(404, 'Not found');
	return json({ item: toItem(row), usage: await usageOf(id) });
};

export const PATCH: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isMediaId(id)) return error(404, 'Not found');
	const body = await readJson(context);
	if (!body) return error(400, 'Expected a JSON object');
	const row = await getRow(id);
	if (!row) return error(404, 'Not found');
	const patch: RowPatch = {};
	if (typeof body.name === 'string') {
		const name = body.name.replace(CONTROL, '').trim().slice(0, 200);
		if (!name) return error(400, 'The name cannot be empty');
		patch.name = name;
	}
	if (typeof body.alt === 'string') patch.alt = body.alt.replace(CONTROL, ' ').trim().slice(0, 1000);
	if ('tags' in body) {
		if (!Array.isArray(body.tags)) return error(400, 'Tags must be a list');
		patch.tags = encodeTags(normalizeTags(body.tags));
	}
	if ('focalPoint' in body) {
		if (row.kind !== 'image') return error(400, 'Only images have a focal point');
		const point = normalizeFocalPoint(body.focalPoint);
		if (body.focalPoint !== null && !point) return error(400, 'The focal point must be { x, y } from 0 to 100');
		patch.focalX = point?.x ?? null;
		patch.focalY = point?.y ?? null;
	}
	const updated = await updateRow(id, patch);
	return updated ? json({ item: toItem(updated) }) : error(404, 'Not found');
};

export const DELETE: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isMediaId(id)) return error(404, 'Not found');
	const row = await getRow(id);
	if (!row) return error(404, 'Not found');
	const usage = await usageOf(id);
	if (usage.length > 0 && context.url.searchParams.get('force') !== '1') {
		return json({ error: 'This media item is used on pages', usage }, 409);
	}
	await deleteRow(id);
	await removeFiles(filesOf(row));
	return new Response(null, { status: 204 });
};

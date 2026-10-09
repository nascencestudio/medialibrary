/**
 * DELETE /_media/api/items/:id/tracks/:trackId: remove a caption track and its
 * file. Editors only, same origin only.
 */
import type { APIRoute } from 'astro';
import { TRACK_ID } from '../../../stored.js';
import { isMediaId } from '../../../types.js';
import { getRow, toItem, tracksOf, updateRow } from '../../db.js';
import { error, guard, json } from '../../http.js';
import { removeFiles } from '../../storage.js';

export const prerender = false;

export const DELETE: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	const trackId = context.params.trackId ?? '';
	if (!isMediaId(id) || !TRACK_ID.test(trackId)) return error(404, 'Not found');
	const row = await getRow(id);
	if (!row) return error(404, 'Not found');
	const tracks = tracksOf(row);
	const track = tracks.find((t) => t.id === trackId);
	if (!track) return error(404, 'Not found');
	const updated = await updateRow(id, { tracks: JSON.stringify(tracks.filter((t) => t.id !== trackId)) });
	await removeFiles([track.storageKey]);
	return updated ? json({ item: toItem(updated) }) : error(404, 'Not found');
};

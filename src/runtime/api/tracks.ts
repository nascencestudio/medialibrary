/**
 * Caption and subtitle tracks of an uploaded video (editors only, same origin):
 * - POST /_media/api/items/:id/tracks?srclang=en&label=English&kind=subtitles
 *   with the raw .vtt or .srt file as the body and its name in `X-File-Name`.
 *   The file is cleaned (or converted) to WebVTT (subtitles.ts) and stored
 *   next to the video under a new key.
 * - DELETE /_media/api/items/:id/tracks/:trackId (tracks/[trackId].ts).
 */
import type { APIRoute } from 'astro';
import { keyToken, storageKeyFor } from '../../keys.js';
import { cleanLabel, type StoredTrack } from '../../stored.js';
import {
	cleanSubtitles,
	MAX_SUBTITLE_BYTES,
	MAX_TRACKS,
	normalizeLanguage,
	TRACK_KINDS,
	type TrackKind,
} from '../../subtitles.js';
import { isMediaId } from '../../types.js';
import { getRow, toItem, tracksOf, updateRow } from '../db.js';
import { BodyTooLargeError, error, guard, json, readBody } from '../http.js';
import { fileNameFrom } from '../receive.js';
import { removeFiles, writeFileAt } from '../storage.js';

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isMediaId(id)) return error(404, 'Not found');
	const row = await getRow(id);
	if (!row) return error(404, 'Not found');
	if (row.kind !== 'video') return error(400, 'Captions can only be added to uploaded videos.');

	const params = context.url.searchParams;
	const srclang = normalizeLanguage(params.get('srclang'));
	if (!srclang) return error(400, 'Enter a language code like "en" or "pt-BR".');
	const label = cleanLabel(params.get('label'));
	if (!label) return error(400, 'Enter a label, like "English".');
	const kind = (params.get('kind') ?? 'subtitles') as TrackKind;
	if (!TRACK_KINDS.includes(kind)) return error(400, 'Kind must be subtitles or captions.');
	const tracks = tracksOf(row);
	if (tracks.length >= MAX_TRACKS) return error(400, `A video can have at most ${MAX_TRACKS} caption tracks.`);

	const fileName = fileNameFrom(context);
	if (fileName instanceof Response) return fileName;
	let body: Uint8Array;
	try {
		body = await readBody(context, MAX_SUBTITLE_BYTES);
	} catch (cause) {
		if (cause instanceof BodyTooLargeError) return error(413, 'Caption files can be at most 2 MB.');
		throw cause;
	}
	const cleaned = cleanSubtitles(body, fileName);
	if (!cleaned.ok) return error(415, cleaned.reason);

	const track: StoredTrack = {
		id: `t_${keyToken(8)}`,
		kind,
		srclang,
		label,
		storageKey: storageKeyFor(id, 'vtt', new Date(), keyToken()),
	};
	await writeFileAt(track.storageKey, cleaned.vtt);
	try {
		const updated = await updateRow(id, { tracks: JSON.stringify([...tracks, track]) });
		if (!updated) throw new Error('item disappeared');
		return json({ item: toItem(updated) }, 201);
	} catch (cause) {
		await removeFiles([track.storageKey]);
		console.error('[medialibrary] adding captions failed', cause);
		return error(500, 'Adding captions failed');
	}
};

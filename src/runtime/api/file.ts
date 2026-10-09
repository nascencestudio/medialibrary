/**
 * POST /_media/api/items/:id/file: replace an item's file, keeping its id (so
 * every page that uses it shows the new file), alt text, tags, focal point and
 * captions. Same body and checks as an upload; the new file must be the same
 * kind. It gets a new storage key (files are cached as immutable, so the URL
 * must change); the old file and its resized copies are removed afterwards.
 * Editors only, same origin only.
 */
import type { APIRoute } from 'astro';
import { extensionOf } from '../../detect.js';
import { keyToken } from '../../keys.js';
import { isMediaId } from '../../types.js';
import { getRow, toItem, updateRow, variantsOf } from '../db.js';
import { error, guard, json } from '../http.js';
import { addVariants } from '../images.js';
import { receiveFile } from '../receive.js';
import { loadMediaSettings } from '../settings-store.js';
import { commit, discardTemp, removeFiles, storageKeyFor } from '../storage.js';

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const id = context.params.id ?? '';
	if (!isMediaId(id)) return error(404, 'Not found');
	const row = await getRow(id);
	if (!row) return error(404, 'Not found');
	if (row.kind === 'remoteVideo' || !row.storageKey) return error(400, 'Remote videos have no file to replace.');

	const file = await receiveFile(context, await loadMediaSettings(), row.kind);
	if (file instanceof Response) return file;
	try {
		const storageKey = storageKeyFor(id, file.ext, keyToken());
		await commit(file.temp, row.folderId ?? null, storageKey);
		// A name that is still the old file's name follows the new file; a chosen name stays.
		const oldExt = extensionOf(row.name);
		const name =
			oldExt && oldExt === row.storageKey.slice(row.storageKey.lastIndexOf('.') + 1) ? file.fileName : row.name;
		const updated = await updateRow(id, {
			storageKey,
			name,
			mime: file.mime,
			size: file.size,
			width: file.width,
			height: file.height,
			variants: '[]',
		});
		await removeFiles(row.folderId ?? null, [row.storageKey, ...variantsOf(row).map((v) => v.storageKey)]);
		if (updated) await addVariants(updated);
		const fresh = await getRow(id);
		return fresh ? json({ item: toItem(fresh) }) : error(404, 'Not found');
	} catch (cause) {
		console.error('[medialibrary] replacing file failed', cause);
		return error(500, 'Replacing the file failed');
	} finally {
		await discardTemp(file.temp);
	}
};

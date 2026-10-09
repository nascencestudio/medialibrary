/**
 * POST /_media/api/upload?folder=f_…: upload one file (into a folder; default the top level). The body is the raw file
 * (streamed to disk, never buffered whole); the file name comes in the
 * `X-File-Name` header (URI-encoded). Editors only, same origin only.
 *
 * Checks (receive.ts): the type is detected from the file's contents and must
 * match its name; each kind has its own size limit; SVGs are sanitized. Limits
 * and the SVG switch come from the admin settings (settings-store.ts). Images
 * get resized copies (images.ts).
 */
import type { APIRoute } from 'astro';
import { newMediaId } from '../../types.js';
import { getRow, insertRow, type MediaRow, toItem } from '../db.js';
import { FolderError, targetFolder } from '../folders-store.js';
import { error, guard, json } from '../http.js';
import { addVariants } from '../images.js';
import { receiveFile } from '../receive.js';
import { loadMediaSettings } from '../settings-store.js';
import { commit, discardTemp, storageKeyFor } from '../storage.js';

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	let folderId: string | null;
	try {
		folderId = await targetFolder(context.url.searchParams.get('folder'));
	} catch (cause) {
		if (cause instanceof FolderError) return error(cause.status, cause.message);
		throw cause;
	}
	const file = await receiveFile(context, await loadMediaSettings());
	if (file instanceof Response) return file;

	try {
		const id = newMediaId();
		const now = new Date();
		const storageKey = storageKeyFor(id, file.ext);
		await commit(file.temp, folderId, storageKey);
		const row: MediaRow = {
			id,
			kind: file.kind,
			name: file.fileName,
			alt: '',
			mime: file.mime,
			size: file.size,
			width: file.width,
			height: file.height,
			storageKey,
			provider: null,
			providerId: null,
			thumbnailUrl: null,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			createdBy: viewer.name,
			tags: '',
			focalX: null,
			focalY: null,
			tracks: '[]',
			variants: '[]',
			folderId,
		};
		await insertRow(row);
		await addVariants(row);
		return json({ item: toItem((await getRow(id)) ?? row) }, 201);
	} catch (cause) {
		console.error('[medialibrary] storing upload failed', cause);
		return error(500, 'Storing the file failed');
	} finally {
		await discardTemp(file.temp); // no-op after a successful commit (the file was moved)
	}
};

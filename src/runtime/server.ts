/**
 * Server API for other plugins and site code (`@nascencestudio/medialibrary/server`):
 * look media items up by id, e.g. to render a component's image.
 */
import { isMediaId, type MediaItem } from '../types.js';
import { getRow, getRows, toItem } from './db.js';

export type { MediaItem } from '../types.js';

/** One media item, or null if the id is invalid or the item was deleted. */
export async function getMediaItem(id: unknown): Promise<MediaItem | null> {
	if (!isMediaId(id)) return null;
	const row = await getRow(id);
	return row ? toItem(row) : null;
}

/** Several media items by id (invalid and deleted ids are left out). */
export async function getMediaItems(ids: readonly unknown[]): Promise<Map<string, MediaItem>> {
	const valid = [...new Set(ids.filter(isMediaId))];
	const rows = await getRows(valid);
	return new Map(rows.map((row) => [row.id, toItem(row)]));
}

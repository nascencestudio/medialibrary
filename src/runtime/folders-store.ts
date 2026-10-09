/**
 * Folders and moving items between them (ADR 0100). The database is the source of
 * truth and changes first; the disk follows (a directory rename, or file moves). If
 * the disk step fails or is interrupted, the disk sync (sync.ts) puts files where the
 * database says, then and on the next start. Every change runs through the
 * structural lock (lock.ts). Server only.
 */
import { mkdir, rmdir } from 'node:fs/promises';
import { dirPath, filePath, locate, moveFile, renameDir } from '../disk.js';
import {
	chainOf,
	childrenOf,
	cleanFolderName,
	dirOf,
	type FolderMap,
	isFolderId,
	MAX_FOLDERS,
	nameKey,
	newFolderId,
	placementProblem,
	slugFor,
	uniqueSlug,
} from '../folders.js';
import type { MediaFolder, MediaKind } from '../types.js';
import {
	countByFolder,
	deleteFolderRow,
	type FolderRow,
	filesOf,
	getRows,
	insertFolderRow,
	listFolderRows,
	type MediaRow,
	updateFolderRow,
	updateRow,
} from './db.js';
import { withLock } from './lock.js';

export class FolderError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

let cache: Promise<Map<string, FolderRow>> | null = null;

/** Every folder by id (cached until a folder changes). */
export function loadFolders(): Promise<Map<string, FolderRow>> {
	cache ??= listFolderRows()
		.then((rows) => new Map(rows.map((row) => [row.id, row])))
		.catch((cause) => {
			cache = null;
			throw cause;
		});
	return cache;
}

const invalidate = () => {
	cache = null;
};

/** Directory names of a folder ([] for the top level, and for a folder that's gone or broken). */
export async function folderDir(folderId: string | null): Promise<string[]> {
	if (folderId === null) return [];
	return dirOf(folderId, await loadFolders()) ?? [];
}

const storageRoot = async () => (await import('./storage.js')).storageRoot();

const toFolder = (row: FolderRow, counts: Map<string, number>): MediaFolder => ({
	id: row.id,
	parentId: row.parentId,
	name: row.name,
	slug: row.slug,
	itemCount: counts.get(row.id) ?? 0,
});

/**
 * Every folder with its item count, plus the top level's count and the total. With `kinds`,
 * only items of those kinds are counted (the picker counts what a field can use).
 */
export async function listFolders(
	kinds?: readonly MediaKind[],
): Promise<{ folders: MediaFolder[]; topLevelCount: number; total: number }> {
	const [folders, counts] = await Promise.all([loadFolders(), countByFolder(kinds)]);
	const sorted = [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	return {
		folders: sorted.map((row) => toFolder(row, counts)),
		topLevelCount: counts.get('') ?? 0,
		total: [...counts.values()].reduce((sum, n) => sum + n, 0),
	};
}

function parentFrom(value: unknown, folders: FolderMap): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (!isFolderId(value) || !folders.has(value)) throw new FolderError(404, 'The target folder no longer exists.');
	return value;
}

/** Siblings under `parentId`, other than `exceptId`. */
const siblings = (parentId: string | null, folders: FolderMap, exceptId?: string) =>
	childrenOf(parentId, folders).filter((f) => f.id !== exceptId);

function checkName(name: string, parentId: string | null, folders: FolderMap, exceptId?: string): void {
	if (!name) throw new FolderError(400, 'Enter a folder name.');
	if (siblings(parentId, folders, exceptId).some((f) => nameKey(f.name) === nameKey(name))) {
		throw new FolderError(409, `There's already a folder called "${name}" here.`);
	}
}

export function createFolder(input: { name: unknown; parentId: unknown }): Promise<MediaFolder> {
	return withLock(async () => {
		const folders = await loadFolders();
		if (folders.size >= MAX_FOLDERS) throw new FolderError(400, `A library can have at most ${MAX_FOLDERS} folders.`);
		const parentId = parentFrom(input.parentId, folders);
		const problem = placementProblem(null, parentId, folders);
		if (problem) throw new FolderError(400, problem);
		const name = cleanFolderName(input.name);
		checkName(name, parentId, folders);
		const now = new Date().toISOString();
		const row: FolderRow = {
			id: newFolderId(),
			parentId,
			name,
			slug: uniqueSlug(slugFor(name), new Set(siblings(parentId, folders).map((f) => f.slug))),
			createdAt: now,
			updatedAt: now,
		};
		await insertFolderRow(row);
		invalidate();
		const dir = dirOf(row.id, await loadFolders());
		if (dir) await mkdir(dirPath(await storageRoot(), dir), { recursive: true }).catch(() => {});
		return toFolder(row, new Map());
	});
}

/** Rename a folder and/or move it under another parent (`parentId: null` = the top level). */
export function changeFolder(id: string, input: { name?: unknown; parentId?: unknown }): Promise<MediaFolder> {
	return withLock(async () => {
		const folders = await loadFolders();
		const folder = folders.get(id);
		if (!folder) throw new FolderError(404, 'Not found');
		const parentId = 'parentId' in input ? parentFrom(input.parentId, folders) : folder.parentId;
		const name = 'name' in input ? cleanFolderName(input.name) : folder.name;
		if (parentId !== folder.parentId) {
			const problem = placementProblem(id, parentId, folders);
			if (problem) throw new FolderError(400, problem);
		}
		checkName(name, parentId, folders, id);
		const renamed = nameKey(name) !== nameKey(folder.name) || slugFor(name) !== slugFor(folder.name);
		const slug =
			renamed || parentId !== folder.parentId
				? uniqueSlug(renamed ? slugFor(name) : folder.slug, new Set(siblings(parentId, folders, id).map((f) => f.slug)))
				: folder.slug;
		const oldDir = dirOf(id, folders);
		await updateFolderRow(id, { name, slug, parentId });
		invalidate();
		const fresh = await loadFolders();
		const newDir = dirOf(id, fresh);
		if (oldDir && newDir && oldDir.join('/') !== newDir.join('/')) {
			const root = await storageRoot();
			const moved = await renameDir(root, oldDir, newDir).catch((cause) => {
				console.warn('[medialibrary] renaming a folder directory failed; syncing files instead', cause);
				return false;
			});
			if (!moved) await (await import('./sync.js')).syncUnlocked();
		}
		const counts = await countByFolder();
		return toFolder(fresh.get(id) as FolderRow, counts);
	});
}

/** Delete an empty folder (no items, no subfolders). */
export function deleteFolder(id: string): Promise<void> {
	return withLock(async () => {
		const folders = await loadFolders();
		if (!folders.has(id)) throw new FolderError(404, 'Not found');
		if (childrenOf(id, folders).length > 0) {
			throw new FolderError(409, 'This folder has folders in it. Move or delete them first.');
		}
		if ((await countByFolder()).get(id)) {
			throw new FolderError(409, 'This folder has media in it. Move or delete the items first.');
		}
		const dir = dirOf(id, folders);
		await deleteFolderRow(id);
		invalidate();
		// Only an empty directory is removed: anything else someone put there stays.
		if (dir) await rmdir(dirPath(await storageRoot(), dir)).catch(() => {});
	});
}

/** Move items into a folder (null: the top level). Returns the updated rows. */
export function moveItems(ids: readonly string[], folderId: string | null): Promise<MediaRow[]> {
	return withLock(async () => {
		const folders = await loadFolders();
		if (folderId !== null && !chainOf(folderId, folders))
			throw new FolderError(404, 'The target folder no longer exists.');
		const target = dirOf(folderId, folders) ?? [];
		const root = await storageRoot();
		let needsSync = false;
		const updated: MediaRow[] = [];
		for (const row of await getRows(ids)) {
			if ((row.folderId ?? null) === folderId) {
				updated.push(row);
				continue;
			}
			const from = dirOf(row.folderId ?? null, folders) ?? [];
			const fresh = await updateRow(row.id, { folderId });
			if (fresh) updated.push(fresh);
			for (const key of filesOf(row)) {
				try {
					const source = await locate(root, from, key);
					if (source) await moveFile(root, source, filePath(root, target, key));
					else needsSync = true;
				} catch (cause) {
					console.warn('[medialibrary] moving a file failed; syncing files instead', key, cause);
					needsSync = true;
				}
			}
		}
		if (needsSync) await (await import('./sync.js')).syncUnlocked();
		return updated;
	});
}

/** The folder a new item goes into: a request's `folder` value ('' or absent: the top level). */
export async function targetFolder(value: unknown): Promise<string | null> {
	if (value === null || value === undefined || value === '') return null;
	if (!isFolderId(value) || !chainOf(value, await loadFolders())) {
		throw new FolderError(404, 'That folder no longer exists. Reload the page.');
	}
	return value;
}

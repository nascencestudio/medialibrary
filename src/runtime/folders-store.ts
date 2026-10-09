/**
 * Folders and moving items between them (ADR 0100). The database is the source of
 * truth and changes first; the disk follows (a directory rename, or file moves). If
 * the disk step fails or is interrupted, the disk sync (sync.ts) puts files where the
 * database says, then and on the next start. Every change runs through the
 * structural lock (lock.ts). Server only.
 */
import { mkdir, rm, rmdir } from 'node:fs/promises';
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
	subtreeOf,
	uniqueSlug,
} from '../folders.js';
import type { MediaFolder, MediaKind } from '../types.js';
import {
	countByFolder,
	deleteFolderRows,
	deleteRows,
	type FolderRow,
	filesOf,
	getRows,
	insertFolderRow,
	listFolderRows,
	type MediaRow,
	rowsInFolders,
	type Usage,
	updateFolderRow,
	updateRow,
	usageByItem,
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

export interface FolderContents {
	/** Folders below it (not counting itself). */
	folders: number;
	/** Items in it and in every folder below it. */
	items: number;
	/** How many of those items are used on pages. */
	inUse: number;
	/** The pages using them (at most 20). */
	pages: Usage[];
	/** More pages than listed. */
	morePages: boolean;
}

/** What deleting a folder would delete, and which pages would lose media (for the confirmation). */
export async function folderContents(id: string): Promise<FolderContents> {
	const folders = await loadFolders();
	if (!folders.has(id)) throw new FolderError(404, 'Not found');
	const subtree = subtreeOf(id, folders);
	const rows = await rowsInFolders([...subtree]);
	const usage = await usageByItem(rows.map((row) => row.id));
	const pages = new Map<string, Usage>();
	for (const list of usage.values()) for (const page of list) pages.set(page.pageId, page);
	return {
		folders: subtree.size - 1,
		items: rows.length,
		inUse: usage.size,
		pages: [...pages.values()].slice(0, 20),
		morePages: pages.size > 20,
	};
}

/**
 * Delete a folder with everything in it: its subfolders, their items and the items' files,
 * like a file manager. A folder with anything in it needs `confirm` to be its name
 * (case-insensitive), the same check the dialog makes, so only a deliberate request deletes
 * contents. Database first, then the disk; directories are removed only once empty (files
 * someone else put there stay).
 */
export function deleteFolder(id: string, confirm?: unknown): Promise<{ folders: number; items: number }> {
	return withLock(async () => {
		const folders = await loadFolders();
		const folder = folders.get(id);
		if (!folder) throw new FolderError(404, 'Not found');
		const subtree = subtreeOf(id, folders);
		const rows = await rowsInFolders([...subtree]);
		const hasContents = rows.length > 0 || subtree.size > 1;
		if (hasContents && nameKey(cleanFolderName(confirm)) !== nameKey(folder.name)) {
			throw new FolderError(409, `Type the folder's name to delete it and everything in it.`);
		}
		// Where everything is, before the folders are gone.
		const root = await storageRoot();
		const files = rows.flatMap((row) =>
			filesOf(row).map((key) => ({ dir: dirOf(row.folderId ?? null, folders) ?? [], key })),
		);
		const dirs = [...subtree]
			.map((folderId) => dirOf(folderId, folders))
			.filter((d): d is string[] => d !== null)
			.sort((a, b) => b.length - a.length); // deepest first
		await deleteRows(rows.map((row) => row.id));
		await deleteFolderRows([...subtree]);
		invalidate();
		for (const { dir, key } of files) {
			try {
				const path = await locate(root, dir, key);
				if (path) await rm(path, { force: true });
			} catch (cause) {
				console.warn('[medialibrary] could not remove file', key, cause);
			}
		}
		for (const dir of dirs) await rmdir(dirPath(root, dir)).catch(() => {});
		return { folders: subtree.size, items: rows.length };
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

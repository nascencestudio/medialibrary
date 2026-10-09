/**
 * The storage directory's layout (ADR 0100): a stored file lives at
 * `<root>/<folder dirs…>/<file name>`, where the directories mirror the item's
 * folder. Temporary uploads live in `<root>/.tmp` (directory names never start
 * with a dot). Every path is built from validated parts and checked to stay inside
 * the root. Server only; the root is passed in, so this can be tested on its own.
 */
import { mkdir, readdir, rename, rmdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isSlug, MAX_DEPTH } from './folders.js';
import { FILE_NAME, fileNameOf, isLegacyKey, isStorageKey } from './keys.js';

export const TEMP_DIR = '.tmp';

function inside(root: string, path: string): string {
	const base = resolve(root);
	const full = resolve(base, path);
	if (full !== base && !full.startsWith(base + sep)) throw new Error('path escapes the storage directory');
	return full;
}

/** The absolute directory of a folder path (directory names). */
export function dirPath(root: string, dir: readonly string[]): string {
	if (dir.length > MAX_DEPTH || !dir.every(isSlug)) throw new Error(`invalid folder path ${dir.join('/')}`);
	return inside(root, dir.join('/'));
}

/** Where a key's file belongs: in the folder's directory, under its file name. */
export function filePath(root: string, dir: readonly string[], key: string): string {
	if (!isStorageKey(key)) throw new Error(`invalid storage key ${key}`);
	return join(dirPath(root, dir), fileNameOf(key));
}

/** Where a key stored before folders (`YYYY/MM/<file name>`) put its file; null for plain file names. */
export function legacyPath(root: string, key: string): string | null {
	return isLegacyKey(key) ? inside(root, key) : null;
}

export async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** The existing file of a key: where it belongs, else where a pre-folders key put it; null if neither. */
export async function locate(root: string, dir: readonly string[], key: string): Promise<string | null> {
	const expected = filePath(root, dir, key);
	if (await isFile(expected)) return expected;
	const legacy = legacyPath(root, key);
	return legacy && (await isFile(legacy)) ? legacy : null;
}

/** Move a file within the storage directory (creating the target directory). Never overwrites. */
export async function moveFile(root: string, from: string, to: string): Promise<void> {
	inside(root, from);
	inside(root, to);
	if (from === to) return;
	if (await isFile(to)) throw new Error(`a file already exists at ${relative(root, to)}`);
	await mkdir(dirname(to), { recursive: true });
	await rename(from, to);
}

/**
 * Every stored file under the root, by file name (directories walked at most
 * MAX_DEPTH + 2 deep, so pre-folder `YYYY/MM` directories are covered; `.tmp` and
 * anything that isn't a stored file name are skipped). Used to find files that
 * aren't where their folder says, e.g. after an interrupted move.
 */
export async function findStoredFiles(root: string): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const walk = async (dir: string, depth: number) => {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.')) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (depth < MAX_DEPTH + 2) await walk(path, depth + 1);
			} else if (entry.isFile() && FILE_NAME.test(entry.name) && !found.has(entry.name)) {
				found.set(entry.name, path);
			}
		}
	};
	await walk(resolve(root), 0);
	return found;
}

/** Create the directory of every folder (empty folders exist on disk too). */
export async function ensureDirs(root: string, dirs: Iterable<readonly string[]>): Promise<void> {
	for (const dir of dirs) await mkdir(dirPath(root, dir), { recursive: true });
}

/**
 * Remove empty directories that aren't a folder's directory (`keep`, relative paths
 * like `photos/team`), deepest first. Never the root or `.tmp`; never a directory
 * with anything in it.
 */
export async function removeEmptyDirs(root: string, keep: ReadonlySet<string>): Promise<number> {
	const base = resolve(root);
	let removed = 0;
	const walk = async (dir: string, depth: number): Promise<boolean> => {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return false;
		}
		let empty = true;
		for (const entry of entries) {
			if (entry.isDirectory() && !entry.name.startsWith('.') && depth < MAX_DEPTH + 2) {
				if (!(await walk(join(dir, entry.name), depth + 1))) empty = false;
			} else {
				empty = false;
			}
		}
		if (dir === base || !empty || keep.has(relative(base, dir).split(sep).join('/'))) return false;
		try {
			await rmdir(dir);
			removed += 1;
			return true;
		} catch {
			return false;
		}
	};
	await walk(base, 0);
	return removed;
}

/** Rename a folder's directory. Returns false when there was nothing to rename or the target exists. */
export async function renameDir(root: string, from: readonly string[], to: readonly string[]): Promise<boolean> {
	const source = dirPath(root, from);
	const target = dirPath(root, to);
	if (source === target) return true;
	try {
		if (!(await stat(source)).isDirectory()) return false;
	} catch {
		return false;
	}
	try {
		await stat(target);
		return false; // something is already there: let the per-file sync handle it
	} catch {
		// free
	}
	await mkdir(dirname(target), { recursive: true });
	await rename(source, target);
	return true;
}

export interface SyncItem {
	id: string;
	/** Directory names of the item's folder. */
	dir: readonly string[];
	/** Every stored key of the item (main file, resized copies, caption files). */
	keys: readonly string[];
}

export interface SyncResult {
	/** Files moved into place. */
	moved: number;
	/** File names found nowhere. */
	missing: string[];
	/** Items whose files are all where their folder says. */
	settled: Set<string>;
	/** Empty directories removed (not a folder's: e.g. the old `YYYY/MM` ones). */
	removedDirs: number;
}

/**
 * Make the disk match the library: every folder has its directory, and every stored
 * file is in its item's folder directory. A file that isn't there is looked for
 * where a pre-folders key put it, then anywhere under the root by its (unique) file
 * name, and moved. Then empty directories that aren't folders are removed.
 * The database is the source of truth; this never changes it.
 */
export async function syncFiles(
	root: string,
	items: readonly SyncItem[],
	folderDirs: readonly (readonly string[])[],
): Promise<SyncResult> {
	await ensureDirs(root, folderDirs);
	let moved = 0;
	const missing: string[] = [];
	const settled = new Set<string>();
	const pending: Array<{ item: SyncItem; key: string; target: string }> = [];
	for (const item of items) {
		let ok = true;
		for (const key of item.keys) {
			const target = filePath(root, item.dir, key);
			if (await isFile(target)) continue;
			const legacy = legacyPath(root, key);
			if (legacy && (await isFile(legacy))) {
				await moveFile(root, legacy, target);
				moved += 1;
				continue;
			}
			pending.push({ item, key, target });
			ok = false;
		}
		if (ok) settled.add(item.id);
	}
	if (pending.length > 0) {
		const found = await findStoredFiles(root);
		const stillMissing = new Set<string>();
		for (const { item, key, target } of pending) {
			const source = found.get(fileNameOf(key));
			if (source && source !== target) {
				await moveFile(root, source, target);
				moved += 1;
			} else if (!source) {
				missing.push(fileNameOf(key));
				stillMissing.add(item.id);
			}
		}
		for (const { item } of pending) if (!stillMissing.has(item.id)) settled.add(item.id);
	}
	const removedDirs = await removeEmptyDirs(root, new Set(folderDirs.map((d) => d.join('/'))));
	return { moved, missing, settled, removedDirs };
}

/**
 * Keeping the disk in step with the library (ADR 0100): files go to their item's
 * folder directory, folders get their directories, and keys stored before folders
 * (`YYYY/MM/<file name>`) become plain file names once their files are in place.
 * Runs once per process at startup (in the background), after a folder change whose
 * directory rename failed, and when a requested file isn't where it should be
 * (at most once a minute, so requests for a missing file can't make the server scan
 * the disk over and over). The work is disk.ts's `syncFiles`. Server only.
 */

import { syncFiles } from '../disk.js';
import { dirOf } from '../folders.js';
import { fileNameOf, isLegacyKey } from '../keys.js';
import { parseTracks, parseVariants } from '../stored.js';
import { rowsWithFiles, setRowFiles } from './db.js';
import { loadFolders } from './folders-store.js';
import { withLock } from './lock.js';
import { storageRoot } from './storage.js';

const MISS_INTERVAL_MS = 60_000;

let running: Promise<boolean> | null = null;
let lastRun = 0;
let started = false;

const keysOf = (row: { storageKey: string | null; variants: string; tracks: string }) => [
	...(row.storageKey ? [row.storageKey] : []),
	...parseVariants(row.variants).map((v) => v.storageKey),
	...parseTracks(row.tracks).map((t) => t.storageKey),
];

/** Sync now; callers must already hold the structural lock. Returns whether every file was found. */
export async function syncUnlocked(): Promise<boolean> {
	lastRun = Date.now();
	const folders = await loadFolders();
	const folderDirs = [...folders.keys()].map((id) => dirOf(id, folders)).filter((d): d is string[] => d !== null);
	const rows = await rowsWithFiles();
	const result = await syncFiles(
		storageRoot(),
		rows.map((row) => ({ id: row.id, dir: dirOf(row.folderId ?? null, folders) ?? [], keys: keysOf(row) })),
		folderDirs,
	);
	let rewritten = 0;
	for (const row of rows) {
		if (!result.settled.has(row.id) || !keysOf(row).some(isLegacyKey)) continue;
		await setRowFiles(row.id, {
			storageKey: row.storageKey ? fileNameOf(row.storageKey) : null,
			variants: JSON.stringify(
				parseVariants(row.variants).map((v) => ({ ...v, storageKey: fileNameOf(v.storageKey) })),
			),
			tracks: JSON.stringify(parseTracks(row.tracks).map((t) => ({ ...t, storageKey: fileNameOf(t.storageKey) }))),
		});
		rewritten += 1;
	}
	if (result.moved || result.missing.length || rewritten || result.removedDirs) {
		console.info(
			`[medialibrary] files synced with folders: ${result.moved} moved, ${rewritten} items updated, ` +
				`${result.removedDirs} empty directories removed${result.missing.length ? `, ${result.missing.length} missing (${result.missing.slice(0, 5).join(', ')}${result.missing.length > 5 ? '…' : ''})` : ''}`,
		);
	}
	return result.missing.length === 0;
}

/** Sync (one run at a time; concurrent callers share it). */
export function syncNow(): Promise<boolean> {
	running ??= withLock(syncUnlocked).finally(() => {
		running = null;
	});
	return running;
}

/** The startup sync: once per process, in the background. */
export function startupSync(): void {
	if (started) return;
	started = true;
	syncNow().catch((cause) => console.warn('[medialibrary] syncing files with folders failed', cause));
}

/**
 * After a file wasn't found where it belongs: sync, unless a sync ran within the last
 * minute (then only wait for one that's running). Returns whether it's worth looking again.
 */
export async function syncAfterMiss(): Promise<boolean> {
	if (running) {
		await running.catch(() => false);
		return true;
	}
	if (Date.now() - lastRun < MISS_INTERVAL_MS) return false;
	await syncNow().catch((cause) => console.warn('[medialibrary] syncing files with folders failed', cause));
	return true;
}

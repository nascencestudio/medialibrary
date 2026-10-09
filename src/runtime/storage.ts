/// <reference path="../virtual.d.ts" />
/**
 * Local-disk storage for uploads: files are streamed to a temporary file
 * (never buffered whole in memory), checked, then moved into place: the
 * directory of the item's folder (ADR 0100; disk.ts has the layout). The root
 * is `MEDIA_DIR` or the configured `storageDir`. Server only.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import config from 'virtual:medialibrary/config';
import { filePath, locate, TEMP_DIR } from '../disk.js';
import { folderDir } from './folders-store.js';

export { storageKeyFor } from '../keys.js';

export const storageRoot = () => resolve(process.env.MEDIA_DIR || config.storageDir);

/** Where a key of an item in `folderId` belongs (whether or not the file is there yet). */
export async function targetPath(folderId: string | null, key: string): Promise<string> {
	return filePath(storageRoot(), await folderDir(folderId), key);
}

/**
 * The existing file of an item's key, or null. A file that isn't where its folder
 * says (an interrupted move, a pre-folders key) triggers a sync of the disk first
 * (sync.ts; throttled), then is looked up again.
 */
export async function locateFile(folderId: string | null, key: string): Promise<string | null> {
	const root = storageRoot();
	const found = await locate(root, await folderDir(folderId), key);
	if (found) return found;
	const { syncAfterMiss } = await import('./sync.js');
	if (!(await syncAfterMiss())) return null;
	return locate(root, await folderDir(folderId), key);
}

export class TooLargeError extends Error {}

export interface TempFile {
	path: string;
	size: number;
	/** The first bytes (up to 64 KB), for type detection. */
	head: Uint8Array;
}

/** Stream a request body to a temporary file, stopping once it exceeds `max` bytes. */
export async function writeTemp(body: ReadableStream<Uint8Array>, max: number): Promise<TempFile> {
	const dir = join(storageRoot(), TEMP_DIR);
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${crypto.randomUUID()}.part`);
	let size = 0;
	const headChunks: Uint8Array[] = [];
	let headSize = 0;
	const counter = async function* (source: AsyncIterable<Uint8Array>) {
		for await (const chunk of source) {
			size += chunk.byteLength;
			if (size > max) throw new TooLargeError(`larger than ${max} bytes`);
			if (headSize < 65_536) {
				headChunks.push(chunk.subarray(0, 65_536 - headSize));
				headSize += Math.min(chunk.byteLength, 65_536 - headSize);
			}
			yield chunk;
		}
	};
	try {
		await pipeline(
			Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>),
			counter,
			createWriteStream(path, { flags: 'wx', mode: 0o640 }),
		);
	} catch (cause) {
		await rm(path, { force: true });
		throw cause;
	}
	const head = new Uint8Array(headSize);
	let offset = 0;
	for (const chunk of headChunks) {
		head.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { path, size, head };
}

export const readTempText = (temp: TempFile) => readFile(temp.path, 'utf8');

export async function replaceTempContent(temp: TempFile, content: string): Promise<number> {
	await writeFile(temp.path, content, { encoding: 'utf8', mode: 0o640 });
	return Buffer.byteLength(content);
}

export const discardTemp = (temp: TempFile) => rm(temp.path, { force: true });

/** Move a checked temporary file into an item's folder. */
export async function commit(temp: TempFile, folderId: string | null, key: string): Promise<void> {
	const target = await targetPath(folderId, key);
	await mkdir(dirname(target), { recursive: true });
	await rename(temp.path, target);
}

/** Write a generated file (a resized image, a caption file) into an item's folder. Never overwrites. */
export async function writeFileAt(folderId: string | null, key: string, data: Uint8Array | string): Promise<number> {
	const target = await targetPath(folderId, key);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, data, { flag: 'wx', mode: 0o640 });
	return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}

/** Remove an item's files, logging (not throwing) failures: used after the database already changed. */
export async function removeFiles(folderId: string | null, keys: readonly string[]): Promise<void> {
	for (const key of keys) {
		try {
			const path = await locateFile(folderId, key);
			if (path) await rm(path, { force: true });
		} catch (cause) {
			console.warn('[medialibrary] could not remove file', key, cause);
		}
	}
}

export async function fileInfo(path: string): Promise<{ size: number; mtime: Date } | null> {
	try {
		const info = await stat(path);
		return info.isFile() ? { size: info.size, mtime: info.mtime } : null;
	} catch {
		return null;
	}
}

/** A readable web stream of a file, optionally a byte range (inclusive). */
export function readStream(path: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
	const stream = createReadStream(path, range ? { start: range.start, end: range.end } : undefined);
	return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

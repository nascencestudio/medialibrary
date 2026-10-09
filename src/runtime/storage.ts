/// <reference path="../virtual.d.ts" />
/**
 * Local-disk storage for uploads: files are streamed to a temporary file
 * (never buffered whole in memory), checked, then moved into place under
 * `YYYY/MM/<id>.<ext>`. The directory is `MEDIA_DIR` or the configured
 * `storageDir`. Server only.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import config from 'virtual:medialibrary/config';
import { STORAGE_KEY } from '../keys.js';

export { STORAGE_KEY, storageKeyFor } from '../keys.js';

export const storageRoot = () => resolve(process.env.MEDIA_DIR || config.storageDir);

/** Absolute path of a key, refusing anything that could leave the storage directory. */
export function pathFor(key: string): string {
	if (!STORAGE_KEY.test(key)) throw new Error(`invalid storage key ${key}`);
	const root = storageRoot();
	const path = resolve(root, key);
	if (!path.startsWith(root + sep)) throw new Error('storage key escapes the storage directory');
	return path;
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
	const dir = join(storageRoot(), '.tmp');
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

/** Move a checked temporary file to its final key. */
export async function commit(temp: TempFile, key: string): Promise<void> {
	const target = pathFor(key);
	await mkdir(dirname(target), { recursive: true });
	await rename(temp.path, target);
}

/** Write a generated file (a resized image, a caption file) at a new key. Never overwrites. */
export async function writeFileAt(key: string, data: Uint8Array | string): Promise<number> {
	const target = pathFor(key);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, data, { flag: 'wx', mode: 0o640 });
	return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}

/** Remove files, logging (not throwing) failures: used after the database already changed. */
export async function removeFiles(keys: readonly string[]): Promise<void> {
	for (const key of keys) {
		await removeFile(key).catch((cause) => console.warn('[medialibrary] could not remove file', key, cause));
	}
}

export async function removeFile(key: string): Promise<void> {
	await rm(pathFor(key), { force: true });
}

export async function fileInfo(key: string): Promise<{ size: number; mtime: Date } | null> {
	try {
		const info = await stat(pathFor(key));
		return info.isFile() ? { size: info.size, mtime: info.mtime } : null;
	} catch {
		return null;
	}
}

/** A readable web stream of a file, optionally a byte range (inclusive). */
export function readStream(key: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
	const stream = createReadStream(pathFor(key), range ? { start: range.start, end: range.end } : undefined);
	return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

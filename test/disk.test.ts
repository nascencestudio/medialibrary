import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	dirPath,
	filePath,
	findStoredFiles,
	legacyPath,
	locate,
	moveFile,
	removeEmptyDirs,
	renameDir,
	syncFiles,
} from '../src/disk.js';

const A = 'm_aaaaaaaaaaaaaaaa';
const B = 'm_bbbbbbbbbbbbbbbb';
let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'medialibrary-disk-'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const put = async (path: string, content = 'x') => {
	await mkdir(join(root, path, '..'), { recursive: true });
	await writeFile(join(root, path), content);
};
const exists = async (path: string) =>
	readFile(join(root, path)).then(
		() => true,
		() => false,
	);

describe('paths', () => {
	it('mirror folders', () => {
		expect(filePath(root, [], `${A}.jpg`)).toBe(join(root, `${A}.jpg`));
		expect(filePath(root, ['photos', 'team'], `${A}.jpg`)).toBe(join(root, 'photos/team', `${A}.jpg`));
		// A pre-folders key is placed by its file name.
		expect(filePath(root, ['photos'], `2026/03/${A}.jpg`)).toBe(join(root, 'photos', `${A}.jpg`));
		expect(legacyPath(root, `2026/03/${A}.jpg`)).toBe(join(root, '2026/03', `${A}.jpg`));
		expect(legacyPath(root, `${A}.jpg`)).toBeNull();
	});

	it.each([[['..']], [['.tmp']], [['a/b']], [['Photos']], [['']], [['ok', '..']], [Array(9).fill('a')]])(
		'refuse folder path %j',
		(dir) => {
			expect(() => dirPath(root, dir)).toThrow();
		},
	);

	it.each(['../x.jpg', `${A}.jpg/../../x`, '/etc/passwd', `photos/${A}.jpg`, 'x.jpg'])('refuse key %j', (key) => {
		expect(() => filePath(root, [], key)).toThrow();
	});

	it('locate files where they belong, else where a pre-folders key put them', async () => {
		await put(`photos/${A}.jpg`);
		await put(`2026/03/${B}.png`);
		expect(await locate(root, ['photos'], `${A}.jpg`)).toBe(join(root, 'photos', `${A}.jpg`));
		expect(await locate(root, [], `2026/03/${B}.png`)).toBe(join(root, '2026/03', `${B}.png`));
		expect(await locate(root, [], `${A}.jpg`)).toBeNull();
	});
});

describe('moving', () => {
	it('moves files, never overwriting', async () => {
		await put(`${A}.jpg`, 'one');
		await put(`photos/${A}.jpg`, 'two');
		await expect(moveFile(root, join(root, `${A}.jpg`), join(root, 'photos', `${A}.jpg`))).rejects.toThrow();
		await moveFile(root, join(root, `${A}.jpg`), join(root, 'docs/deep', `${A}.jpg`));
		expect(await readFile(join(root, 'docs/deep', `${A}.jpg`), 'utf8')).toBe('one');
	});

	it('refuses paths outside the root', async () => {
		await expect(moveFile(root, join(root, '..', 'x'), join(root, 'x'))).rejects.toThrow(/escapes/);
	});

	it('renames folder directories, unless the target exists', async () => {
		await put(`photos/team/${A}.jpg`);
		expect(await renameDir(root, ['photos'], ['pictures'])).toBe(true);
		expect(await exists(`pictures/team/${A}.jpg`)).toBe(true);
		await mkdir(join(root, 'taken'));
		expect(await renameDir(root, ['pictures'], ['taken'])).toBe(false);
		expect(await renameDir(root, ['nothing'], ['else'])).toBe(false);
	});
});

describe('finding and cleaning', () => {
	it('finds stored files anywhere, skipping .tmp and other names', async () => {
		await put(`a/b/${A}.jpg`);
		await put(`.tmp/${B}.jpg`);
		await put('a/notes.txt');
		const found = await findStoredFiles(root);
		expect([...found.keys()]).toEqual([`${A}.jpg`]);
	});

	it('removes empty directories that are not folders', async () => {
		await mkdir(join(root, '2026/03'), { recursive: true });
		await mkdir(join(root, 'photos/empty-folder'), { recursive: true });
		await mkdir(join(root, '.tmp'));
		await put('other/readme.txt');
		const removed = await removeEmptyDirs(root, new Set(['photos', 'photos/empty-folder']));
		expect(removed).toBe(2); // 2026/03 and 2026
		expect((await readdir(root)).sort()).toEqual(['.tmp', 'other', 'photos']);
	});
});

describe('syncFiles', () => {
	it('moves pre-folders files into place and creates folder directories', async () => {
		await put(`2026/03/${A}.jpg`);
		await put(`2026/03/${A}-k1w320.webp`);
		const result = await syncFiles(
			root,
			[{ id: A, dir: ['photos'], keys: [`2026/03/${A}.jpg`, `2026/03/${A}-k1w320.webp`] }],
			[['photos'], ['empty']],
		);
		expect(result).toMatchObject({ moved: 2, missing: [], removedDirs: 2 });
		expect(result.settled.has(A)).toBe(true);
		expect(await exists(`photos/${A}.jpg`)).toBe(true);
		expect(await exists(`photos/${A}-k1w320.webp`)).toBe(true);
		expect((await readdir(root)).sort()).toEqual(['empty', 'photos']);
	});

	it('repairs an interrupted move by finding files by name', async () => {
		// The database says "photos/team"; the directory rename never happened.
		await put(`old-name/${A}.jpg`);
		const result = await syncFiles(
			root,
			[{ id: A, dir: ['photos', 'team'], keys: [`${A}.jpg`] }],
			[['photos'], ['photos', 'team']],
		);
		expect(result.moved).toBe(1);
		expect(await exists(`photos/team/${A}.jpg`)).toBe(true);
		expect(await exists('old-name')).toBe(false);
	});

	it('reports missing files and leaves everything else alone', async () => {
		await put(`${A}.jpg`);
		await put('someone-elses/file.pdf');
		const result = await syncFiles(
			root,
			[
				{ id: A, dir: [], keys: [`${A}.jpg`] },
				{ id: B, dir: [], keys: [`${B}.jpg`] },
			],
			[],
		);
		expect(result.missing).toEqual([`${B}.jpg`]);
		expect(result.settled).toEqual(new Set([A]));
		expect(await exists('someone-elses/file.pdf')).toBe(true);
	});

	it('is a no-op when everything is in place', async () => {
		await put(`photos/${A}.jpg`);
		const result = await syncFiles(root, [{ id: A, dir: ['photos'], keys: [`${A}.jpg`] }], [['photos']]);
		expect(result).toMatchObject({ moved: 0, missing: [], removedDirs: 0 });
	});
});

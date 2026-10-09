import { describe, expect, it } from 'vitest';
import {
	chainOf,
	cleanFolderName,
	dirOf,
	displayPath,
	type FolderRecord,
	folderMap,
	heightOf,
	isFolderId,
	isSlug,
	MAX_DEPTH,
	MAX_SLUG_LENGTH,
	nameKey,
	newFolderId,
	placementProblem,
	slugFor,
	subtreeOf,
	uniqueSlug,
} from '../src/folders.js';

const folder = (id: string, parentId: string | null, slug = id, name = id): FolderRecord => ({
	id,
	parentId,
	name,
	slug,
});

/** a / b / c, plus d at the top level. */
const tree = folderMap([folder('a', null), folder('b', 'a'), folder('c', 'b'), folder('d', null)]);

describe('folder names', () => {
	it('cleans display names', () => {
		expect(cleanFolderName('  Team   photos ')).toBe('Team photos');
		expect(cleanFolderName('a\u0000b\u202Ec​d')).toBe('a b c d');
		expect(cleanFolderName('x'.repeat(100))).toHaveLength(64);
		expect(cleanFolderName('   ')).toBe('');
		expect(cleanFolderName(42)).toBe('');
		expect(cleanFolderName('Café')).toBe('Café'); // NFC
	});

	it('compares sibling names without case', () => {
		expect(nameKey('Photos')).toBe(nameKey('PHOTOS'));
		expect(nameKey('ﬁles')).toBe(nameKey('files')); // compatibility forms
	});

	it('makes ids', () => {
		expect(isFolderId(newFolderId())).toBe(true);
		expect(isFolderId('f_short')).toBe(false);
		expect(isFolderId('m_abcdefghijklmnop')).toBe(false);
	});
});

describe('directory names', () => {
	it.each([
		['Team photos', 'team-photos'],
		['Café & Bar', 'cafe-bar'],
		['2026 Q3 — Launch!', '2026-q3-launch'],
		['日本', 'folder'],
		['...', 'folder'],
		['..', 'folder'],
		['.hidden', 'hidden'],
		['../../etc', 'etc'],
		['a/b\\c', 'a-b-c'],
		['CON', 'con-folder'],
		['lpt9', 'lpt9-folder'],
		['Ünïcödé', 'unicode'],
		['  -x-  ', 'x'],
	])('%j → %s', (name, slug) => {
		expect(slugFor(name)).toBe(slug);
		expect(isSlug(slugFor(name))).toBe(true);
	});

	it('stay short and never end in a hyphen', () => {
		const slug = slugFor(`${'a'.repeat(39)} b`);
		expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
		expect(slug.endsWith('-')).toBe(false);
	});

	it('are made unique among siblings', () => {
		expect(uniqueSlug('photos', new Set())).toBe('photos');
		expect(uniqueSlug('photos', new Set(['photos']))).toBe('photos-2');
		expect(uniqueSlug('photos', new Set(['photos', 'photos-2']))).toBe('photos-3');
		const long = 'a'.repeat(MAX_SLUG_LENGTH);
		const unique = uniqueSlug(long, new Set([long]));
		expect(unique).toHaveLength(MAX_SLUG_LENGTH);
		expect(unique.endsWith('-2')).toBe(true);
	});

	it.each(['', '-a', 'a-', 'A', 'a_b', 'a.b', '..', '.tmp', 'a/b', 'a'.repeat(41)])('refuses %j', (slug) => {
		expect(isSlug(slug)).toBe(false);
	});
});

describe('the tree', () => {
	it('builds directory paths', () => {
		expect(dirOf(null, tree)).toEqual([]);
		expect(dirOf('c', tree)).toEqual(['a', 'b', 'c']);
		expect(displayPath('c', tree)).toBe('a / b / c');
		expect(dirOf('missing', tree)).toBeNull();
	});

	it('refuses broken chains: cycles, missing parents, bad directory names', () => {
		const cycle = folderMap([folder('x', 'y'), folder('y', 'x')]);
		expect(chainOf('x', cycle)).toBeNull();
		expect(heightOf('x', cycle)).toBeGreaterThan(MAX_DEPTH);
		expect(chainOf('orphan', folderMap([folder('orphan', 'gone')]))).toBeNull();
		expect(dirOf('bad', folderMap([folder('bad', null, '../etc')]))).toBeNull();
	});

	it('finds subtrees and heights', () => {
		expect(subtreeOf('a', tree)).toEqual(new Set(['a', 'b', 'c']));
		expect(heightOf('a', tree)).toBe(3);
		expect(heightOf('d', tree)).toBe(1);
	});

	it('checks where a folder can go', () => {
		expect(placementProblem(null, null, tree)).toBeNull();
		expect(placementProblem(null, 'c', tree)).toBeNull();
		expect(placementProblem('a', 'c', tree)).toMatch(/inside itself/);
		expect(placementProblem('a', 'a', tree)).toMatch(/inside itself/);
		expect(placementProblem('d', 'c', tree)).toBeNull();
		expect(placementProblem('d', 'gone', tree)).toMatch(/no longer exists/);
	});

	it('limits the depth', () => {
		const deep = folderMap(Array.from({ length: MAX_DEPTH }, (_, i) => folder(`l${i}`, i === 0 ? null : `l${i - 1}`)));
		expect(chainOf(`l${MAX_DEPTH - 1}`, deep)).toHaveLength(MAX_DEPTH);
		expect(placementProblem(null, `l${MAX_DEPTH - 1}`, deep)).toMatch(/at most/);
		expect(placementProblem(null, `l${MAX_DEPTH - 2}`, deep)).toBeNull();
		// Moving a 3-level subtree under a folder at depth MAX_DEPTH - 2 would be too deep.
		const both = folderMap([...deep.values(), ...tree.values()]);
		expect(placementProblem('a', `l${MAX_DEPTH - 3}`, both)).toMatch(/at most/);
		expect(placementProblem('a', `l${MAX_DEPTH - 4}`, both)).toBeNull();
	});
});

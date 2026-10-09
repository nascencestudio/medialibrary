/**
 * Folders (ADR 0100): names, their directory names on disk, and the tree rules.
 * Every folder has a display name (anything readable, unique among its siblings
 * regardless of case) and a directory name derived from it: lowercase ASCII
 * letters, digits and hyphens only, so a user-typed name can never become `..`, a
 * hidden or reserved name, or two names that differ only in case (one directory
 * on macOS, two on Linux). Pure functions only.
 */

/** Folder ids: `f_` + 16 lowercase base-36 characters. */
export const FOLDER_ID = /^f_[a-z0-9]{16}$/;

export const isFolderId = (value: unknown): value is string => typeof value === 'string' && FOLDER_ID.test(value);

export function newFolderId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `f_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

/** Deepest allowed nesting (a top-level folder has depth 1). */
export const MAX_DEPTH = 8;
/** Most folders a library can have. */
export const MAX_FOLDERS = 1000;
export const MAX_NAME_LENGTH = 64;
export const MAX_SLUG_LENGTH = 40;

/** A directory name: starts and ends with a letter or digit, hyphens inside. */
export const SLUG = new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,${MAX_SLUG_LENGTH - 2}}[a-z0-9])?$`);

export const isSlug = (value: unknown): value is string => typeof value === 'string' && SLUG.test(value);

/** Names Windows refuses for files and directories (in case the storage ever lives there). */
const RESERVED = new Set([
	'con',
	'prn',
	'aux',
	'nul',
	...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
	...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** A display name: control characters removed, spaces collapsed, at most 64 characters; '' if nothing is left. */
export function cleanFolderName(input: unknown): string {
	if (typeof input !== 'string') return '';
	return (
		input
			// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
			.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
			.normalize('NFC')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, MAX_NAME_LENGTH)
			.trim()
	);
}

/** Case-insensitive comparison key for sibling names. */
export const nameKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en');

/** The directory name for a display name (before making it unique among siblings). */
export function slugFor(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '') // accents: "Café" → "cafe"
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/, '');
	if (!slug) return 'folder';
	return RESERVED.has(slug) ? `${slug}-folder` : slug;
}

/** `base`, or `base-2`, `base-3`… (shortened to fit) when a sibling already uses it. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const suffix = `-${n}`;
		const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
}

export interface FolderRecord {
	id: string;
	parentId: string | null;
	name: string;
	slug: string;
}

export type FolderMap = ReadonlyMap<string, FolderRecord>;

export const folderMap = (folders: readonly FolderRecord[]): Map<string, FolderRecord> =>
	new Map(folders.map((f) => [f.id, f]));

/**
 * The chain of folders from the top level down to `id` (inclusive), or null when the
 * chain is broken: a missing folder, a cycle, too deep, or an invalid directory name.
 */
export function chainOf(id: string, folders: FolderMap): FolderRecord[] | null {
	const chain: FolderRecord[] = [];
	let current: string | null = id;
	while (current !== null) {
		const folder = folders.get(current);
		if (!folder || !isSlug(folder.slug) || chain.length >= MAX_DEPTH || chain.includes(folder)) return null;
		chain.unshift(folder);
		current = folder.parentId;
	}
	return chain;
}

/** Directory names from the storage root to a folder ([] for the top level, null when broken). */
export function dirOf(id: string | null, folders: FolderMap): string[] | null {
	if (id === null) return [];
	return chainOf(id, folders)?.map((f) => f.slug) ?? null;
}

/** The folder and every folder below it. */
export function subtreeOf(id: string, folders: FolderMap): Set<string> {
	const ids = new Set([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const folder of folders.values()) {
			if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
				ids.add(folder.id);
				grew = true;
			}
		}
	}
	return ids;
}

/** How many levels a folder's subtree spans (1 for a folder without subfolders). */
export function heightOf(id: string, folders: FolderMap, seen: Set<string> = new Set()): number {
	if (seen.has(id)) return MAX_DEPTH + 1; // a cycle: treat as too deep
	seen.add(id);
	let height = 1;
	for (const folder of folders.values()) {
		if (folder.parentId === id) height = Math.max(height, 1 + heightOf(folder.id, folders, seen));
	}
	seen.delete(id);
	return height;
}

export const childrenOf = (parentId: string | null, folders: FolderMap): FolderRecord[] =>
	[...folders.values()].filter((f) => f.parentId === parentId);

/**
 * Why a folder can't go under `parentId` (null: it can). Checks that the parent exists,
 * that a folder isn't moved into itself or below itself, and the depth limit.
 */
export function placementProblem(folderId: string | null, parentId: string | null, folders: FolderMap): string | null {
	if (parentId === null) {
		return folderId !== null && heightOf(folderId, folders) > MAX_DEPTH ? 'That would nest folders too deeply.' : null;
	}
	const chain = chainOf(parentId, folders);
	if (!chain) return 'The target folder no longer exists.';
	if (folderId !== null && chain.some((f) => f.id === folderId)) return "A folder can't go inside itself.";
	const height = folderId === null ? 1 : heightOf(folderId, folders);
	return chain.length + height > MAX_DEPTH ? `Folders can be nested at most ${MAX_DEPTH} levels deep.` : null;
}

/** Display path of a folder, e.g. "Photos / Team" ('' for the top level). */
export function displayPath(id: string | null, folders: FolderMap): string {
	if (id === null) return '';
	return (chainOf(id, folders) ?? []).map((f) => f.name).join(' / ');
}

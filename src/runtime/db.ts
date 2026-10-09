/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * Media item and folder records, in the `NascenceMediaItems` and
 * `NascenceMediaFolders` tables of StudioCMS's database. The tables are created
 * on first use (Kysely schema builder, so it works on every database StudioCMS
 * supports). Server only.
 */

import { SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:medialibrary/config';
import { sql } from 'kysely';
import type { FolderRecord } from '../folders.js';
import { fileNameOf } from '../keys.js';
import { decodeTags, encodeTags, type FocalPoint, normalizeFocalPoint } from '../meta.js';
import { remoteVideoFrom } from '../remote.js';
import { parseTracks, parseVariants, type StoredTrack, type StoredVariant, srcsetFor } from '../stored.js';
import type { MediaItem, MediaKind, RemoteProvider } from '../types.js';

export const TABLE = 'NascenceMediaItems';
export const FOLDERS_TABLE = 'NascenceMediaFolders';

export interface MediaRow {
	id: string;
	kind: MediaKind;
	name: string;
	alt: string;
	mime: string;
	size: number;
	width: number | null;
	height: number | null;
	storageKey: string | null;
	provider: string | null;
	providerId: string | null;
	thumbnailUrl: string | null;
	createdAt: string;
	updatedAt: string;
	createdBy: string | null;
	/** `|a|b|` (see meta.ts). */
	tags: string;
	focalX: number | null;
	focalY: number | null;
	/** JSON StoredTrack[] (see stored.ts). */
	tracks: string;
	/** JSON StoredVariant[] (see stored.ts). */
	variants: string;
	/** The folder the item is in (null: the top level). */
	folderId: string | null;
}

export interface FolderRow extends FolderRecord {
	createdAt: string;
	updatedAt: string;
}

/** Columns added after the first release, added to existing tables on first use. */
const ADDED_COLUMNS: Array<[string, string, (c: Column) => Column]> = [
	['tags', 'text', (c) => c.notNull().defaultTo('')],
	['focalX', 'integer', (c) => c],
	['focalY', 'integer', (c) => c],
	['tracks', 'text', (c) => c.notNull().defaultTo('[]')],
	['variants', 'text', (c) => c.notNull().defaultTo('[]')],
	['folderId', 'varchar(32)', (c) => c],
];

// Our table isn't part of StudioCMS's typed schema, so queries are untyped here.
// biome-ignore lint/suspicious/noExplicitAny: see above
const db = (): any => SDKCoreJs.dbService.db;

/** The bits of Kysely's column builder used here. */
interface Column {
	primaryKey(): Column;
	notNull(): Column;
	defaultTo(value: unknown): Column;
}

let ready: Promise<void> | null = null;

/** Create the table and its index if they don't exist yet (once per process). */
export function ensureTable(): Promise<void> {
	ready ??= (async () => {
		await db()
			.schema.createTable(TABLE)
			.ifNotExists()
			.addColumn('id', 'varchar(32)', (c: Column) => c.primaryKey())
			.addColumn('kind', 'varchar(16)', (c: Column) => c.notNull())
			.addColumn('name', 'varchar(255)', (c: Column) => c.notNull())
			.addColumn('alt', 'text', (c: Column) => c.notNull().defaultTo(''))
			.addColumn('mime', 'varchar(128)', (c: Column) => c.notNull().defaultTo(''))
			.addColumn('size', 'bigint', (c: Column) => c.notNull().defaultTo(0))
			.addColumn('width', 'integer')
			.addColumn('height', 'integer')
			.addColumn('storageKey', 'varchar(128)')
			.addColumn('provider', 'varchar(16)')
			.addColumn('providerId', 'varchar(64)')
			.addColumn('thumbnailUrl', 'text')
			.addColumn('createdAt', 'varchar(32)', (c: Column) => c.notNull())
			.addColumn('updatedAt', 'varchar(32)', (c: Column) => c.notNull())
			.addColumn('createdBy', 'varchar(255)')
			.execute();
		await db().schema.createIndex(`${TABLE}_createdAt`).ifNotExists().on(TABLE).column('createdAt').execute();
		await addMissingColumns();
		await db().schema.createIndex(`${TABLE}_folderId`).ifNotExists().on(TABLE).column('folderId').execute();
		await db()
			.schema.createTable(FOLDERS_TABLE)
			.ifNotExists()
			.addColumn('id', 'varchar(32)', (c: Column) => c.primaryKey())
			.addColumn('parentId', 'varchar(32)')
			.addColumn('name', 'varchar(255)', (c: Column) => c.notNull())
			.addColumn('slug', 'varchar(64)', (c: Column) => c.notNull())
			.addColumn('createdAt', 'varchar(32)', (c: Column) => c.notNull())
			.addColumn('updatedAt', 'varchar(32)', (c: Column) => c.notNull())
			.execute();
		// Files stored before folders get moved into place (once per process, in the background).
		void import('./sync.js').then((sync) => sync.startupSync());
	})().catch((cause) => {
		ready = null;
		throw cause;
	});
	return ready;
}

/** Add columns introduced after the table was created (tags, focal point, tracks, variants). */
async function addMissingColumns(): Promise<void> {
	let existing: Set<string> | null = null;
	try {
		const tables: Array<{ name: string; columns: Array<{ name: string }> }> = await db().introspection.getTables();
		const table = tables.find((t) => t.name === TABLE);
		if (table) existing = new Set(table.columns.map((c) => c.name));
	} catch {
		// No introspection: try each column and ignore "already exists" errors below.
	}
	for (const [name, type, build] of ADDED_COLUMNS) {
		if (existing?.has(name)) continue;
		try {
			await db().schema.alterTable(TABLE).addColumn(name, type, build).execute();
		} catch (cause) {
			if (!/duplicate|already exists/i.test(String((cause as Error)?.message ?? cause))) throw cause;
		}
	}
}

/** A stored file's URL: its file name only, so moving the item between folders never changes it. */
export const publicUrl = (storageKey: string) => `${config.publicPath}/${fileNameOf(storageKey)}`;

/** Stored caption tracks and image variants of a row (validated). */
export const tracksOf = (row: Pick<MediaRow, 'tracks'>): StoredTrack[] => parseTracks(row.tracks);
export const variantsOf = (row: Pick<MediaRow, 'variants'>): StoredVariant[] => parseVariants(row.variants);

/** Every stored file of a row: the main file, variants and caption tracks. */
export function filesOf(row: MediaRow): string[] {
	return [
		...(row.storageKey ? [row.storageKey] : []),
		...variantsOf(row).map((v) => v.storageKey),
		...tracksOf(row).map((t) => t.storageKey),
	];
}

const focalOf = (row: MediaRow): FocalPoint | null =>
	row.focalX === null || row.focalX === undefined || row.focalY === null || row.focalY === undefined
		? null
		: normalizeFocalPoint({ x: Number(row.focalX), y: Number(row.focalY) });

export function toItem(row: MediaRow): MediaItem {
	const remote = row.kind === 'remoteVideo' ? remoteVideoFrom(row.provider ?? '', row.providerId ?? '') : null;
	const url = remote ? remote.watchUrl : row.storageKey ? publicUrl(row.storageKey) : '';
	const width = row.width === null ? null : Number(row.width);
	const variants =
		row.kind === 'image'
			? variantsOf(row).map((v) => ({ url: publicUrl(v.storageKey), width: v.width, height: v.height, mime: v.mime }))
			: [];
	return {
		id: row.id,
		kind: row.kind,
		name: row.name,
		alt: row.alt,
		mime: row.mime,
		size: Number(row.size),
		width,
		height: row.height === null ? null : Number(row.height),
		url,
		embedUrl: remote?.embedUrl ?? null,
		thumbnailUrl:
			row.kind === 'image'
				? (variants.find((v) => v.width >= 320)?.url ?? url)
				: (row.thumbnailUrl ?? remote?.thumbnailUrl ?? null),
		provider: (remote?.provider ?? null) as RemoteProvider | null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		createdBy: row.createdBy,
		tags: decodeTags(row.tags),
		focalPoint: row.kind === 'image' ? focalOf(row) : null,
		tracks:
			row.kind === 'video'
				? tracksOf(row).map((t) => ({
						id: t.id,
						kind: t.kind,
						srclang: t.srclang,
						label: t.label,
						url: publicUrl(t.storageKey),
					}))
				: [],
		variants,
		srcset: row.kind === 'image' ? srcsetFor(variants, { url, width }) : null,
		folderId: row.folderId ?? null,
	};
}

export async function insertRow(row: MediaRow): Promise<void> {
	await ensureTable();
	await db().insertInto(TABLE).values(row).execute();
}

export async function getRow(id: string): Promise<MediaRow | undefined> {
	await ensureTable();
	return (await db().selectFrom(TABLE).selectAll().where('id', '=', id).executeTakeFirst()) as MediaRow | undefined;
}

export async function getRows(ids: readonly string[]): Promise<MediaRow[]> {
	if (ids.length === 0) return [];
	await ensureTable();
	return (await db()
		.selectFrom(TABLE)
		.selectAll()
		.where('id', 'in', [...ids])
		.execute()) as MediaRow[];
}

/**
 * `column LIKE '%text%'` matching `text` literally: `%`, `_` and the escape
 * character itself are escaped with `!` (SQLite has no default LIKE escape, so
 * the ESCAPE clause is required; `!` behaves the same on every database).
 */
export const likePattern = (text: string) => `%${text.replace(/[!%_]/g, (c) => `!${c}`)}%`;
const contains = (column: string, text: string) =>
	sql<boolean>`${sql.ref(column)} like ${likePattern(text)} escape '!'`;

export interface ListQuery {
	kinds?: MediaKind[];
	search?: string;
	/** One (normalized) tag. */
	tag?: string;
	/** Only items directly in this folder (null: the top level; undefined: every folder). */
	folder?: string | null;
	offset?: number;
	limit?: number;
}

export async function listRows({
	kinds,
	search,
	tag,
	folder,
	offset = 0,
	limit = 60,
}: ListQuery): Promise<{ rows: MediaRow[]; total: number }> {
	await ensureTable();
	// biome-ignore lint/suspicious/noExplicitAny: Kysely query builder over an untyped table
	const filtered = (query: any) => {
		let q = query;
		if (kinds && kinds.length > 0) q = q.where('kind', 'in', kinds);
		if (search) q = q.where(contains('name', search));
		if (tag) q = q.where(contains('tags', encodeTags([tag])));
		if (folder === null) q = q.where('folderId', 'is', null);
		else if (folder !== undefined) q = q.where('folderId', '=', folder);
		return q;
	};
	const [rows, count] = await Promise.all([
		filtered(db().selectFrom(TABLE).selectAll())
			.orderBy('createdAt', 'desc')
			.orderBy('id')
			.offset(offset)
			.limit(limit)
			.execute(),
		filtered(
			db()
				.selectFrom(TABLE)
				.select((eb: { fn: { countAll: () => { as: (n: string) => unknown } } }) => eb.fn.countAll().as('total')),
		).executeTakeFirst(),
	]);
	return { rows: rows as MediaRow[], total: Number((count as { total?: number } | undefined)?.total ?? 0) };
}

export type RowPatch = Partial<
	Pick<
		MediaRow,
		| 'name'
		| 'alt'
		| 'tags'
		| 'focalX'
		| 'focalY'
		| 'tracks'
		| 'variants'
		| 'mime'
		| 'size'
		| 'width'
		| 'height'
		| 'storageKey'
		| 'folderId'
	>
>;

export async function updateRow(id: string, patch: RowPatch): Promise<MediaRow | undefined> {
	await ensureTable();
	await db()
		.updateTable(TABLE)
		.set({ ...patch, updatedAt: new Date().toISOString() })
		.where('id', '=', id)
		.execute();
	return getRow(id);
}

export async function deleteRow(id: string): Promise<void> {
	await ensureTable();
	await db().deleteFrom(TABLE).where('id', '=', id).execute();
}

/**
 * Images that should have resized copies but have none: raster formats wide
 * enough for at least one copy (`minWidth`), with no stored variants.
 */
export async function imagesMissingVariants(
	minWidth: number,
	mimes: ReadonlySet<string>,
	limit = 1000,
): Promise<{ rows: MediaRow[]; total: number }> {
	await ensureTable();
	// biome-ignore lint/suspicious/noExplicitAny: Kysely query builder over an untyped table
	const filtered = (query: any) =>
		query
			.where('kind', '=', 'image')
			.where('mime', 'in', [...mimes])
			.where('variants', '=', '[]')
			.where('width', '>=', minWidth);
	const [rows, count] = await Promise.all([
		filtered(db().selectFrom(TABLE).selectAll()).orderBy('createdAt', 'desc').limit(limit).execute(),
		filtered(
			db()
				.selectFrom(TABLE)
				.select((eb: { fn: { countAll: () => { as: (n: string) => unknown } } }) => eb.fn.countAll().as('total')),
		).executeTakeFirst(),
	]);
	return { rows: rows as MediaRow[], total: Number((count as { total?: number } | undefined)?.total ?? 0) };
}

/** Every tag in use, with how many items have it, most used first. */
export async function listTags(): Promise<Array<{ tag: string; count: number }>> {
	await ensureTable();
	const rows: Array<{ tags: string }> = await db().selectFrom(TABLE).select('tags').where('tags', '!=', '').execute();
	const counts = new Map<string, number>();
	for (const row of rows) for (const tag of decodeTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	return [...counts]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface Usage {
	pageId: string;
	title: string;
	slug: string;
}

/** Pages whose stored content mentions the item (by id, which also appears in its file URL). */
export async function usageOf(id: string): Promise<Usage[]> {
	const rows = await db()
		.selectFrom('StudioCMSPageContent as c')
		.innerJoin('StudioCMSPageData as p', 'p.id', 'c.contentId')
		.select(['p.id as pageId', 'p.title as title', 'p.slug as slug'])
		.where(contains('c.content', id))
		.execute();
	const seen = new Set<string>();
	return (rows as Usage[]).filter((row) => !seen.has(row.pageId) && seen.add(row.pageId));
}

/** The stored files of every uploaded item, for keeping the disk in step (sync.ts). */
export async function rowsWithFiles(): Promise<
	Array<Pick<MediaRow, 'id' | 'folderId' | 'storageKey' | 'tracks' | 'variants'>>
> {
	await ensureTable();
	return db()
		.selectFrom(TABLE)
		.select(['id', 'folderId', 'storageKey', 'tracks', 'variants'])
		.where('storageKey', 'is not', null)
		.execute();
}

/** Set an item's folder and/or rewrite its stored keys, without touching `updatedAt`. */
export async function setRowFiles(
	id: string,
	patch: Partial<Pick<MediaRow, 'storageKey' | 'tracks' | 'variants' | 'folderId'>>,
): Promise<void> {
	await ensureTable();
	await db().updateTable(TABLE).set(patch).where('id', '=', id).execute();
}

/** Items per folder (the top level under the key ''), optionally only of some kinds. */
export async function countByFolder(kinds?: readonly MediaKind[]): Promise<Map<string, number>> {
	await ensureTable();
	let query = db()
		.selectFrom(TABLE)
		.select((eb: { fn: { countAll: () => { as: (n: string) => unknown } } }) => [
			'folderId',
			eb.fn.countAll().as('total'),
		]);
	if (kinds && kinds.length > 0) query = query.where('kind', 'in', [...kinds]);
	const rows: Array<{ folderId: string | null; total: number | string }> = await query.groupBy('folderId').execute();
	return new Map(rows.map((r) => [r.folderId ?? '', Number(r.total)]));
}

export async function listFolderRows(): Promise<FolderRow[]> {
	await ensureTable();
	return (await db().selectFrom(FOLDERS_TABLE).selectAll().execute()) as FolderRow[];
}

export async function insertFolderRow(row: FolderRow): Promise<void> {
	await ensureTable();
	await db().insertInto(FOLDERS_TABLE).values(row).execute();
}

export async function updateFolderRow(id: string, patch: Partial<Pick<FolderRow, 'name' | 'slug' | 'parentId'>>) {
	await ensureTable();
	await db()
		.updateTable(FOLDERS_TABLE)
		.set({ ...patch, updatedAt: new Date().toISOString() })
		.where('id', '=', id)
		.execute();
}

export async function deleteFolderRow(id: string): Promise<void> {
	await ensureTable();
	await db().deleteFrom(FOLDERS_TABLE).where('id', '=', id).execute();
}

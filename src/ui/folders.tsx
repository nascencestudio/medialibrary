/**
 * Folder UI for the media library (ADR 0100): the folder list (also a drop target
 * for dragged items), the current folder's bar (breadcrumb, new / rename / move /
 * delete) and a folder select for moving things.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { MediaFolder } from '../types.js';
import type { FolderContents, FolderView } from './api.js';
import { PageList } from './usage.js';

/** Drag type for media items dragged onto a folder (JSON array of ids). */
export const ITEMS_DRAG_TYPE = 'application/x-nascence-media-ids';

export interface FolderEntry {
	folder: MediaFolder;
	depth: number;
}

/** Folders in tree order (each followed by its subfolders), with their depth. */
export function treeOrder(folders: readonly MediaFolder[]): FolderEntry[] {
	const byParent = new Map<string | null, MediaFolder[]>();
	for (const folder of folders) {
		const list = byParent.get(folder.parentId) ?? [];
		list.push(folder);
		byParent.set(folder.parentId, list);
	}
	const out: FolderEntry[] = [];
	const seen = new Set<string>();
	const walk = (parentId: string | null, depth: number) => {
		const children = (byParent.get(parentId) ?? []).sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true }),
		);
		for (const folder of children) {
			if (seen.has(folder.id)) continue;
			seen.add(folder.id);
			out.push({ folder, depth });
			walk(folder.id, depth + 1);
		}
	};
	walk(null, 0);
	return out;
}

/** The folder and its ancestors, top level first. */
export function pathTo(id: string, folders: readonly MediaFolder[]): MediaFolder[] {
	const byId = new Map(folders.map((f) => [f.id, f]));
	const path: MediaFolder[] = [];
	let current = byId.get(id);
	while (current && !path.includes(current)) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path;
}

/** Ids of a folder and every folder below it. */
export function subtree(id: string, folders: readonly MediaFolder[]): Set<string> {
	const ids = new Set([id]);
	for (const { folder } of treeOrder(folders)) if (folder.parentId && ids.has(folder.parentId)) ids.add(folder.id);
	return ids;
}

const draggedIds = (event: DragEvent): string[] | null => {
	try {
		const ids = JSON.parse(event.dataTransfer?.getData(ITEMS_DRAG_TYPE) ?? '');
		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : null;
	} catch {
		return null;
	}
};

function FolderIcon() {
	return (
		<svg class="ml-folder-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
			<path
				d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

interface NavProps {
	folders: readonly MediaFolder[];
	topLevelCount: number;
	total: number;
	view: FolderView;
	onView: (view: FolderView) => void;
	/** Items dropped on a folder (null: the top level). Absent: no drop targets. */
	onDropItems?: (ids: string[], folderId: string | null) => void;
	/** Grey out entries with nothing in them (counting subfolders), e.g. nothing a picker's field can use. */
	dimEmpty?: boolean;
}

/** Items in each folder including its subfolders. */
function subtreeCounts(folders: readonly MediaFolder[]): Map<string, number> {
	const totals = new Map(folders.map((f) => [f.id, f.itemCount]));
	// Deepest first, so each folder's total is complete before it's added to its parent.
	for (const { folder } of treeOrder(folders).reverse()) {
		if (folder.parentId && totals.has(folder.parentId)) {
			totals.set(folder.parentId, (totals.get(folder.parentId) ?? 0) + (totals.get(folder.id) ?? 0));
		}
	}
	return totals;
}

/** The folder list: All media, Not in a folder, then the tree. */
export function FolderNav({ folders, topLevelCount, total, view, onView, onDropItems, dimEmpty }: NavProps) {
	const over = useSignal<string | null>(null);
	const totals = dimEmpty ? subtreeCounts(folders) : null;
	const row = (key: string, target: FolderView, label: string, count: number, depth = 0, folder?: MediaFolder) => {
		const dropTarget = onDropItems && target !== 'all' ? (target as string | null) : undefined;
		const empty = totals !== null && (folder ? (totals.get(folder.id) ?? 0) : count) === 0;
		return (
			<li key={key}>
				<button
					type="button"
					class={`ml-folder${over.value === key ? ' ml-folder--over' : ''}${empty ? ' ml-folder--empty' : ''}`}
					data-media-folder-empty={empty ? '' : undefined}
					style={{ paddingInlineStart: `${0.5 + depth * 0.875}rem` }}
					aria-current={view === target ? 'true' : undefined}
					data-media-folder={folder ? folder.id : key}
					title={folder ? `${label} (${folder.slug})` : label}
					onClick={() => onView(target)}
					onDragOver={(e) => {
						if (dropTarget === undefined || !e.dataTransfer?.types.includes(ITEMS_DRAG_TYPE)) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = 'move';
						over.value = key;
					}}
					onDragLeave={() => {
						if (over.value === key) over.value = null;
					}}
					onDrop={(e) => {
						over.value = null;
						if (dropTarget === undefined) return;
						const ids = draggedIds(e);
						if (!ids?.length) return;
						e.preventDefault();
						e.stopPropagation(); // not an upload
						onDropItems?.(ids, dropTarget);
					}}
				>
					{folder && <FolderIcon />}
					<span class="ml-folder__name">{label}</span>
					<span class="ml-folder__count">{count}</span>
				</button>
			</li>
		);
	};
	return (
		<nav class="ml-folders" aria-label="Folders" data-media-folders>
			<ul>
				{row('all', 'all', 'All media', total)}
				{row('top', null, 'Not in a folder', topLevelCount)}
				{treeOrder(folders).map(({ folder, depth }) =>
					row(folder.id, folder.id, folder.name, folder.itemCount, depth, folder),
				)}
			</ul>
		</nav>
	);
}

interface SelectProps {
	folders: readonly MediaFolder[];
	value: string | null;
	onChange: (folderId: string | null) => void;
	/** Folders that can't be chosen (e.g. a folder and its subfolders when moving it). */
	exclude?: ReadonlySet<string>;
	label: string;
	field?: string;
	placeholder?: string;
}

/** A select of every folder (indented by depth), with "Top level" first. */
export function FolderSelect({ folders, value, onChange, exclude, label, field, placeholder }: SelectProps) {
	return (
		<select
			class="ml-input"
			aria-label={label}
			data-media-folder-select={field}
			value={placeholder ? '' : (value ?? 'top')}
			onChange={(e) => {
				const next = e.currentTarget.value;
				if (next === '') return;
				onChange(next === 'top' ? null : next);
				if (placeholder) e.currentTarget.value = '';
			}}
		>
			{placeholder && <option value="">{placeholder}</option>}
			<option value="top">Top level</option>
			{treeOrder(folders).map(({ folder, depth }) => (
				<option key={folder.id} value={folder.id} disabled={exclude?.has(folder.id)}>
					{`${' '.repeat(depth)}${folder.name}`}
				</option>
			))}
		</select>
	);
}

interface NameFormProps {
	initial: string;
	submitLabel: string;
	field: string;
	onSubmit: (name: string) => Promise<void>;
	onCancel: () => void;
}

/** An inline name field with Save / Cancel. Enter saves, Escape cancels. */
function NameForm({ initial, submitLabel, field, onSubmit, onCancel }: NameFormProps) {
	const name = useSignal(initial);
	const busy = useSignal(false);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	const submit = async () => {
		if (!name.value.trim() || busy.value) return;
		busy.value = true;
		try {
			await onSubmit(name.value.trim());
		} finally {
			busy.value = false;
		}
	};
	return (
		<span class="ml-folder-form">
			<input
				ref={input}
				class="ml-input"
				aria-label="Folder name"
				maxLength={64}
				value={name.value}
				data-media-folder-name={field}
				onInput={(e) => {
					name.value = e.currentTarget.value;
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void submit();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						onCancel();
					}
				}}
			/>
			<button
				type="button"
				class="ml-button ml-button--primary"
				disabled={busy.value || !name.value.trim()}
				data-media-folder-save={field}
				onClick={() => void submit()}
			>
				{submitLabel}
			</button>
			<button type="button" class="ml-button" onClick={onCancel}>
				Cancel
			</button>
		</span>
	);
}

interface BarProps {
	folders: readonly MediaFolder[];
	view: FolderView;
	onView: (view: FolderView) => void;
	/** Folder management (Media page); absent in the picker. */
	/** Each resolves to whether it worked (errors are shown by the caller). */
	manage?: {
		create: (name: string, parentId: string | null) => Promise<boolean>;
		rename: (id: string, name: string) => Promise<boolean>;
		move: (id: string, parentId: string | null) => Promise<boolean>;
		contents: (id: string) => Promise<FolderContents>;
		remove: (id: string, confirm: string) => Promise<boolean>;
	};
}

/** Same comparison as the server's: case-insensitive, spaces trimmed and collapsed. */
const sameName = (a: string, b: string) => {
	const key = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
	return key(a) === key(b);
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface DeleteDialogProps {
	folder: MediaFolder;
	contents: FolderContents;
	onCancel: () => void;
	onDelete: (typed: string) => Promise<boolean>;
}

/**
 * "Delete folder?": what it contains and which pages use media in it; Delete stays disabled
 * until the folder's name is typed (case-insensitive; the server checks it again).
 */
function DeleteFolderDialog({ folder, contents, onCancel, onDelete }: DeleteDialogProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const typed = useSignal('');
	const busy = useSignal(false);
	useLayoutEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	const matches = sameName(typed.value, folder.name);
	const confirm = async () => {
		if (!matches || busy.value) return;
		busy.value = true;
		try {
			await onDelete(typed.value);
		} finally {
			busy.value = false;
		}
	};
	const inside = [
		contents.folders > 0 && plural(contents.folders, 'subfolder'),
		contents.items > 0 && plural(contents.items, 'media item'),
	].filter(Boolean);
	return (
		<dialog
			ref={dialog}
			class="ml-confirm-dialog"
			aria-labelledby="ml-delete-folder-title"
			data-media-delete-folder
			onCancel={(e) => {
				e.preventDefault();
				onCancel();
			}}
		>
			<h2 id="ml-delete-folder-title" class="ml-dialog__title">
				Delete "{folder.name}"?
			</h2>
			{inside.length > 0 ? (
				<p>
					This deletes the folder with everything in it: <strong>{inside.join(' and ')}</strong>, and their files.
				</p>
			) : (
				<p>The folder is empty.</p>
			)}
			{contents.inUse > 0 && (
				<div class="ml-warning" data-media-delete-folder-in-use={contents.inUse}>
					<p>
						<strong>{plural(contents.inUse, 'item is', 'items are')} used on the site.</strong> These pages will show a
						gap:
					</p>
					<PageList pages={contents.pages} more={contents.morePages} />
				</div>
			)}
			<p>This can't be undone.</p>
			<label class="ml-field">
				<span>
					Type <strong>{folder.name}</strong> to confirm
				</span>
				<input
					class="ml-input"
					autoComplete="off"
					spellcheck={false}
					value={typed.value}
					data-media-delete-folder-name
					onInput={(e) => {
						typed.value = e.currentTarget.value;
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void confirm();
						}
					}}
				/>
			</label>
			<div class="ml-dialog-actions">
				<button type="button" class="ml-button" data-media-delete-folder-cancel onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					class="ml-button ml-button--danger"
					disabled={!matches || busy.value}
					data-media-delete-folder-confirm
					onClick={() => void confirm()}
				>
					Delete
				</button>
			</div>
		</dialog>
	);
}

/** Where you are (breadcrumb) and what you can do with the current folder. */
export function FolderBar({ folders, view, onView, manage }: BarProps) {
	// The parent renders this with `key={view}`, so an open form never outlives a folder change.
	const editing = useSignal<'create' | 'rename' | 'move' | null>(null);
	const deleting = useSignal<{ folder: MediaFolder; contents: FolderContents } | null>(null);
	const current = typeof view === 'string' && view !== 'all' ? folders.find((f) => f.id === view) : undefined;
	const crumbs = current ? pathTo(current.id, folders) : [];
	return (
		<div class="ml-folder-bar" data-media-folder-bar>
			<nav class="ml-crumbs" aria-label="Current folder">
				{view === 'all' ? (
					<span aria-current="page">All media</span>
				) : (
					<>
						<button type="button" class="ml-link" onClick={() => onView(null)}>
							Top level
						</button>
						{crumbs.map((folder) => (
							<span key={folder.id}>
								<span class="ml-crumbs__sep" aria-hidden="true">
									/
								</span>
								{folder.id === current?.id ? (
									<span aria-current="page">{folder.name}</span>
								) : (
									<button type="button" class="ml-link" onClick={() => onView(folder.id)}>
										{folder.name}
									</button>
								)}
							</span>
						))}
					</>
				)}
			</nav>
			{manage && (
				<span class="ml-folder-actions">
					{editing.value === 'create' ? (
						<NameForm
							initial=""
							submitLabel="Create"
							field="create"
							onSubmit={async (name) => {
								if (await manage.create(name, current?.id ?? null)) editing.value = null;
							}}
							onCancel={() => (editing.value = null)}
						/>
					) : editing.value === 'rename' && current ? (
						<NameForm
							initial={current.name}
							submitLabel="Rename"
							field="rename"
							onSubmit={async (name) => {
								if (await manage.rename(current.id, name)) editing.value = null;
							}}
							onCancel={() => (editing.value = null)}
						/>
					) : editing.value === 'move' && current ? (
						<span class="ml-folder-form">
							<FolderSelect
								folders={folders}
								value={current.parentId}
								exclude={subtree(current.id, folders)}
								label={`Move "${current.name}" to`}
								field="folder-move"
								placeholder={`Move "${current.name}" to…`}
								onChange={async (parentId) => {
									if (await manage.move(current.id, parentId)) editing.value = null;
								}}
							/>
							<button type="button" class="ml-button" onClick={() => (editing.value = null)}>
								Cancel
							</button>
						</span>
					) : (
						<>
							<button
								type="button"
								class="ml-button"
								data-media-folder-action="create"
								onClick={() => (editing.value = 'create')}
							>
								{current ? 'New subfolder' : 'New folder'}
							</button>
							{current && (
								<>
									<button
										type="button"
										class="ml-button"
										data-media-folder-action="rename"
										onClick={() => (editing.value = 'rename')}
									>
										Rename
									</button>
									<button
										type="button"
										class="ml-button"
										data-media-folder-action="move"
										onClick={() => (editing.value = 'move')}
									>
										Move
									</button>
									<button
										type="button"
										class="ml-button ml-button--danger"
										data-media-folder-action="delete"
										onClick={async () => {
											try {
												deleting.value = { folder: current, contents: await manage.contents(current.id) };
											} catch {
												// The folder is gone (another tab); the list refreshes on the next change.
											}
										}}
									>
										Delete folder
									</button>
								</>
							)}
						</>
					)}
				</span>
			)}
			{manage && deleting.value && (
				<DeleteFolderDialog
					folder={deleting.value.folder}
					contents={deleting.value.contents}
					onCancel={() => (deleting.value = null)}
					onDelete={async (typed) => {
						const done = await manage.remove(deleting.value?.folder.id ?? '', typed);
						if (done) deleting.value = null;
						return done;
					}}
				/>
			)}
		</div>
	);
}

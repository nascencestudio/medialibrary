/**
 * Folder UI for the media library (ADR 0100): the folder list (a drop target for dragged
 * items; on the Media page each folder has a ⋮ menu: New subfolder, Rename, Move, Delete,
 * and "+ New folder" sits at the bottom), the breadcrumb above the grid, a folder select,
 * and the move and delete dialogs.
 */
import { useSignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
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

/** Folder management (Media page). Each resolves to whether it worked (errors are shown by the caller). */
export interface FolderManage {
	create: (name: string, parentId: string | null) => Promise<boolean>;
	rename: (id: string, name: string) => Promise<boolean>;
	move: (id: string, parentId: string | null) => Promise<boolean>;
	contents: (id: string) => Promise<FolderContents>;
	remove: (id: string, confirm: string) => Promise<boolean>;
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
	/** Folder management: ⋮ menus and "New folder" (Media page only). */
	manage?: FolderManage;
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

type MenuAction = 'subfolder' | 'rename' | 'move' | 'delete';
const MENU: Array<[MenuAction, string]> = [
	['subfolder', 'New subfolder'],
	['rename', 'Rename'],
	['move', 'Move…'],
	['delete', 'Delete folder…'],
];

/**
 * A folder's ⋮ button and menu. The menu is `position: fixed` (placed from the button), so the
 * scrolling folder list doesn't clip it. Arrow keys move between items; Escape, Tab, a click
 * outside or scrolling close it.
 */
function FolderMenu({ folder, onAction }: { folder: MediaFolder; onAction: (action: MenuAction) => void }) {
	const open = useSignal<{ top: number; right: number } | null>(null);
	const button = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
	const close = (refocus = false) => {
		open.value = null;
		if (refocus) button.current?.focus();
	};
	// Layout effect: listeners and focus must be in place before the next input.
	useLayoutEffect(() => {
		if (!open.value) return;
		items()[0]?.focus();
		const outside = (event: Event) => {
			const target = event.target as Node;
			if (!menu.current?.contains(target) && !button.current?.contains(target)) close();
		};
		const away = () => close();
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('scroll', away, true);
		window.addEventListener('resize', away);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('scroll', away, true);
			window.removeEventListener('resize', away);
		};
	}, [open.value !== null]);
	const choose = (action: MenuAction) => {
		close(action !== 'delete' && action !== 'move');
		onAction(action);
	};
	return (
		<>
			<button
				ref={button}
				type="button"
				class="ml-folder-menu-button"
				aria-label={`Actions for "${folder.name}"`}
				title="Folder actions"
				aria-haspopup="menu"
				aria-expanded={open.value !== null}
				data-media-folder-menu={folder.id}
				onClick={() => {
					if (open.value) return close();
					const rect = button.current?.getBoundingClientRect();
					if (rect) open.value = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
				}}
			>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
					<circle cx="8" cy="3.5" r="1.4" fill="currentColor" />
					<circle cx="8" cy="8" r="1.4" fill="currentColor" />
					<circle cx="8" cy="12.5" r="1.4" fill="currentColor" />
				</svg>
			</button>
			{open.value && (
				<div
					ref={menu}
					class="ml-menu"
					role="menu"
					aria-label={`Actions for "${folder.name}"`}
					style={{ top: `${open.value.top}px`, right: `${open.value.right}px` }}
					onKeyDown={(e) => {
						const list = items();
						const index = list.indexOf(document.activeElement as HTMLButtonElement);
						if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
							e.preventDefault();
							const step = e.key === 'ArrowDown' ? 1 : -1;
							list[(index + step + list.length) % list.length]?.focus();
						} else if (e.key === 'Home' || e.key === 'End') {
							e.preventDefault();
							(e.key === 'Home' ? list[0] : list.at(-1))?.focus();
						} else if (e.key === 'Escape') {
							e.preventDefault();
							e.stopPropagation();
							close(true);
						} else if (e.key === 'Tab') {
							close();
						}
					}}
				>
					{MENU.map(([action, label]) => (
						<button
							key={action}
							type="button"
							role="menuitem"
							class={`ml-menu__item${action === 'delete' ? ' ml-menu__item--danger' : ''}`}
							data-media-folder-action={action}
							onClick={() => choose(action)}
							onKeyDown={(e) => {
								// Enter/Space on custom controls: handled explicitly (simulated keys don't click).
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									choose(action);
								}
							}}
						>
							{label}
						</button>
					))}
				</div>
			)}
		</>
	);
}

/** The folder list: All media, Not in a folder, the tree, then "+ New folder" (Media page). */
export function FolderNav({ folders, topLevelCount, total, view, onView, onDropItems, dimEmpty, manage }: NavProps) {
	const over = useSignal<string | null>(null);
	/** An open name field: a new top-level folder, a new subfolder of a folder, or a rename. */
	const editing = useSignal<{ kind: 'create'; parentId: string | null } | { kind: 'rename'; id: string } | null>(null);
	const moving = useSignal<MediaFolder | null>(null);
	const deleting = useSignal<{ folder: MediaFolder; contents: FolderContents } | null>(null);
	const totals = dimEmpty ? subtreeCounts(folders) : null;

	const act = async (folder: MediaFolder, action: MenuAction) => {
		if (!manage) return;
		if (action === 'subfolder') editing.value = { kind: 'create', parentId: folder.id };
		else if (action === 'rename') editing.value = { kind: 'rename', id: folder.id };
		else if (action === 'move') moving.value = folder;
		else {
			try {
				deleting.value = { folder, contents: await manage.contents(folder.id) };
			} catch {
				// The folder is gone (another tab); the list refreshes on the next change.
			}
		}
	};

	const nameField = (field: string, initial: string, depth: number, save: (name: string) => Promise<boolean>) => (
		<li key={`edit-${field}`} class="ml-folder-edit" style={{ paddingInlineStart: `${0.25 + depth * 0.875}rem` }}>
			<NameField
				initial={initial}
				field={field}
				onSubmit={async (name) => {
					if (await save(name)) editing.value = null;
				}}
				onCancel={() => (editing.value = null)}
			/>
		</li>
	);

	const row = (key: string, target: FolderView, label: string, count: number, depth = 0, folder?: MediaFolder) => {
		const dropTarget = onDropItems && target !== 'all' ? (target as string | null) : undefined;
		const empty = totals !== null && (folder ? (totals.get(folder.id) ?? 0) : count) === 0;
		const edit = editing.value;
		if (folder && manage && edit?.kind === 'rename' && edit.id === folder.id) {
			return nameField('rename', folder.name, depth, (name) => manage.rename(folder.id, name));
		}
		return (
			<li
				key={key}
				class={`ml-folder-row${over.value === key ? ' ml-folder--over' : ''}`}
				onDragOver={(e) => {
					if (dropTarget === undefined || !e.dataTransfer?.types.includes(ITEMS_DRAG_TYPE)) return;
					e.preventDefault();
					e.dataTransfer.dropEffect = 'move';
					over.value = key;
				}}
				onDragLeave={(e) => {
					if (over.value === key && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
						over.value = null;
					}
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
				<button
					type="button"
					class={`ml-folder${empty ? ' ml-folder--empty' : ''}`}
					data-media-folder-empty={empty ? '' : undefined}
					style={{ paddingInlineStart: `${0.5 + depth * 0.875}rem` }}
					aria-current={view === target ? 'true' : undefined}
					data-media-folder={folder ? folder.id : key}
					title={folder ? `${label} (${folder.slug})` : label}
					onClick={() => onView(target)}
				>
					{folder && <FolderIcon />}
					<span class="ml-folder__name">{label}</span>
					<span class="ml-folder__count">{count}</span>
				</button>
				{manage &&
					(folder ? (
						<FolderMenu folder={folder} onAction={(action) => void act(folder, action)} />
					) : (
						<span class="ml-folder-menu-spacer" aria-hidden="true" />
					))}
			</li>
		);
	};

	const edit = editing.value;
	return (
		<nav class="ml-folders" aria-label="Folders" data-media-folders>
			<ul>
				{row('all', 'all', 'All media', total)}
				{row('top', null, 'Not in a folder', topLevelCount)}
				{treeOrder(folders).flatMap(({ folder, depth }) => [
					row(folder.id, folder.id, folder.name, folder.itemCount, depth, folder),
					...(manage && edit?.kind === 'create' && edit.parentId === folder.id
						? [nameField('subfolder', '', depth + 1, (name) => manage.create(name, folder.id))]
						: []),
				])}
			</ul>
			{manage && (
				<div class="ml-folders__footer">
					{edit?.kind === 'create' && edit.parentId === null ? (
						<ul>{nameField('create', '', 0, (name) => manage.create(name, null))}</ul>
					) : (
						<button
							type="button"
							class="ml-folders__new"
							data-media-folder-action="create"
							onClick={() => (editing.value = { kind: 'create', parentId: null })}
						>
							<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
								<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
							</svg>
							New folder
						</button>
					)}
				</div>
			)}
			{manage && moving.value && (
				<MoveFolderDialog
					folder={moving.value}
					folders={folders}
					onCancel={() => (moving.value = null)}
					onMove={async (parentId) => {
						const done = await manage.move(moving.value?.id ?? '', parentId);
						if (done) moving.value = null;
						return done;
					}}
				/>
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

interface NameFieldProps {
	initial: string;
	field: string;
	onSubmit: (name: string) => Promise<void>;
	onCancel: () => void;
}

/** A compact name field for the folder list: Enter or ✓ saves, Escape or ✕ cancels. */
function NameField({ initial, field, onSubmit, onCancel }: NameFieldProps) {
	const name = useSignal(initial);
	const busy = useSignal(false);
	const input = useRef<HTMLInputElement>(null);
	useLayoutEffect(() => {
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
				aria-label={field === 'rename' ? 'New folder name' : 'Folder name'}
				placeholder="Folder name"
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
						e.stopPropagation();
						onCancel();
					}
				}}
			/>
			<button
				type="button"
				class="ml-icon-button ml-icon-button--primary"
				aria-label="Save"
				title="Save (Enter)"
				disabled={busy.value || !name.value.trim()}
				data-media-folder-save={field}
				onClick={() => void submit()}
			>
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
					<path
						d="M3 8.5l3.25 3L13 4.5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<button
				type="button"
				class="ml-icon-button"
				aria-label="Cancel"
				title="Cancel (Escape)"
				data-media-folder-cancel={field}
				onClick={onCancel}
			>
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
				</svg>
			</button>
		</span>
	);
}

interface MoveDialogProps {
	folder: MediaFolder;
	folders: readonly MediaFolder[];
	onCancel: () => void;
	onMove: (parentId: string | null) => Promise<boolean>;
}

/** "Move folder": pick where it goes (not into itself or below it). */
function MoveFolderDialog({ folder, folders, onCancel, onMove }: MoveDialogProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const target = useSignal<string | null>(folder.parentId);
	const busy = useSignal(false);
	useLayoutEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	const move = async () => {
		if (busy.value) return;
		busy.value = true;
		try {
			await onMove(target.value);
		} finally {
			busy.value = false;
		}
	};
	return (
		<dialog
			ref={dialog}
			class="ml-confirm-dialog"
			aria-labelledby="ml-move-folder-title"
			data-media-move-folder
			onCancel={(e) => {
				e.preventDefault();
				onCancel();
			}}
		>
			<h2 id="ml-move-folder-title" class="ml-dialog__title">
				Move "{folder.name}"
			</h2>
			<div class="ml-field">
				<span>To</span>
				<FolderSelect
					folders={folders}
					value={target.value}
					exclude={subtree(folder.id, folders)}
					label={`Move "${folder.name}" to`}
					field="folder-move"
					onChange={(parentId) => {
						target.value = parentId;
					}}
				/>
			</div>
			<p class="ml-muted">Its files move on disk too; their links don't change.</p>
			<div class="ml-dialog-actions">
				<button type="button" class="ml-button" data-media-move-folder-cancel onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					class="ml-button ml-button--primary"
					disabled={busy.value || target.value === folder.parentId}
					data-media-move-folder-confirm
					onClick={() => void move()}
				>
					Move
				</button>
			</div>
		</dialog>
	);
}

interface BarProps {
	folders: readonly MediaFolder[];
	view: FolderView;
	onView: (view: FolderView) => void;
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

/** Where you are: a breadcrumb above the grid. */
export function FolderBar({ folders, view, onView }: BarProps) {
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
		</div>
	);
}

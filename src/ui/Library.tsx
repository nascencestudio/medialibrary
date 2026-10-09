/**
 * The media library UI: the dashboard's Media page (`mode: 'manage'`) and the
 * picker dialog (`mode: 'pick'`). Browse, search and filter, upload (button or
 * drag and drop, with progress), add remote videos, edit name, alt text, tags,
 * an image's focal point and a video's captions, replace an item's file, see
 * where an item is used, delete.
 */
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ACCEPTED_EXTENSIONS, extensionOf } from '../detect.js';
import { formatBytes } from '../format.js';
import type { MediaItem, MediaKind } from '../types.js';
import {
	addRemoteVideo,
	defaultUploadSettings,
	deleteMedia,
	getMedia,
	getUploadSettings,
	listMedia,
	listTags,
	MediaApiError,
	type MediaPatch,
	replaceMediaFile,
	sizeLimitFor,
	type Usage,
	updateMedia,
	uploadMedia,
} from './api.js';
import { CaptionsEditor, FocalPointEditor, TagEditor } from './details.js';

export interface LibraryProps {
	mode: 'manage' | 'pick';
	/** Kinds that can be chosen (and uploaded) in pick mode. Default: all. */
	accept?: readonly MediaKind[];
	onPick?: (item: MediaItem) => void;
	onCancel?: () => void;
}

const KIND_LABEL: Record<MediaKind, string> = {
	image: 'Images',
	video: 'Video',
	audio: 'Audio',
	document: 'Documents',
	remoteVideo: 'Remote video',
};
const KIND_SINGULAR: Record<MediaKind, string> = {
	image: 'Image',
	video: 'Video',
	audio: 'Audio',
	document: 'Document',
	remoteVideo: 'Remote video',
};
const ALL_KINDS: MediaKind[] = ['image', 'video', 'audio', 'document', 'remoteVideo'];
const PAGE = 60;

const formatSize = formatBytes;

function KindIcon({ kind }: { kind: MediaKind }) {
	const common = {
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': 1.5,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
	} as const;
	const paths: Record<MediaKind, JSX.Element> = {
		image: <path {...common} d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01" />,
		video: <path {...common} d="M3 6h13v12H3zM16 10l5-3v10l-5-3" />,
		audio: (
			<path {...common} d="M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
		),
		document: <path {...common} d="M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h7" />,
		remoteVideo: <path {...common} d="M3 6h18v12H3zM10 9.5v5l4.5-2.5z" />,
	};
	return (
		<svg class="ml-kind-icon" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
			{paths[kind]}
		</svg>
	);
}

function Thumb({ item }: { item: MediaItem }) {
	if (item.thumbnailUrl) {
		return (
			<img
				class="ml-thumb__img"
				src={item.thumbnailUrl}
				alt=""
				loading="lazy"
				decoding="async"
				referrerpolicy="no-referrer"
			/>
		);
	}
	return <KindIcon kind={item.kind} />;
}

interface Upload {
	key: string;
	name: string;
	progress: number;
	error?: string;
}

export function Library({ mode, accept, onPick, onCancel }: LibraryProps) {
	const kinds = accept && accept.length > 0 ? ALL_KINDS.filter((k) => accept.includes(k)) : ALL_KINDS;
	const filter = useSignal<MediaKind | 'all'>(kinds.length === 1 ? (kinds[0] as MediaKind) : 'all');
	const search = useSignal('');
	const tagFilter = useSignal('');
	const allTags = useSignal<Array<{ tag: string; count: number }>>([]);
	const replacing = useSignal<{ progress: number; error?: string } | null>(null);
	const replaceInput = useRef<HTMLInputElement>(null);
	const items = useSignal<MediaItem[]>([]);
	const total = useSignal(0);
	const loading = useSignal(false);
	const loadError = useSignal('');
	const selected = useSignal<MediaItem | null>(null);
	const usage = useSignal<Usage[] | null>(null);
	const uploads = useSignal<Upload[]>([]);
	const remoteOpen = useSignal(false);
	const remoteUrl = useSignal('');
	const remoteError = useSignal('');
	const confirmDelete = useSignal<Usage[] | null>(null);
	const dragging = useSignal(false);
	const status = useSignal('');
	const fileInput = useRef<HTMLInputElement>(null);
	const sequence = useRef(0);

	const activeKinds = () => (filter.value === 'all' ? kinds : [filter.value]);
	const uploadKinds = kinds.filter((k) => k !== 'remoteVideo');
	const uploadSettings = useSignal(defaultUploadSettings);
	const acceptAttr = uploadKinds
		.flatMap((k) => ACCEPTED_EXTENSIONS[k as Exclude<MediaKind, 'remoteVideo'>])
		.filter((e) => e !== 'svg' || uploadSettings.value.allowSvg)
		.map((e) => `.${e}`)
		.join(',');

	const refreshTags = () =>
		listTags()
			.then(({ tags }) => {
				allTags.value = tags;
				if (tagFilter.value && !tags.some((t) => t.tag === tagFilter.value)) tagFilter.value = '';
			})
			.catch(() => {});

	useEffect(() => {
		void getUploadSettings().then((settings) => {
			uploadSettings.value = settings;
		});
		void refreshTags();
	}, []);

	async function load(append = false) {
		const id = ++sequence.current;
		loading.value = true;
		loadError.value = '';
		try {
			const result = await listMedia({
				kinds: activeKinds(),
				q: search.value.trim(),
				tag: tagFilter.value,
				offset: append ? items.value.length : 0,
				limit: PAGE,
			});
			if (id !== sequence.current) return;
			items.value = append ? [...items.value, ...result.items] : result.items;
			total.value = result.total;
		} catch (cause) {
			if (id === sequence.current) loadError.value = (cause as Error).message;
		} finally {
			if (id === sequence.current) loading.value = false;
		}
	}

	// Reload when the filter changes; search is debounced.
	useEffect(() => {
		const timer = setTimeout(() => load(), search.value ? 250 : 0);
		return () => clearTimeout(timer);
	}, [filter.value, search.value, tagFilter.value]);

	async function select(item: MediaItem) {
		selected.value = item;
		usage.value = null;
		confirmDelete.value = null;
		replacing.value = null;
		try {
			const details = await getMedia(item.id);
			if (selected.value?.id === item.id) {
				selected.value = details.item;
				usage.value = details.usage;
			}
		} catch {
			usage.value = [];
		}
	}

	function replaceItem(item: MediaItem) {
		items.value = items.value.map((i) => (i.id === item.id ? item : i));
		if (selected.value?.id === item.id) selected.value = item;
	}

	async function uploadFiles(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			const key = `${file.name}-${Date.now()}-${Math.random()}`;
			const limit = sizeLimitFor(file, uploadSettings.value.limits);
			if (file.size > limit) {
				uploads.value = [
					...uploads.value,
					{ key, name: file.name, progress: 0, error: `Too large (max ${formatSize(limit)})` },
				];
				continue;
			}
			uploads.value = [...uploads.value, { key, name: file.name, progress: 0 }];
			const update = (patch: Partial<Upload>) => {
				uploads.value = uploads.value.map((u) => (u.key === key ? { ...u, ...patch } : u));
			};
			try {
				const item = await uploadMedia(file, (progress) => update({ progress }));
				uploads.value = uploads.value.filter((u) => u.key !== key);
				status.value = `Uploaded ${item.name}.`;
				if (activeKinds().includes(item.kind)) {
					items.value = [item, ...items.value];
					total.value += 1;
				}
				if (mode === 'pick' && !kinds.includes(item.kind)) continue;
				void select(item);
			} catch (cause) {
				update({ error: (cause as Error).message });
			}
		}
	}

	async function addRemote(event: Event) {
		event.preventDefault();
		remoteError.value = '';
		try {
			const { item } = await addRemoteVideo(remoteUrl.value);
			remoteUrl.value = '';
			remoteOpen.value = false;
			status.value = `Added ${item.name}.`;
			if (activeKinds().includes('remoteVideo')) {
				items.value = [item, ...items.value];
				total.value += 1;
			}
			void select(item);
		} catch (cause) {
			remoteError.value = (cause as Error).message;
		}
	}

	async function save(patch: MediaPatch) {
		const item = selected.value;
		if (!item) return;
		const onlyText = patch.tags === undefined && patch.focalPoint === undefined;
		if (onlyText && (patch.name ?? item.name) === item.name && (patch.alt ?? item.alt) === item.alt) return;
		try {
			const { item: updated } = await updateMedia(item.id, patch);
			replaceItem(updated);
			status.value = 'Saved.';
			if (patch.tags) void refreshTags();
		} catch (cause) {
			status.value = (cause as Error).message;
		}
	}

	async function replaceFile(file: File) {
		const item = selected.value;
		if (!item || item.kind === 'remoteVideo') return;
		const limit = uploadSettings.value.limits[item.kind];
		if (file.size > limit) {
			replacing.value = { progress: 0, error: `Too large (max ${formatSize(limit)})` };
			return;
		}
		replacing.value = { progress: 0 };
		try {
			const updated = await replaceMediaFile(item.id, file, (progress) => (replacing.value = { progress }));
			replacing.value = null;
			replaceItem(updated);
			status.value = `Replaced the file of ${updated.name}.`;
		} catch (cause) {
			replacing.value = { progress: 0, error: (cause as Error).message };
		}
	}

	async function remove(force: boolean) {
		const item = selected.value;
		if (!item) return;
		try {
			await deleteMedia(item.id, force);
			items.value = items.value.filter((i) => i.id !== item.id);
			total.value = Math.max(0, total.value - 1);
			selected.value = null;
			confirmDelete.value = null;
			status.value = `Deleted ${item.name}.`;
		} catch (cause) {
			if (cause instanceof MediaApiError && cause.status === 409) confirmDelete.value = cause.usage;
			else status.value = (cause as Error).message;
		}
	}

	const item = selected.value;
	const pickable = item && kinds.includes(item.kind);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a drop target for files; keyboard users use the Upload button
		<div
			class={`ml-library ml-library--${mode}${dragging.value ? ' ml-library--dragging' : ''}`}
			data-media-library={mode}
			onDragOver={(e) => {
				if (uploadKinds.length === 0 || !e.dataTransfer?.types.includes('Files')) return;
				e.preventDefault();
				dragging.value = true;
			}}
			onDragLeave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragging.value = false;
			}}
			onDrop={(e) => {
				if (!e.dataTransfer?.files.length) return;
				e.preventDefault();
				dragging.value = false;
				void uploadFiles(e.dataTransfer.files);
			}}
		>
			<div class="ml-toolbar">
				<input
					class="ml-input ml-search"
					type="search"
					placeholder="Search by name"
					aria-label="Search media by name"
					value={search.value}
					onInput={(e) => {
						search.value = e.currentTarget.value;
					}}
					onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
				/>
				{allTags.value.length > 0 && (
					<select
						class="ml-input ml-tag-filter"
						aria-label="Filter by tag"
						value={tagFilter.value}
						data-media-tag-filter
						onChange={(e) => {
							tagFilter.value = e.currentTarget.value;
						}}
					>
						<option value="">All tags</option>
						{allTags.value.map(({ tag, count }) => (
							<option key={tag} value={tag}>
								{tag} ({count})
							</option>
						))}
					</select>
				)}
				{kinds.length > 1 && (
					// biome-ignore lint/a11y/useSemanticElements: a button group, not form fields
					<div class="ml-filters" role="group" aria-label="Filter by type">
						{(['all', ...kinds] as const).map((kind) => (
							<button
								key={kind}
								type="button"
								class="ml-filter"
								aria-pressed={filter.value === kind}
								data-media-filter={kind}
								onClick={() => {
									filter.value = kind;
								}}
							>
								{kind === 'all' ? 'All' : KIND_LABEL[kind]}
							</button>
						))}
					</div>
				)}
				<span class="ml-toolbar__spacer" />
				{kinds.includes('remoteVideo') && (
					<button
						type="button"
						class="ml-button"
						data-media-add-remote
						onClick={() => (remoteOpen.value = !remoteOpen.value)}
					>
						Add video link
					</button>
				)}
				{uploadKinds.length > 0 && (
					<>
						<button
							type="button"
							class="ml-button ml-button--primary"
							data-media-upload
							onClick={() => fileInput.current?.click()}
						>
							Upload
						</button>
						<input
							ref={fileInput}
							type="file"
							multiple
							accept={acceptAttr}
							hidden
							data-media-file-input
							onChange={(e) => {
								const files = e.currentTarget.files;
								if (files?.length) void uploadFiles(files);
								e.currentTarget.value = '';
							}}
						/>
					</>
				)}
			</div>

			{remoteOpen.value && (
				<form class="ml-remote" onSubmit={addRemote} data-media-remote-form>
					<input
						class="ml-input"
						type="url"
						required
						placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…"
						aria-label="YouTube or Vimeo link"
						value={remoteUrl.value}
						onInput={(e) => {
							remoteUrl.value = e.currentTarget.value;
						}}
					/>
					<button type="submit" class="ml-button ml-button--primary">
						Add
					</button>
					{remoteError.value && (
						<p class="ml-error" role="alert">
							{remoteError.value}
						</p>
					)}
				</form>
			)}

			{uploads.value.length > 0 && (
				<ul class="ml-uploads" aria-label="Uploads">
					{uploads.value.map((u) => (
						<li key={u.key} class="ml-upload" data-media-upload-state={u.error ? 'error' : 'busy'}>
							<span class="ml-upload__name">{u.name}</span>
							{u.error ? (
								<>
									<span class="ml-error" role="alert">
										{u.error}
									</span>
									<button
										type="button"
										class="ml-link"
										onClick={() => (uploads.value = uploads.value.filter((x) => x.key !== u.key))}
									>
										Dismiss
									</button>
								</>
							) : (
								<progress max={1} value={u.progress} aria-label={`Uploading ${u.name}`} />
							)}
						</li>
					))}
				</ul>
			)}

			<div class="ml-body">
				<div class="ml-grid-wrap">
					{loadError.value && (
						<p class="ml-error" role="alert">
							{loadError.value}
						</p>
					)}
					{!loading.value && items.value.length === 0 && !loadError.value && (
						<div class="ml-empty">
							<p>{search.value || tagFilter.value ? 'Nothing matches that search.' : 'No media yet.'}</p>
							{uploadKinds.length > 0 && <p class="ml-muted">Drop files here or use Upload.</p>}
						</div>
					)}
					<ul class="ml-grid" aria-label="Media items">
						{items.value.map((media) => (
							<li key={media.id}>
								<button
									type="button"
									class="ml-card"
									aria-pressed={selected.value?.id === media.id}
									data-media-item={media.id}
									title={media.name}
									onClick={() => select(media)}
									onDblClick={() => mode === 'pick' && kinds.includes(media.kind) && onPick?.(media)}
								>
									<span class="ml-thumb">
										<Thumb item={media} />
									</span>
									<span class="ml-card__name">{media.name}</span>
									<span class="ml-card__kind">{KIND_SINGULAR[media.kind]}</span>
								</button>
							</li>
						))}
					</ul>
					{items.value.length < total.value && (
						<button type="button" class="ml-button ml-more" disabled={loading.value} onClick={() => load(true)}>
							{loading.value ? 'Loading…' : `Load more (${total.value - items.value.length})`}
						</button>
					)}
				</div>

				{item && (
					<aside class="ml-details" aria-label="Media details" data-media-details={item.id}>
						<div class="ml-preview">
							{item.kind === 'image' && (
								<FocalPointEditor
									key={`focal-${item.id}`}
									item={item}
									onChange={(focalPoint) => void save({ focalPoint })}
								/>
							)}
							{item.kind === 'video' && (
								// biome-ignore lint/a11y/useMediaCaption: the item's caption tracks are added below (the rule can't see mapped tracks)
								<video key={`${item.id}-${item.url}`} src={item.url} controls preload="metadata">
									{item.tracks.map((track) => (
										<track
											key={track.id}
											kind={track.kind}
											src={track.url}
											srclang={track.srclang}
											label={track.label}
										/>
									))}
								</video>
							)}
							{/* biome-ignore lint/a11y/useMediaCaption: a dashboard preview of the uploaded file */}
							{item.kind === 'audio' && <audio src={item.url} controls preload="metadata" />}
							{item.kind === 'remoteVideo' &&
								(item.thumbnailUrl ? (
									<img src={item.thumbnailUrl} alt="" referrerpolicy="no-referrer" />
								) : (
									<KindIcon kind={item.kind} />
								))}
							{item.kind === 'document' && <KindIcon kind={item.kind} />}
						</div>
						<label class="ml-field">
							<span>Name</span>
							<input
								key={`name-${item.id}`}
								class="ml-input"
								defaultValue={item.name}
								data-media-field="name"
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										e.currentTarget.blur();
									}
								}}
								onBlur={(e) => {
									const name = e.currentTarget.value.trim();
									if (name) void save({ name });
									else e.currentTarget.value = item.name;
								}}
							/>
						</label>
						{item.kind === 'image' && (
							<label class="ml-field">
								<span>Alternative text</span>
								<textarea
									key={`alt-${item.id}`}
									class="ml-input"
									rows={2}
									defaultValue={item.alt}
									data-media-field="alt"
									placeholder="Describe the image for people who can't see it. Leave empty if it's decorative."
									onBlur={(e) => void save({ alt: e.currentTarget.value })}
								/>
							</label>
						)}
						<TagEditor
							key={`tags-${item.id}`}
							item={item}
							suggestions={allTags.value.map((t) => t.tag)}
							onChange={(tags) => void save({ tags })}
						/>
						{item.kind === 'video' && <CaptionsEditor key={`captions-${item.id}`} item={item} onItem={replaceItem} />}
						<dl class="ml-info">
							<dt>Type</dt>
							<dd>
								{item.kind === 'remoteVideo'
									? `${item.provider === 'vimeo' ? 'Vimeo' : 'YouTube'} video`
									: item.mime.split(';')[0]}
							</dd>
							{item.size > 0 && (
								<>
									<dt>Size</dt>
									<dd>{formatSize(item.size)}</dd>
								</>
							)}
							{item.width && item.height && (
								<>
									<dt>Dimensions</dt>
									<dd>
										{item.width} × {item.height}
									</dd>
								</>
							)}
							<dt>Added</dt>
							<dd>
								{new Date(item.createdAt).toLocaleString()}
								{item.createdBy ? ` by ${item.createdBy}` : ''}
							</dd>
							<dt>Link</dt>
							<dd class="ml-info__url">
								<a href={item.url} target="_blank" rel="noopener noreferrer">
									{item.url}
								</a>
								<button
									type="button"
									class="ml-link"
									onClick={() =>
										navigator.clipboard
											?.writeText(new URL(item.url, location.href).href)
											.then(() => (status.value = 'Link copied.'))
									}
								>
									Copy
								</button>
							</dd>
						</dl>
						<div class="ml-usage" data-media-usage>
							<strong>Used on</strong>
							{usage.value === null ? (
								<span class="ml-muted"> checking…</span>
							) : usage.value.length === 0 ? (
								<span class="ml-muted"> no pages</span>
							) : (
								<ul>
									{usage.value.map((u) => (
										<li key={u.pageId}>{u.title}</li>
									))}
								</ul>
							)}
						</div>
						{replacing.value && (
							<div class="ml-replace" data-media-replace-state={replacing.value.error ? 'error' : 'busy'}>
								{replacing.value.error ? (
									<p class="ml-error" role="alert">
										{replacing.value.error}
									</p>
								) : (
									<progress max={1} value={replacing.value.progress} aria-label="Replacing the file" />
								)}
							</div>
						)}
						{confirmDelete.value ? (
							<div class="ml-confirm" role="alert" data-media-confirm-delete>
								<p>
									"{item.name}" is used on {confirmDelete.value.length} page
									{confirmDelete.value.length === 1 ? '' : 's'}. Deleting it leaves a gap there.
								</p>
								<button
									type="button"
									class="ml-button ml-button--danger"
									data-media-delete-confirm
									onClick={() => remove(true)}
								>
									Delete anyway
								</button>
								<button type="button" class="ml-button" onClick={() => (confirmDelete.value = null)}>
									Keep
								</button>
							</div>
						) : (
							<div class="ml-actions">
								{mode === 'pick' && (
									<button
										type="button"
										class="ml-button ml-button--primary"
										disabled={!pickable}
										data-media-pick
										onClick={() => item && onPick?.(item)}
									>
										{pickable ? 'Select' : `Can't use ${KIND_SINGULAR[item.kind].toLowerCase()} here`}
									</button>
								)}
								{item.kind !== 'remoteVideo' && (
									<>
										<button
											type="button"
											class="ml-button"
											data-media-replace
											disabled={Boolean(replacing.value && !replacing.value.error)}
											onClick={() => replaceInput.current?.click()}
										>
											Replace file
										</button>
										<input
											ref={replaceInput}
											type="file"
											hidden
											accept={ACCEPTED_EXTENSIONS[item.kind]
												.filter((e) => e !== 'svg' || uploadSettings.value.allowSvg || extensionOf(item.url) === 'svg')
												.map((e) => `.${e}`)
												.join(',')}
											data-media-replace-input
											onChange={(e) => {
												const file = e.currentTarget.files?.[0];
												e.currentTarget.value = '';
												if (file) void replaceFile(file);
											}}
										/>
									</>
								)}
								<button
									type="button"
									class="ml-button ml-button--danger"
									data-media-delete
									onClick={() => remove(false)}
								>
									Delete
								</button>
							</div>
						)}
					</aside>
				)}
			</div>

			{mode === 'pick' && (
				<div class="ml-footer">
					<button type="button" class="ml-button" data-media-cancel onClick={() => onCancel?.()}>
						Cancel
					</button>
				</div>
			)}
			<p class="ml-status" aria-live="polite">
				{status.value}
			</p>
		</div>
	);
}

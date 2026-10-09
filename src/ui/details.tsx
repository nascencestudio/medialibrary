/**
 * Editors in the media details panel: tags, an image's focal point, and a
 * video's caption tracks. Used by Library.tsx. No `name` attributes and only
 * `type="button"` buttons: the picker can open on top of StudioCMS's page form,
 * which saves unknown named fields and submits on Enter.
 */
import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { focalPosition, normalizeTag } from '../meta.js';
import { normalizeLanguage, type TrackKind } from '../subtitles.js';
import type { FocalPoint, MediaItem } from '../types.js';
import { addTrack, deleteTrack } from './api.js';

const stopEnter = (e: KeyboardEvent) => {
	if (e.key === 'Enter') e.preventDefault();
};

export function TagEditor({
	item,
	suggestions,
	onChange,
}: {
	item: MediaItem;
	suggestions: readonly string[];
	onChange: (tags: string[]) => void;
}) {
	const draft = useSignal('');
	const error = useSignal('');
	const listId = `ml-tag-suggestions-${item.id}`;

	function add(raw: string) {
		const parts = raw
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean);
		if (parts.length === 0) return;
		const next = new Set(item.tags);
		for (const part of parts) {
			const tag = normalizeTag(part);
			if (!tag) {
				error.value = `"${part}" can't be a tag: use letters, numbers, spaces, - and _ (up to 40 characters).`;
				return;
			}
			next.add(tag);
		}
		error.value = '';
		draft.value = '';
		if (next.size !== item.tags.length) onChange([...next]);
	}

	return (
		<div class="ml-field" data-media-tags>
			<span id={`${listId}-label`}>Tags</span>
			<div class="ml-tags">
				{item.tags.map((tag) => (
					<span key={tag} class="ml-tag" data-media-tag={tag}>
						{tag}
						<button
							type="button"
							class="ml-tag__remove"
							aria-label={`Remove tag ${tag}`}
							onClick={() => onChange(item.tags.filter((t) => t !== tag))}
						>
							×
						</button>
					</span>
				))}
				<input
					class="ml-input ml-tags__input"
					value={draft.value}
					list={listId}
					aria-labelledby={`${listId}-label`}
					placeholder={item.tags.length ? 'Add a tag' : 'Add tags, e.g. "team", "homepage"'}
					data-media-tag-input
					onInput={(e) => {
						const value = e.currentTarget.value;
						if (value.endsWith(',')) add(value);
						else draft.value = value;
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							add(draft.value);
						} else if (e.key === 'Backspace' && !draft.value && item.tags.length) {
							onChange(item.tags.slice(0, -1));
						}
					}}
					onBlur={() => add(draft.value)}
				/>
				<datalist id={listId}>
					{suggestions
						.filter((s) => !item.tags.includes(s))
						.map((s) => (
							<option key={s} value={s} />
						))}
				</datalist>
			</div>
			{error.value && (
				<p class="ml-error" role="alert">
					{error.value}
				</p>
			)}
		</div>
	);
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

export function FocalPointEditor({
	item,
	onChange,
}: {
	item: MediaItem;
	onChange: (point: FocalPoint | null) => void;
}) {
	const point = item.focalPoint;
	const position = focalPosition(point);
	const current = point ?? { x: 50, y: 50 };

	function fromPointer(e: MouseEvent) {
		const img = (e.currentTarget as HTMLElement).querySelector('img');
		if (!img) return;
		const box = img.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return;
		onChange({
			x: clamp(((e.clientX - box.left) / box.width) * 100),
			y: clamp(((e.clientY - box.top) / box.height) * 100),
		});
	}

	function onKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 10 : 2;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step],
		};
		const move = moves[e.key];
		if (!move) return;
		e.preventDefault();
		onChange({ x: clamp(current.x + move[0]), y: clamp(current.y + move[1]) });
	}

	return (
		<div class="ml-focal" data-media-focal>
			<button
				type="button"
				class="ml-focal__target"
				aria-label={`Focal point ${point ? `${point.x}% from the left, ${point.y}% from the top` : 'not set (center)'}. Click the important part of the image, or use the arrow keys.`}
				onClick={fromPointer}
				onKeyDown={onKey}
			>
				<img src={item.url} alt={item.alt} />
				<span class="ml-focal__marker" style={{ left: `${current.x}%`, top: `${current.y}%` }} aria-hidden="true" />
			</button>
			<div class="ml-focal__bar">
				<span class="ml-muted">
					{point ? 'Focal point set: crops keep this spot.' : 'Click the image to set the spot crops should keep.'}
				</span>
				{point && (
					<button type="button" class="ml-link" data-media-focal-reset onClick={() => onChange(null)}>
						Reset
					</button>
				)}
			</div>
			<div class="ml-focal__crops" aria-hidden="true">
				<img
					src={item.thumbnailUrl ?? item.url}
					alt=""
					class="ml-focal__crop ml-focal__crop--wide"
					style={{ objectPosition: position }}
				/>
				<img
					src={item.thumbnailUrl ?? item.url}
					alt=""
					class="ml-focal__crop ml-focal__crop--square"
					style={{ objectPosition: position }}
				/>
				<img
					src={item.thumbnailUrl ?? item.url}
					alt=""
					class="ml-focal__crop ml-focal__crop--tall"
					style={{ objectPosition: position }}
				/>
			</div>
		</div>
	);
}

export function CaptionsEditor({ item, onItem }: { item: MediaItem; onItem: (item: MediaItem) => void }) {
	const srclang = useSignal('');
	const label = useSignal('');
	const kind = useSignal<TrackKind>('subtitles');
	const busy = useSignal(false);
	const error = useSignal('');
	const fileInput = useRef<HTMLInputElement>(null);

	function choose() {
		error.value = '';
		if (!normalizeLanguage(srclang.value)) {
			error.value = 'Enter a language code first, like "en" or "pt-BR".';
			return;
		}
		if (!label.value.trim()) {
			error.value = 'Enter a label first, like "English".';
			return;
		}
		fileInput.current?.click();
	}

	async function upload(file: File) {
		busy.value = true;
		error.value = '';
		try {
			const { item: updated } = await addTrack(item.id, file, {
				srclang: srclang.value.trim(),
				label: label.value.trim(),
				kind: kind.value,
			});
			srclang.value = '';
			label.value = '';
			onItem(updated);
		} catch (cause) {
			error.value = (cause as Error).message;
		} finally {
			busy.value = false;
		}
	}

	async function remove(trackId: string) {
		error.value = '';
		try {
			onItem((await deleteTrack(item.id, trackId)).item);
		} catch (cause) {
			error.value = (cause as Error).message;
		}
	}

	return (
		<div class="ml-captions" data-media-captions>
			<strong>Captions and subtitles</strong>
			{item.tracks.length === 0 ? (
				<p class="ml-muted">None yet. Add a WebVTT (.vtt) or SubRip (.srt) file.</p>
			) : (
				<ul class="ml-captions__list">
					{item.tracks.map((track) => (
						<li key={track.id} data-media-track={track.id}>
							<span>
								{track.label}{' '}
								<span class="ml-muted">
									({track.srclang}, {track.kind})
								</span>
							</span>
							<button
								type="button"
								class="ml-link"
								onClick={() => remove(track.id)}
								aria-label={`Remove ${track.label}`}
							>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
			<div class="ml-captions__add">
				<input
					class="ml-input"
					value={srclang.value}
					placeholder="Language (en)"
					aria-label="Caption language code, like en or pt-BR"
					maxLength={20}
					data-media-track-lang
					onInput={(e) => (srclang.value = e.currentTarget.value)}
					onKeyDown={stopEnter}
				/>
				<input
					class="ml-input"
					value={label.value}
					placeholder="Label (English)"
					aria-label="Caption label shown in the player"
					maxLength={80}
					data-media-track-label
					onInput={(e) => (label.value = e.currentTarget.value)}
					onKeyDown={stopEnter}
				/>
				<select
					class="ml-input"
					value={kind.value}
					aria-label="Caption kind"
					data-media-track-kind
					onChange={(e) => (kind.value = e.currentTarget.value as TrackKind)}
				>
					<option value="subtitles">Subtitles</option>
					<option value="captions">Captions (with sounds)</option>
				</select>
				<button type="button" class="ml-button" disabled={busy.value} data-media-track-add onClick={choose}>
					{busy.value ? 'Adding…' : 'Add file…'}
				</button>
				<input
					ref={fileInput}
					type="file"
					accept=".vtt,.srt"
					hidden
					data-media-track-file
					onChange={(e) => {
						const file = e.currentTarget.files?.[0];
						e.currentTarget.value = '';
						if (file) void upload(file);
					}}
				/>
			</div>
			{error.value && (
				<p class="ml-error" role="alert">
					{error.value}
				</p>
			)}
		</div>
	);
}

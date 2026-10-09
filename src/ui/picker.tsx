/**
 * The media picker (`@nascencestudio/medialibrary/picker`): opens the library
 * in a modal dialog and resolves with the chosen item, or null if cancelled.
 * For other plugins' editors (e.g. Tapestry's media fields and toolbar).
 */
import { render } from 'preact';
import type { MediaItem, MediaKind } from '../types.js';
import { getMedia } from './api.js';
import { Library } from './Library.js';
import { ensureStyles } from './styles.js';

export type { MediaItem, MediaKind } from '../types.js';

export interface PickerOptions {
	/** Kinds that can be chosen. Default: all. */
	accept?: readonly MediaKind[];
	/** Dialog title. */
	title?: string;
}

export async function openMediaPicker(options: PickerOptions = {}): Promise<MediaItem | null> {
	await ensureStyles();
	return new Promise((resolve) => {
		const dialog = document.createElement('dialog');
		dialog.className = 'ml-dialog';
		dialog.setAttribute('aria-label', options.title ?? 'Choose media');
		dialog.setAttribute('data-media-picker', '');
		const heading = document.createElement('h2');
		heading.className = 'ml-dialog__title';
		heading.textContent = options.title ?? 'Choose media';
		const host = document.createElement('div');
		dialog.append(heading, host);
		document.body.append(dialog);

		let done = false;
		const finish = (item: MediaItem | null) => {
			if (done) return;
			done = true;
			render(null, host);
			dialog.close();
			dialog.remove();
			resolve(item);
		};
		dialog.addEventListener('cancel', (event) => {
			event.preventDefault();
			finish(null);
		});
		render(
			<Library mode="pick" accept={options.accept} onPick={(item) => finish(item)} onCancel={() => finish(null)} />,
			host,
		);
		dialog.showModal();
	});
}

/** Look up one item (for showing a chosen item's name or thumbnail in an editor). */
export async function fetchMediaItem(id: string): Promise<MediaItem | null> {
	try {
		return (await getMedia(id)).item;
	} catch {
		return null;
	}
}

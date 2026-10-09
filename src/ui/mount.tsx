/**
 * Entry for the dashboard Media page (LibraryPage.astro).
 */
import { render } from 'preact';
import { Library } from './Library.js';
import { ensureStyles } from './styles.js';

const MOUNTED = 'mediaLibraryMounted';

export function mountLibrary(host: HTMLElement): (() => void) | undefined {
	if (host.dataset[MOUNTED]) return undefined;
	host.dataset[MOUNTED] = 'true';
	let active = true;
	void ensureStyles().then(() => {
		if (active) render(<Library mode="manage" />, host);
	});
	return () => {
		active = false;
		render(null, host);
		delete host.dataset[MOUNTED];
	};
}

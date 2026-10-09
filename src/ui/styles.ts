/**
 * Loads the library's stylesheet when the library or the picker opens.
 *
 * Not a plain `import './library.css'`: Astro attaches CSS imported by browser
 * scripts to every page it believes includes the script, and through
 * StudioCMS's module graph that was every page of the site, public pages
 * included (docs/known-issues.md #33). A `<link>` to the built file (`?url`)
 * keeps it to the dashboard, and works under a strict CSP (same-origin URL).
 */
import href from './library.css?url';

let loading: Promise<void> | null = null;

/** Add the stylesheet once; resolves when it's loaded (or failed), so content doesn't flash unstyled. */
export function ensureStyles(): Promise<void> {
	if (loading) return loading;
	const existing = document.querySelector<HTMLLinkElement>('link[data-media-library-css]');
	if (existing) {
		loading = Promise.resolve();
		return loading;
	}
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	link.dataset.mediaLibraryCss = '';
	loading = new Promise((resolve) => {
		link.addEventListener('load', () => resolve(), { once: true });
		link.addEventListener('error', () => resolve(), { once: true });
	});
	document.head.append(link);
	return loading;
}

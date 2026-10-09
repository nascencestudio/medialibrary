/**
 * Where media is used: a badge on each card with the number of pages that use the item
 * (a button: it opens the list of those pages), and the page list itself (also used in the
 * delete-folder confirmation). Deleting something in use leaves gaps on the site, so this
 * stays visible.
 */
import { useSignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { getMedia, type Usage } from './api.js';

/** The dashboard's base path ("/dashboard"): the first segment of the current dashboard URL. */
const dashboardBase = () => `/${location.pathname.split('/')[1] ?? 'dashboard'}`;
const editUrl = (pageId: string) => `${dashboardBase()}/content-management/edit?edit=${encodeURIComponent(pageId)}`;

/** Pages, each linking to its editor (new tab: the library stays open). */
export function PageList({ pages, more = false }: { pages: readonly Usage[]; more?: boolean }) {
	return (
		<ul class="ml-page-list">
			{pages.map((page) => (
				<li key={page.pageId}>
					<a href={editUrl(page.pageId)} target="_blank" rel="noopener">
						{page.title || page.slug}
					</a>{' '}
					<span class="ml-muted">/{page.slug === 'index' ? '' : page.slug}</span>
				</li>
			))}
			{more && <li class="ml-muted">…and more</li>}
		</ul>
	);
}

function PagesIcon() {
	return (
		<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
			<path
				d="M5 1.5h6.5v9H5zM3 4v10.5h7"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/** The usage badge for one item (render it only when `count` > 0). */
export function UsageBadge({ itemId, itemName, count }: { itemId: string; itemName: string; count: number }) {
	const open = useSignal(false);
	const pages = useSignal<Usage[] | null>(null);
	const failed = useSignal(false);
	const root = useRef<HTMLSpanElement>(null);
	const label = `Used on ${count} page${count === 1 ? '' : 's'}`;

	// Close on a click outside or Escape. A layout effect: the listener must be in place before
	// the next click (a passive effect can run late).
	useLayoutEffect(() => {
		if (!open.value) return;
		const outside = (event: Event) => {
			if (!root.current?.contains(event.target as Node)) open.value = false;
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				// Only the list closes, not a dialog around it (the picker).
				event.preventDefault();
				event.stopPropagation();
				open.value = false;
				root.current?.querySelector<HTMLButtonElement>('.ml-usage-badge')?.focus();
			}
		};
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', onKey, true);
		};
	}, [open.value]);

	const toggle = async () => {
		open.value = !open.value;
		if (!open.value) return;
		failed.value = false;
		try {
			pages.value = (await getMedia(itemId)).usage;
		} catch {
			failed.value = true;
		}
	};

	return (
		<span class="ml-usage-anchor" ref={root}>
			<button
				type="button"
				class="ml-usage-badge"
				aria-label={`${label}: show where "${itemName}" is used`}
				title={label}
				aria-expanded={open.value}
				data-media-usage-badge={count}
				onClick={() => void toggle()}
			>
				<PagesIcon />
				{count}
			</button>
			{open.value && (
				<div class="ml-usage-popover" role="dialog" aria-label={`Where "${itemName}" is used`} data-media-usage-list>
					<div class="ml-usage-popover__head">
						<strong>{label}</strong>
						<button type="button" class="ml-link" aria-label="Close" onClick={() => (open.value = false)}>
							✕
						</button>
					</div>
					{failed.value ? (
						<p class="ml-error">Couldn't load the pages.</p>
					) : pages.value === null ? (
						<p class="ml-muted">Loading…</p>
					) : (
						<PageList pages={pages.value} />
					)}
				</div>
			)}
		</span>
	);
}

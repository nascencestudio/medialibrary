/**
 * POST /_media/settings/variants: make resized copies for existing images that
 * have none (images uploaded before resizing existed, or whose resizing
 * failed). Works for up to ~20 seconds per request, then redirects back to the
 * settings page with how many were made and how many remain (the admin can
 * run it again). Admins only; same-origin only.
 */
/// <reference path="../virtual.d.ts" />

import config from 'virtual:medialibrary/config';
import type { APIRoute } from 'astro';
import { RESIZABLE_MIMES } from '../responsive.js';
import { imagesMissingVariants, variantsOf } from './db.js';
import { addVariants } from './images.js';
import { getMediaViewer } from './viewer.js';

export const prerender = false;

const BUDGET_MS = 20_000;

const deny = (status: number, message: string) =>
	new Response(message, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

/** Narrowest image that gets at least one copy (see variantWidths). */
export const minResizableWidth = () => (config.imageWidths[0] ? Math.ceil(config.imageWidths[0] / 0.9) : 0);

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin) return deny(403, 'Cross-origin request refused');
	const viewer = await getMediaViewer(context);
	if (!viewer.isAdmin) return deny(403, 'Admins only');
	const form = new URLSearchParams((await context.request.text()).slice(0, 4096));
	const back = new URL(form.get('return') || '/', context.url);
	const target = back.origin === context.url.origin ? back.pathname : '/';

	let made = 0;
	let remaining = 0;
	if (config.imageWidths.length > 0) {
		const started = Date.now();
		const { rows, total } = await imagesMissingVariants(minResizableWidth(), RESIZABLE_MIMES);
		remaining = total;
		for (const row of rows) {
			if (Date.now() - started > BUDGET_MS) break;
			const updated = await addVariants(row);
			remaining -= 1;
			if (variantsOf(updated).length > 0) made += 1;
		}
		// Images that failed stay without copies; count what's still missing.
		remaining = (await imagesMissingVariants(minResizableWidth(), RESIZABLE_MIMES, 1)).total;
	}
	return new Response(null, {
		status: 303,
		headers: { Location: `${target}?variants=${made}&remaining=${remaining}`, 'Cache-Control': 'no-store' },
	});
};

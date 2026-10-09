/**
 * POST /_media/settings: saves the upload settings form (SettingsPage.astro),
 * then redirects back to it. Admins only; same-origin only (CSRF); small
 * bodies only. Invalid values save nothing and come back as `?error=<kind>,…`.
 */
import type { APIRoute } from 'astro';
import { settingsFromForm } from '../settings.js';
import { saveMediaSettings, settingsBounds } from './settings-store.js';
import { getMediaViewer } from './viewer.js';

export const prerender = false;

const MAX_BODY = 8 * 1024;

const deny = (status: number, message: string) =>
	new Response(message, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin) return deny(403, 'Cross-origin request refused');
	const viewer = await getMediaViewer(context);
	if (!viewer.isAdmin) return deny(403, 'Admins only');
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY) return deny(413, 'Too large');
	const body = await context.request.text();
	if (body.length > MAX_BODY) return deny(413, 'Too large');

	const form = new URLSearchParams(body);
	const back = new URL(form.get('return') || '/', context.url);
	const target = back.origin === context.url.origin ? back.pathname : '/';
	const redirect = (query: string) =>
		new Response(null, { status: 303, headers: { Location: `${target}?${query}`, 'Cache-Control': 'no-store' } });

	const result = settingsFromForm(form, settingsBounds());
	if (!result.ok) return redirect(`error=${Object.keys(result.errors).join(',')}`);
	try {
		await saveMediaSettings(result.settings);
	} catch (error) {
		console.error('[medialibrary] saving settings failed', error);
		return deny(500, 'Saving failed');
	}
	return redirect('saved=1');
};

/**
 * POST /_media/api/remote { url }: add a remote video (YouTube, Vimeo) by URL.
 * Only the provider and the validated video id are stored; the title and
 * thumbnail come from the provider's oEmbed endpoint (built from that id,
 * never from the pasted text). Editors only, same origin only.
 */
import type { APIRoute } from 'astro';
import { isProviderThumbnail, parseRemoteVideo } from '../../remote.js';
import { newMediaId } from '../../types.js';
import { insertRow, type MediaRow, toItem } from '../db.js';
import { FolderError, targetFolder } from '../folders-store.js';
import { error, guard, json, readJson } from '../http.js';

export const prerender = false;

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
const CONTROL = /[\u0000-\u001f\u007f]/g;

async function oembed(url: string): Promise<{ title?: string; thumbnail?: string }> {
	try {
		const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
		if (!response.ok) return {};
		const text = await response.text();
		if (text.length > 64 * 1024) return {};
		const data = JSON.parse(text) as { title?: unknown; thumbnail_url?: unknown };
		return {
			title: typeof data.title === 'string' ? data.title : undefined,
			thumbnail: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
		};
	} catch {
		return {}; // offline or blocked: the video is still added, with a generic name
	}
}

export const POST: APIRoute = async (context) => {
	const viewer = await guard(context);
	if (viewer instanceof Response) return viewer;
	const body = await readJson(context);
	const input = typeof body?.url === 'string' ? body.url : '';
	const video = parseRemoteVideo(input);
	if (!video) return error(400, 'Paste a YouTube or Vimeo video link.');
	let folderId: string | null;
	try {
		folderId = await targetFolder(body?.folderId);
	} catch (cause) {
		if (cause instanceof FolderError) return error(cause.status, cause.message);
		throw cause;
	}

	const info = await oembed(video.oembedUrl);
	const provider = video.provider === 'youtube' ? 'YouTube' : 'Vimeo';
	const name = (info.title ?? '').replace(CONTROL, '').trim().slice(0, 200) || `${provider} video ${video.videoId}`;
	const thumbnail = info.thumbnail && isProviderThumbnail(info.thumbnail) ? info.thumbnail : video.thumbnailUrl;
	const now = new Date().toISOString();
	const row: MediaRow = {
		id: newMediaId(),
		kind: 'remoteVideo',
		name,
		alt: '',
		mime: '',
		size: 0,
		width: null,
		height: null,
		storageKey: null,
		provider: video.provider,
		providerId: video.videoId,
		thumbnailUrl: thumbnail,
		createdAt: now,
		updatedAt: now,
		createdBy: viewer.name,
		tags: '',
		focalX: null,
		focalY: null,
		tracks: '[]',
		variants: '[]',
		folderId,
	};
	try {
		await insertRow(row);
	} catch (cause) {
		console.error('[medialibrary] adding remote video failed', cause);
		return error(500, 'Adding the video failed');
	}
	return json({ item: toItem(row) }, 201);
};

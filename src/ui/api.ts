/// <reference path="../virtual.d.ts" />
/**
 * Browser client for the media API (editors only, same origin).
 */
import config from 'virtual:medialibrary/config';
import type { MediaSettings } from '../settings.js';
import type { FocalPoint, MediaItem, MediaKind, MediaLimits, TrackKind } from '../types.js';

export interface Usage {
	pageId: string;
	title: string;
	slug: string;
}

export class MediaApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly usage: Usage[] = [],
	) {
		super(message);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${config.apiBase}${path}`, { credentials: 'same-origin', ...init });
	if (response.status === 204) return undefined as T;
	const body = (await response.json().catch(() => ({}))) as { error?: string; usage?: Usage[] };
	if (!response.ok)
		throw new MediaApiError(body.error ?? `Request failed (HTTP ${response.status})`, response.status, body.usage);
	return body as T;
}

export function listMedia(query: { kinds?: MediaKind[]; q?: string; tag?: string; offset?: number; limit?: number }) {
	const params = new URLSearchParams();
	if (query.tag) params.set('tag', query.tag);
	if (query.kinds?.length) params.set('kind', query.kinds.join(','));
	if (query.q) params.set('q', query.q);
	if (query.offset) params.set('offset', String(query.offset));
	if (query.limit) params.set('limit', String(query.limit));
	return request<{ items: MediaItem[]; total: number }>(`/items?${params}`);
}

export const getMedia = (id: string) =>
	request<{ item: MediaItem; usage: Usage[] }>(`/items/${encodeURIComponent(id)}`);

export interface MediaPatch {
	name?: string;
	alt?: string;
	tags?: string[];
	focalPoint?: FocalPoint | null;
}

export const updateMedia = (id: string, patch: MediaPatch) =>
	request<{ item: MediaItem }>(`/items/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	});

export const deleteMedia = (id: string, force = false) =>
	request<void>(`/items/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, { method: 'DELETE' });

export const addRemoteVideo = (url: string) =>
	request<{ item: MediaItem }>('/remote', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url }),
	});

export const listTags = () => request<{ tags: Array<{ tag: string; count: number }> }>('/tags');

export const deleteTrack = (id: string, trackId: string) =>
	request<{ item: MediaItem }>(`/items/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`, {
		method: 'DELETE',
	});

/** Add a caption track: a .vtt or .srt file plus its language, label and kind. */
export function addTrack(
	id: string,
	file: File,
	meta: { srclang: string; label: string; kind: TrackKind },
): Promise<{ item: MediaItem }> {
	const params = new URLSearchParams(meta);
	return request(`/items/${encodeURIComponent(id)}/tracks?${params}`, {
		method: 'POST',
		headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
		body: file,
	});
}

/** Replace an item's file (same kind), with progress. */
export const replaceMediaFile = (id: string, file: File, onProgress: (fraction: number) => void) =>
	uploadMedia(file, onProgress, `/items/${encodeURIComponent(id)}/file`);

/** Upload one file with progress (XMLHttpRequest: fetch has no upload progress). */
export function uploadMedia(file: File, onProgress: (fraction: number) => void, path = '/upload'): Promise<MediaItem> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${config.apiBase}${path}`);
		xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total);
		};
		xhr.onload = () => {
			let body: { item?: MediaItem; error?: string } = {};
			try {
				body = JSON.parse(xhr.responseText);
			} catch {
				// non-JSON error page
			}
			if (xhr.status >= 200 && xhr.status < 300 && body.item) resolve(body.item);
			else reject(new MediaApiError(body.error ?? `Upload failed (HTTP ${xhr.status})`, xhr.status));
		};
		xhr.onerror = () => reject(new MediaApiError('Upload failed (network error)', 0));
		xhr.send(file);
	});
}

/** What uploads allow right now (admin settings), with the build-time defaults until it arrives. */
export const defaultUploadSettings: MediaSettings = { limits: config.limits, allowSvg: config.allowSvg };

export async function getUploadSettings(): Promise<MediaSettings> {
	try {
		return (await request<{ settings: MediaSettings }>('/settings')).settings;
	} catch {
		return defaultUploadSettings;
	}
}

/** Client-side size check before uploading (the server checks again). */
export function sizeLimitFor(file: File, limits: MediaLimits): number {
	const type = file.type.split('/')[0];
	if (type === 'image') return limits.image;
	if (type === 'video') return limits.video;
	if (type === 'audio') return limits.audio;
	return limits.document;
}

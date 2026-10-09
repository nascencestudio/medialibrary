/**
 * Remote videos (YouTube, Vimeo): parse a pasted URL into a provider and a
 * validated video id, and build every URL we use from that id, never from the
 * pasted text. Pure functions only.
 */
import type { RemoteProvider } from './types.js';

export interface RemoteVideo {
	provider: RemoteProvider;
	videoId: string;
	/** Canonical page URL. */
	watchUrl: string;
	/** Privacy-friendlier embed URL (youtube-nocookie.com, Vimeo with do-not-track). */
	embedUrl: string;
	/** oEmbed endpoint for the title and thumbnail. */
	oembedUrl: string;
	/** A thumbnail that needs no API call (YouTube only). */
	thumbnailUrl: string | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

const youtube = (id: string): RemoteVideo => ({
	provider: 'youtube',
	videoId: id,
	watchUrl: `https://www.youtube.com/watch?v=${id}`,
	embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
	oembedUrl: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
	thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

const vimeo = (id: string): RemoteVideo => ({
	provider: 'vimeo',
	videoId: id,
	watchUrl: `https://vimeo.com/${id}`,
	embedUrl: `https://player.vimeo.com/video/${id}?dnt=1`,
	oembedUrl: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`,
	thumbnailUrl: null,
});

/** Parse a YouTube or Vimeo URL. Returns null for anything else. */
export function parseRemoteVideo(input: string): RemoteVideo | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
	const parts = url.pathname.split('/').filter(Boolean);

	if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
		const id =
			parts[0] === 'watch'
				? url.searchParams.get('v')
				: ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')
					? parts[1]
					: null;
		return id && YOUTUBE_ID.test(id) ? youtube(id) : null;
	}
	if (host === 'youtu.be') {
		const id = parts[0];
		return id && YOUTUBE_ID.test(id) ? youtube(id) : null;
	}
	if (host === 'vimeo.com') {
		const id = parts.find((p) => VIMEO_ID.test(p));
		return id ? vimeo(id) : null;
	}
	if (host === 'player.vimeo.com' && parts[0] === 'video') {
		const id = parts[1];
		return id && VIMEO_ID.test(id) ? vimeo(id) : null;
	}
	return null;
}

/** Rebuild a remote video from its stored provider and id (e.g. when reading the database). */
export function remoteVideoFrom(provider: string, videoId: string): RemoteVideo | null {
	if (provider === 'youtube' && YOUTUBE_ID.test(videoId)) return youtube(videoId);
	if (provider === 'vimeo' && VIMEO_ID.test(videoId)) return vimeo(videoId);
	return null;
}

/** Thumbnail URLs from oEmbed are only kept for the providers' own image hosts. */
export function isProviderThumbnail(url: string): boolean {
	try {
		const { protocol, hostname } = new URL(url);
		return protocol === 'https:' && (hostname === 'i.ytimg.com' || hostname === 'i.vimeocdn.com');
	} catch {
		return false;
	}
}

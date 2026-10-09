/**
 * Media library types: what a media item is, as stored and as handed to
 * components. See docs/decisions/0016-media-library.md.
 */
import type { FocalPoint } from './meta.js';
import type { TrackKind } from './subtitles.js';

export type { FocalPoint } from './meta.js';
export type { TrackKind } from './subtitles.js';

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'remoteVideo';
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'document', 'remoteVideo'];

export type RemoteProvider = 'youtube' | 'vimeo';

/** A media item as the API and components see it. */
export interface MediaItem {
	/** Stable id, e.g. `m_k3f9x2a8b1c4d7e0`. Content stores this, never the URL. */
	id: string;
	kind: MediaKind;
	/** Human-readable name (the file name, or the remote video's title). */
	name: string;
	/** Alternative text for images (empty for decorative images). */
	alt: string;
	/** MIME type of the stored file (empty for remote videos). */
	mime: string;
	/** Size in bytes (0 for remote videos). */
	size: number;
	width: number | null;
	height: number | null;
	/** Public URL of the file (uploaded items), or the canonical watch URL (remote videos). */
	url: string;
	/** For remote videos: the embed URL (built from the validated video id). */
	embedUrl: string | null;
	/** Preview image: the file itself for images, the provider's thumbnail for remote videos. */
	thumbnailUrl: string | null;
	provider: RemoteProvider | null;
	createdAt: string;
	updatedAt: string;
	createdBy: string | null;
	/** Tags (lowercase), for finding and grouping items. */
	tags: string[];
	/** Images: the spot to keep when the image is cropped, in percent (null: the center). */
	focalPoint: FocalPoint | null;
	/** Uploaded videos: caption and subtitle tracks (WebVTT). */
	tracks: MediaTrack[];
	/** Raster images: smaller copies (WebP), narrowest first. Empty for SVG, GIF and small images. */
	variants: ImageVariant[];
	/** Images: a `srcset` with the variants and the original, or null when there are no variants. */
	srcset: string | null;
	/** The folder the item is in (`f_…`), or null for the top level. */
	folderId: string | null;
}

/** A folder as the API returns it. */
export interface MediaFolder {
	id: string;
	parentId: string | null;
	name: string;
	/** Its directory name on disk (unique among its siblings). */
	slug: string;
	/** Items directly in the folder. */
	itemCount: number;
}

/** A caption or subtitle track of an uploaded video. */
export interface MediaTrack {
	id: string;
	kind: TrackKind;
	/** BCP 47 language, e.g. `en`, `pt-BR`. */
	srclang: string;
	/** What viewers see in the player's menu, e.g. "English". */
	label: string;
	/** Public URL of the WebVTT file. */
	url: string;
}

/** A resized copy of an image. */
export interface ImageVariant {
	url: string;
	width: number;
	height: number;
	mime: string;
}

/** Upload limits per kind, in bytes. */
export interface MediaLimits {
	image: number;
	video: number;
	audio: number;
	document: number;
}

export const DEFAULT_LIMITS: MediaLimits = {
	image: 10 * 1024 * 1024,
	video: 200 * 1024 * 1024,
	audio: 100 * 1024 * 1024,
	document: 25 * 1024 * 1024,
};

/** Media ids: `m_` + 16 lowercase base-36 characters. */
export const MEDIA_ID = /^m_[a-z0-9]{16}$/;

export function newMediaId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `m_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

export const isMediaId = (value: unknown): value is string => typeof value === 'string' && MEDIA_ID.test(value);

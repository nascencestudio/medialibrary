/**
 * @nascencestudio/medialibrary: a media library for StudioCMS. Upload, browse
 * and reuse images (including AVIF and sanitized SVG), video, audio, documents
 * and remote videos (YouTube, Vimeo). See docs/decisions/0016-media-library.md.
 */
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePlugin } from 'studiocms/plugins';
import { normalizeWidths } from './responsive.js';
import { DEFAULT_LIMITS, type MediaLimits } from './types.js';
import { mediaVitePlugin } from './vite.js';

export { ACCEPTED_EXTENSIONS, detectType, extensionOf, mimeForExtension } from './detect.js';
export { imageSize } from './dimensions.js';
export { parseRemoteVideo, remoteVideoFrom } from './remote.js';
export { sanitizeSvg } from './svg.js';
export type * from './types.js';
export { DEFAULT_LIMITS, isMediaId, MEDIA_ID, MEDIA_KINDS } from './types.js';

const PACKAGE_NAME = '@nascencestudio/medialibrary';

export type MediaLibraryPlugin = ReturnType<typeof definePlugin>;

export interface MediaLibraryOptions {
	/**
	 * Where uploaded files are stored: absolute, or relative to the Astro
	 * project root. Default `./data/media`. The `MEDIA_DIR` environment variable
	 * overrides it at runtime (e.g. a Docker volume).
	 */
	storageDir?: string;
	/** URL prefix files are served from. Default `/files`. */
	publicPath?: string;
	/** Upload limits in bytes per kind. Defaults: image 10 MB, video 200 MB, audio 100 MB, document 25 MB. */
	limits?: Partial<MediaLimits>;
	/** Whether SVG uploads (sanitized) are allowed by default. Default true. Admins can change it. */
	allowSvg?: boolean;
	/**
	 * The highest upload limit admins can set, in bytes. Default 1 GB. The
	 * `MEDIA_MAX_UPLOAD_MB` environment variable overrides it at runtime. A
	 * reverse proxy in front of the site has its own body limit (Caddy's
	 * `max_size` in the Docker setup); keep it at least this high.
	 */
	maxUploadSize?: number;
	/**
	 * Widths (px) of the resized copies made of each uploaded image, for
	 * responsive `srcset`s. Default [480, 960, 1440, 1920]; only widths smaller
	 * than the original are made. `[]` turns resizing off.
	 */
	imageWidths?: number[];
}

/** Route of the JSON API (editors only). */
export const API_BASE = '/_media/api';
/** Route of the admins-only settings form endpoint. */
export const SETTINGS_ROUTE = '/_media/settings';

function resolve(path: string): string {
	return fileURLToPath(new URL(path, import.meta.url));
}

/**
 * The media library plugin. Adds a "Media" page to the dashboard, an
 * editors-only API, and public file serving.
 *
 * @example
 * ```js
 * // studiocms.config.mjs
 * import mediaLibrary from '@nascencestudio/medialibrary';
 * export default defineStudioCMSConfig({ plugins: [mediaLibrary()] });
 * ```
 */
export function mediaLibrary(options: MediaLibraryOptions = {}): MediaLibraryPlugin {
	const publicPath = `/${(options.publicPath ?? '/files').replace(/^\/+|\/+$/g, '')}`;
	if (!/^\/[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(publicPath)) {
		throw new Error(`[medialibrary] publicPath "${options.publicPath}" must be a simple URL path like "/files".`);
	}
	const limits = { ...DEFAULT_LIMITS, ...options.limits };
	const maxUploadSize = options.maxUploadSize ?? 1024 * 1024 * 1024;
	for (const [kind, value] of Object.entries({ ...limits, maxUploadSize })) {
		if (!Number.isFinite(value) || value < 1024 * 1024) {
			const name = kind === 'maxUploadSize' ? kind : `limits.${kind}`;
			throw new Error(`[medialibrary] ${name} must be at least 1 MB (in bytes).`);
		}
	}

	return definePlugin({
		identifier: PACKAGE_NAME,
		name: 'Media Library',
		hooks: {
			'studiocms:astro-config': ({ addIntegrations }) => {
				addIntegrations({
					name: PACKAGE_NAME,
					hooks: {
						'astro:config:setup': ({ config, injectRoute, updateConfig }) => {
							const root = fileURLToPath(config.root);
							const dir = options.storageDir ?? './data/media';
							const storageDir = isAbsolute(dir) ? dir : resolvePath(root, dir);
							const routes: Array<[string, string]> = [
								[`${API_BASE}/items`, './runtime/api/items.js'],
								[`${API_BASE}/items/[id]`, './runtime/api/item.js'],
								[`${API_BASE}/items/[id]/file`, './runtime/api/file.js'],
								[`${API_BASE}/items/[id]/tracks`, './runtime/api/tracks.js'],
								[`${API_BASE}/items/[id]/tracks/[trackId]`, './runtime/api/tracks/track.js'],
								[`${API_BASE}/tags`, './runtime/api/tags.js'],
								[`${API_BASE}/folders`, './runtime/api/folders.js'],
								[`${API_BASE}/folders/[id]`, './runtime/api/folders/folder.js'],
								[`${API_BASE}/move`, './runtime/api/move.js'],
								[`${API_BASE}/upload`, './runtime/api/upload.js'],
								[`${API_BASE}/remote`, './runtime/api/remote.js'],
								[`${API_BASE}/settings`, './runtime/api/settings.js'],
								[SETTINGS_ROUTE, './runtime/settings-endpoint.js'],
								[`${SETTINGS_ROUTE}/variants`, './runtime/variants-endpoint.js'],
								// Plugins → Media Library. StudioCMS links plugins without a slash (known issue #27),
								// and plugin dashboard pages make `[dashboard]` routes lose to its catch-all (#28).
								...['/dashboard', '/[dashboard]'].flatMap(
									(base): Array<[string, string]> =>
										[`${base}/plugins/${PACKAGE_NAME}`, `${base}/plugins${PACKAGE_NAME}`].map((pattern) => [
											pattern,
											'./runtime/SettingsPage.astro',
										]),
								),
								[`${publicPath}/[...path]`, './runtime/files.js'],
							];
							for (const [pattern, entrypoint] of routes) {
								injectRoute({ pattern, entrypoint: resolve(entrypoint), prerender: false });
							}
							updateConfig({
								vite: {
									optimizeDeps: {
										include: ['preact', 'preact/hooks', 'preact/jsx-runtime', '@preact/signals'].map(
											(dep) => `${PACKAGE_NAME} > ${dep}`,
										),
									},
									plugins: [
										mediaVitePlugin({
											storageDir,
											publicPath,
											apiBase: API_BASE,
											limits,
											allowSvg: options.allowSvg ?? true,
											maxUploadSize,
											settingsRoute: SETTINGS_ROUTE,
											imageWidths: normalizeWidths(options.imageWidths),
										}),
									],
								},
							});
						},
					},
				});
			},
			'studiocms:dashboard': ({ setDashboard }) => {
				setDashboard({
					translations: {
						en: { '@media/library': { title: 'Media', description: 'Images, video, audio and documents.' } },
					},
					// Lists the plugin under Plugins; the page itself is SettingsPage.astro (own form and endpoint).
					settingsPage: { fields: [], endpoint: resolve('./runtime/settings-onsave.js') },
					dashboardPages: {
						user: [
							{
								title: { en: 'Media' },
								description: 'Upload, browse and manage images, video, audio and documents.',
								route: 'media',
								icon: 'heroicons:photo',
								sidebar: 'single',
								requiredPermissions: 'editor',
								pageBodyComponent: resolve('./runtime/LibraryPage.astro'),
							},
						],
					},
				});
			},
		},
	});
}

export default mediaLibrary;

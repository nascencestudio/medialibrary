/**
 * Virtual module `virtual:medialibrary/config`: runtime settings for the
 * server routes, the dashboard page and the picker.
 */
import type { MediaLimits } from './types.js';

export interface MediaRuntimeConfig {
	/** Absolute directory uploaded files are stored in (overridable at runtime with `MEDIA_DIR`). */
	storageDir: string;
	/** URL prefix files are served from, e.g. `/files`. */
	publicPath: string;
	/** URL prefix of the JSON API, e.g. `/_media/api`. */
	apiBase: string;
	/** Default upload limits (admins can change them in the settings, up to `maxUploadSize`). */
	limits: MediaLimits;
	/** Default for allowing SVG uploads (admin setting). */
	allowSvg: boolean;
	/** Ceiling for every limit, in bytes (overridable at runtime with `MEDIA_MAX_UPLOAD_MB`). */
	maxUploadSize: number;
	/** Route of the admins-only settings form endpoint. */
	settingsRoute: string;
	/** Widths of resized image copies (responsive images), ascending. */
	imageWidths: number[];
}

export const CONFIG_MODULE_ID = 'virtual:medialibrary/config';

export function mediaVitePlugin(config: MediaRuntimeConfig) {
	const resolved = `\0${CONFIG_MODULE_ID}`;
	return {
		name: 'medialibrary:virtual-config',
		resolveId(id: string) {
			return id === CONFIG_MODULE_ID ? resolved : undefined;
		},
		load(id: string) {
			return id === resolved ? `export default ${JSON.stringify(config)};` : undefined;
		},
	};
}

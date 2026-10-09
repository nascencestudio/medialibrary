/**
 * Admin settings for uploads (Plugins → Media Library → Uploads): the size
 * limit per kind and whether SVG uploads are allowed. Pure functions only;
 * stored by runtime/settings-store.ts. See ADR 0018.
 *
 * The developer's `mediaLibrary()` options are the defaults, and
 * `maxUploadSize` is the ceiling no limit can go above: the setting is only as
 * trusted as an admin account, so a typo can't allow multi-gigabyte uploads.
 */
import type { MediaLimits } from './types.js';

export const UPLOAD_KINDS = ['image', 'video', 'audio', 'document'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** What uploads currently allow (the developer defaults with admin settings applied). */
export interface MediaSettings {
	limits: MediaLimits;
	allowSvg: boolean;
}

/** The developer-side bounds settings are cleaned against. */
export interface SettingsBounds {
	/** Defaults from the plugin options. */
	limits: MediaLimits;
	allowSvg: boolean;
	/** No limit can be set above this (bytes). */
	maxUploadSize: number;
}

export const MB = 1024 * 1024;
/** Smallest limit an admin can set. */
export const MIN_LIMIT = MB;

/** Stored shape (StudioCMSPluginData row). Only values an admin changed are meaningful, but all are stored. */
export interface StoredMediaSettings {
	version: 1;
	limits: Partial<MediaLimits>;
	allowSvg?: boolean;
}

/** Form field names on the settings page. */
export const FORM = {
	limit: (kind: UploadKind) => `limit-${kind}`,
	allowSvg: 'allow-svg',
} as const;

const clampLimit = (value: number, bounds: SettingsBounds) =>
	Math.min(Math.max(Math.round(value), MIN_LIMIT), bounds.maxUploadSize);

/** The defaults, held to the ceiling (a default above it is lowered). */
export function defaultSettings(bounds: SettingsBounds): MediaSettings {
	const limits = { ...bounds.limits };
	for (const kind of UPLOAD_KINDS) limits[kind] = clampLimit(limits[kind], bounds);
	return { limits, allowSvg: bounds.allowSvg };
}

/** Effective settings from stored data (anything invalid falls back to the default). */
export function parseMediaSettings(raw: unknown, bounds: SettingsBounds): MediaSettings {
	const settings = defaultSettings(bounds);
	if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== 1) return settings;
	const stored = raw as { limits?: unknown; allowSvg?: unknown };
	if (typeof stored.limits === 'object' && stored.limits !== null) {
		for (const kind of UPLOAD_KINDS) {
			const value = (stored.limits as Record<string, unknown>)[kind];
			if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
				settings.limits[kind] = clampLimit(value, bounds);
			}
		}
	}
	if (typeof stored.allowSvg === 'boolean') settings.allowSvg = stored.allowSvg;
	return settings;
}

export type FormResult =
	| { ok: true; settings: StoredMediaSettings }
	| { ok: false; errors: Partial<Record<string, string>> };

/**
 * Settings from the submitted form. Limits are whole megabytes between 1 and
 * the ceiling; anything else is refused with a message per field (nothing is
 * saved), so a mistake is never silently "fixed" into a different number.
 */
export function settingsFromForm(form: URLSearchParams, bounds: SettingsBounds): FormResult {
	const maxMb = Math.floor(bounds.maxUploadSize / MB);
	const limits: Partial<MediaLimits> = {};
	const errors: Partial<Record<string, string>> = {};
	for (const kind of UPLOAD_KINDS) {
		const text = (form.get(FORM.limit(kind)) ?? '').trim();
		const value = /^\d{1,7}$/.test(text) ? Number(text) : Number.NaN;
		if (!Number.isInteger(value) || value < 1 || value > maxMb) {
			errors[kind] = `Enter a whole number of MB from 1 to ${maxMb}.`;
		} else {
			limits[kind] = value * MB;
		}
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, settings: { version: 1, limits, allowSvg: form.get(FORM.allowSvg) === 'on' } };
}

/** The upload size ceiling: `MEDIA_MAX_UPLOAD_MB` (a positive whole number) wins over the option. */
export function maxUploadSizeFrom(option: number, env: string | undefined): number {
	const fromEnv = env && /^\d{1,7}$/.test(env.trim()) ? Number(env.trim()) * MB : 0;
	return fromEnv >= MB ? fromEnv : option;
}

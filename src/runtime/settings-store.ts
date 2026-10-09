/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * Loads and saves the admin upload settings (settings.ts) in StudioCMS's
 * plugin data table (`StudioCMSPluginData`, row `@nascencestudio/medialibrary-settings`).
 * Server only. See ADR 0018.
 *
 * Goes straight to the table through the SDK's database client: StudioCMS
 * 0.6.1's `usePluginData()` can't save (known issue #25). Every upload reads
 * the settings fresh (one indexed lookup), so a change applies immediately
 * and also across several server processes.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:medialibrary/config';
import {
	defaultSettings,
	type MediaSettings,
	maxUploadSizeFrom,
	parseMediaSettings,
	type SettingsBounds,
	type StoredMediaSettings,
} from '../settings.js';

const ROW_ID = '@nascencestudio/medialibrary-settings';

/** The developer defaults and the ceiling (`MEDIA_MAX_UPLOAD_MB` overrides the option at runtime). */
export function settingsBounds(): SettingsBounds {
	return {
		limits: config.limits,
		allowSvg: config.allowSvg,
		maxUploadSize: maxUploadSizeFrom(config.maxUploadSize, process.env.MEDIA_MAX_UPLOAD_MB),
	};
}

/** The effective settings. If the database can't be read, the developer defaults apply. */
export async function loadMediaSettings(): Promise<MediaSettings> {
	const bounds = settingsBounds();
	try {
		const row = await SDKCoreJs.dbService.db
			.selectFrom('StudioCMSPluginData')
			.select('data')
			.where('id', '=', ROW_ID)
			.executeTakeFirst();
		return row ? parseMediaSettings(JSON.parse(row.data), bounds) : defaultSettings(bounds);
	} catch (error) {
		console.warn('[medialibrary] could not load settings; using the defaults', error);
		return defaultSettings(bounds);
	}
}

export async function saveMediaSettings(settings: StoredMediaSettings): Promise<void> {
	const data = JSON.stringify(settings);
	await SDKCoreJs.dbService.db.transaction().execute(async (trx) => {
		const existing = await trx
			.selectFrom('StudioCMSPluginData')
			.select('id')
			.where('id', '=', ROW_ID)
			.executeTakeFirst();
		if (existing) await trx.updateTable('StudioCMSPluginData').set({ data }).where('id', '=', ROW_ID).execute();
		else await trx.insertInto('StudioCMSPluginData').values({ id: ROW_ID, data }).execute();
	});
	await runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});
}

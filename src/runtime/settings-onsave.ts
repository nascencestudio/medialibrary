/**
 * Required by StudioCMS's `settingsPage` (it lists the media library under the
 * dashboard's Plugins section). The settings page has its own form and
 * endpoint (settings-endpoint.ts), so StudioCMS's generic save isn't used.
 */
export const onSave = () => async () =>
	new Response('Media library settings are saved from the Media Library settings page.', {
		status: 405,
		headers: { 'Content-Type': 'text/plain' },
	});

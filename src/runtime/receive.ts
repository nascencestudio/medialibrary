/**
 * Receiving one uploaded file, shared by new uploads and file replacement:
 * the raw request body is streamed to a temporary file (never buffered whole),
 * the file name comes from the `X-File-Name` header (URI-encoded), the type is
 * detected from the contents and must match the name, the kind's size limit
 * and the SVG setting apply, and SVGs are sanitized. Server only.
 */
import type { APIContext } from 'astro';
import { detectType } from '../detect.js';
import { imageSize } from '../dimensions.js';
import type { MediaSettings } from '../settings.js';
import { sanitizeSvg } from '../svg.js';
import type { MediaKind } from '../types.js';
import { error } from './http.js';
import { discardTemp, readTempText, replaceTempContent, type TempFile, TooLargeError, writeTemp } from './storage.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
const CONTROL = /[\u0000-\u001f\u007f]/g;
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export interface ReceivedFile {
	/** The checked file; the caller commits or discards it. */
	temp: TempFile;
	fileName: string;
	kind: Exclude<MediaKind, 'remoteVideo'>;
	mime: string;
	ext: string;
	size: number;
	width: number | null;
	height: number | null;
}

/** The cleaned file name from `X-File-Name`, or a response to send instead. */
export function fileNameFrom(context: APIContext): string | Response {
	let fileName = '';
	try {
		fileName = decodeURIComponent(context.request.headers.get('x-file-name') ?? '');
	} catch {
		return error(400, 'Invalid file name');
	}
	fileName = fileName.replace(CONTROL, '').split(/[\\/]/).pop()?.trim().slice(0, 200) ?? '';
	return fileName || error(400, 'Missing file name (X-File-Name header)');
}

/**
 * Receive and check the request's file. `onlyKind` refuses other kinds (a
 * replacement must stay the same kind). On success the caller owns `temp`.
 */
export async function receiveFile(
	context: APIContext,
	settings: MediaSettings,
	onlyKind?: MediaKind,
): Promise<ReceivedFile | Response> {
	const fileName = fileNameFrom(context);
	if (fileName instanceof Response) return fileName;
	if (!context.request.body) return error(400, 'Empty upload');

	const max =
		onlyKind && onlyKind in settings.limits
			? settings.limits[onlyKind as keyof MediaSettings['limits']]
			: Math.max(...Object.values(settings.limits));
	const declared = Number(context.request.headers.get('content-length') ?? 0);
	if (declared > max) return error(413, `Files can be at most ${mb(max)}.`);

	let temp: TempFile;
	try {
		temp = await writeTemp(context.request.body, max);
	} catch (cause) {
		if (cause instanceof TooLargeError) return error(413, `Files can be at most ${mb(max)}.`);
		console.error('[medialibrary] upload failed', cause);
		return error(500, 'Upload failed');
	}

	const refuse = async (status: number, message: string) => {
		await discardTemp(temp);
		return error(status, message);
	};
	try {
		if (temp.size === 0) return await refuse(400, 'The file is empty.');
		const detected = detectType(temp.head, fileName, { allowSvg: settings.allowSvg });
		if (!detected.ok) return await refuse(415, detected.reason);
		const { kind, mime, ext } = detected.type;
		if (onlyKind && kind !== onlyKind) {
			return await refuse(
				415,
				`The new file must be ${onlyKind === 'image' ? 'an image' : `a ${onlyKind} file`}, like the one it replaces.`,
			);
		}
		const limit = settings.limits[kind];
		if (temp.size > limit)
			return await refuse(413, `${kind[0]?.toUpperCase()}${kind.slice(1)} files can be at most ${mb(limit)}.`);

		let size = temp.size;
		let dimensions: { width: number | null; height: number | null } = { width: null, height: null };
		if (mime === 'image/svg+xml') {
			const sanitized = sanitizeSvg(await readTempText(temp));
			if (!sanitized.ok) return await refuse(415, sanitized.reason);
			size = await replaceTempContent(temp, sanitized.svg);
			dimensions = { width: sanitized.width, height: sanitized.height };
		} else if (kind === 'image') {
			dimensions = imageSize(temp.head, mime) ?? dimensions;
		}
		return { temp, fileName, kind, mime, ext, size, ...dimensions };
	} catch (cause) {
		console.error('[medialibrary] checking upload failed', cause);
		return refuse(500, 'Upload failed');
	}
}

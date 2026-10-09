import { describe, expect, it } from 'vitest';
import { isProviderThumbnail, parseRemoteVideo, remoteVideoFrom } from '../src/remote.js';
import { isMediaId, newMediaId } from '../src/types.js';

describe('parseRemoteVideo', () => {
	it.each([
		'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
		'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
		'https://youtu.be/dQw4w9WgXcQ?si=abc',
		'https://www.youtube.com/shorts/dQw4w9WgXcQ',
		'https://www.youtube.com/embed/dQw4w9WgXcQ',
		'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
		'https://www.youtube.com/live/dQw4w9WgXcQ',
	])('YouTube: %s', (url) => {
		expect(parseRemoteVideo(url)).toMatchObject({
			provider: 'youtube',
			videoId: 'dQw4w9WgXcQ',
			watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
			thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
		});
	});

	it.each([
		'https://vimeo.com/76979871',
		'https://vimeo.com/channels/staffpicks/76979871',
		'https://player.vimeo.com/video/76979871',
	])('Vimeo: %s', (url) => {
		expect(parseRemoteVideo(url)).toMatchObject({
			provider: 'vimeo',
			videoId: '76979871',
			embedUrl: 'https://player.vimeo.com/video/76979871?dnt=1',
		});
	});

	it.each([
		'not a url',
		'javascript:alert(1)',
		'https://evil.example/watch?v=dQw4w9WgXcQ',
		'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
		'https://www.youtube.com/watch?v=short',
		'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
		'https://youtu.be/../../etc/passwd',
		'https://vimeo.com/not-a-number',
		'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
	])('refuses %s', (url) => {
		expect(parseRemoteVideo(url)).toBeNull();
	});

	it('rebuilds stored videos only from valid ids', () => {
		expect(remoteVideoFrom('youtube', 'dQw4w9WgXcQ')?.embedUrl).toContain('youtube-nocookie.com');
		expect(remoteVideoFrom('youtube', 'x"><script>')).toBeNull();
		expect(remoteVideoFrom('dailymotion', 'x7')).toBeNull();
	});

	it('only trusts the providers’ thumbnail hosts', () => {
		expect(isProviderThumbnail('https://i.vimeocdn.com/video/1.jpg')).toBe(true);
		expect(isProviderThumbnail('http://i.ytimg.com/vi/x/0.jpg')).toBe(false);
		expect(isProviderThumbnail('https://evil.example/x.jpg')).toBe(false);
	});
});

describe('media ids', () => {
	it('are random, prefixed and validated', () => {
		const a = newMediaId();
		expect(isMediaId(a)).toBe(true);
		expect(a).not.toBe(newMediaId());
		expect(isMediaId('m_short')).toBe(false);
		expect(isMediaId('../etc/passwd')).toBe(false);
	});
});

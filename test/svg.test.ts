import { describe, expect, it } from 'vitest';
import { isSafeCss, sanitizeSvg } from '../src/svg.js';

const clean = (input: string) => {
	const result = sanitizeSvg(input);
	if (!result.ok) throw new Error(result.reason);
	return result;
};

describe('sanitizeSvg: keeps ordinary drawings', () => {
	it('keeps shapes, gradients, text and internal references', () => {
		const { svg, width, height } = clean(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
				'<rect width="10" height="10" fill="url(#g)"/><use href="#g"/><text x="1" y="2">A &amp; B</text></svg>',
		);
		expect(svg).toContain('<linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient>');
		expect(svg).toContain('fill="url(#g)"');
		expect(svg).toContain('<use href="#g"/>');
		expect(svg).toContain('<text x="1" y="2">A &amp; B</text>');
		expect(svg).toMatch(/^<\?xml[^>]*\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		expect([width, height]).toEqual([120, 60]);
	});

	it('keeps safe <style> (CDATA unwrapped) and reads pixel width/height', () => {
		const { svg, width, height } = clean(
			'<svg width="64px" height="32" xmlns="http://www.w3.org/2000/svg"><style><![CDATA[ .a > .b { fill: red } ]]></style><g class="a"/></svg>',
		);
		expect(svg).toContain('<style> .a &gt; .b { fill: red } </style>');
		expect([width, height]).toEqual([64, 32]);
	});

	it('drops editor metadata (Inkscape, Illustrator) but keeps the drawing', () => {
		const { svg } = clean(
			'<svg xmlns:inkscape="x" inkscape:version="1" viewBox="0 0 1 1"><sodipodi:namedview/><metadata>m</metadata><path d="M0 0" inkscape:label="L"/></svg>',
		);
		expect(svg).not.toMatch(/inkscape|sodipodi|metadata/);
		expect(svg).toContain('<path d="M0 0"/>');
	});
});

describe('sanitizeSvg: removes anything that could run or load', () => {
	it.each([
		['script element', '<svg><script>alert(1)</script></svg>', /script|alert/],
		['event handler', '<svg onload="alert(1)"><rect onclick="alert(2)" width="1"/></svg>', /onload|onclick|alert/],
		['mixed-case handler', '<svg OnLoad="alert(1)"/>', /alert/i],
		['javascript link', '<svg><a href="javascript:alert(1)"><rect width="1"/></a></svg>', /javascript|<a/],
		['xlink javascript', '<svg><use xlink:href="javascript:alert(1)"/></svg>', /javascript/],
		['external use', '<svg><use href="https://evil.example/x.svg#a"/></svg>', /evil/],
		['data URI use', '<svg><use href="data:image/svg+xml;base64,PHN2Zz4="/></svg>', /data:/],
		[
			'foreignObject',
			'<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>',
			/foreign|iframe|evil/,
		],
		['embedded image', '<svg><image href="https://evil.example/track.png"/></svg>', /image|evil/],
		[
			'animation setting href',
			'<svg><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>',
			/animate|javascript/,
		],
		['set element', '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>', /set|alert/],
		['style with external url', '<svg><style>rect{fill:url(https://evil.example/x)}</style></svg>', /evil|style/],
		['style @import', '<svg><style>@import url(//evil.example/a.css);</style></svg>', /import|evil/],
		['style attribute url', '<svg><rect style="background:url(//evil.example)"/></svg>', /evil/],
		['presentation attr url', '<svg><rect fill="url(https://evil.example/#g)"/></svg>', /evil/],
		['entity-encoded javascript', '<svg><a href="&#106;avascript:alert(1)">x</a></svg>', /javascript|alert/],
		[
			'entity declarations (XXE)',
			'<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>',
			/passwd|ENTITY|xxe/,
		],
		['html inside text', '<svg><text>&lt;img src=x onerror=alert(1)&gt;</text></svg>', /<img/],
	])('%s', (_name, input, forbidden) => {
		const { svg } = clean(input);
		expect(svg).not.toMatch(forbidden);
	});

	it('escapes attribute values so they cannot break out', () => {
		const { svg } = clean('<svg><rect id="a&quot; onload=&quot;alert(1)" width="1"/></svg>');
		expect(svg).toContain('id="a&quot; onload=&quot;alert(1)"');
		expect(svg).not.toMatch(/onload="/); // only the escaped text survives, never a real attribute
	});

	it('refuses files without an <svg> root', () => {
		expect(sanitizeSvg('<html><body/></html>').ok).toBe(false);
		expect(sanitizeSvg('').ok).toBe(false);
	});
});

describe('isSafeCss', () => {
	it.each([
		['.a{fill:red}', true],
		['.a{fill:url(#g)}', true],
		["a{fill:url('#g')}", true],
		['a{fill:url(x.png)}', false],
		['a{behavior:url(x.htc)}', false],
		['a{width:expression(alert(1))}', false],
		['a{fill:u\\rl(//evil)}', false],
		['</style><script>', false],
	])('%s → %s', (css, safe) => {
		expect(isSafeCss(css)).toBe(safe);
	});
});

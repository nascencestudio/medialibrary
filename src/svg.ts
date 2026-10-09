/**
 * SVG sanitizer for uploads. Rebuilds the image from an allowlist instead of
 * removing known-bad parts: only listed elements and attributes survive, every
 * text and attribute value is decoded and re-escaped, references may only
 * point inside the file (`#id`, `url(#id)`), and CSS is kept only when it
 * contains no external references. Scripts, event handlers, `foreignObject`,
 * animations, links, embedded images, DOCTYPEs and entity declarations are
 * dropped. Pure functions only. See docs/security.md (Media library).
 *
 * Files are also served with a sandboxing Content-Security-Policy, so even a
 * sanitizer bug can't run script on the site's origin (defense in depth).
 */
import { COMMENT_NODE, ELEMENT_NODE, parse, TEXT_NODE } from 'ultrahtml';

const ELEMENTS = new Set([
	'svg',
	'g',
	'defs',
	'symbol',
	'use',
	'title',
	'desc',
	'path',
	'rect',
	'circle',
	'ellipse',
	'line',
	'polyline',
	'polygon',
	'text',
	'tspan',
	'textPath',
	'linearGradient',
	'radialGradient',
	'stop',
	'pattern',
	'clipPath',
	'mask',
	'marker',
	'style',
	'filter',
	'feBlend',
	'feColorMatrix',
	'feComponentTransfer',
	'feComposite',
	'feConvolveMatrix',
	'feDiffuseLighting',
	'feDisplacementMap',
	'feDistantLight',
	'feDropShadow',
	'feFlood',
	'feFuncA',
	'feFuncB',
	'feFuncG',
	'feFuncR',
	'feGaussianBlur',
	'feMerge',
	'feMergeNode',
	'feMorphology',
	'feOffset',
	'fePointLight',
	'feSpecularLighting',
	'feSpotLight',
	'feTile',
	'feTurbulence',
]);

/** Elements whose children are kept but the element itself is removed. */
const UNWRAP = new Set(['a', 'switch']);

const ATTRIBUTES = new Set([
	'id',
	'class',
	'style',
	'd',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'fx',
	'fy',
	'fr',
	'width',
	'height',
	'viewBox',
	'preserveAspectRatio',
	'points',
	'pathLength',
	'transform',
	'transform-origin',
	'fill',
	'fill-opacity',
	'fill-rule',
	'stroke',
	'stroke-width',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-miterlimit',
	'stroke-dasharray',
	'stroke-dashoffset',
	'stroke-opacity',
	'opacity',
	'color',
	'display',
	'visibility',
	'overflow',
	'clip-path',
	'clip-rule',
	'mask',
	'filter',
	'marker-start',
	'marker-mid',
	'marker-end',
	'markerWidth',
	'markerHeight',
	'markerUnits',
	'refX',
	'refY',
	'orient',
	'gradientUnits',
	'gradientTransform',
	'spreadMethod',
	'offset',
	'stop-color',
	'stop-opacity',
	'patternUnits',
	'patternContentUnits',
	'patternTransform',
	'clipPathUnits',
	'maskUnits',
	'maskContentUnits',
	'filterUnits',
	'primitiveUnits',
	'in',
	'in2',
	'result',
	'stdDeviation',
	'dx',
	'dy',
	'mode',
	'operator',
	'k1',
	'k2',
	'k3',
	'k4',
	'values',
	'type',
	'tableValues',
	'slope',
	'intercept',
	'amplitude',
	'exponent',
	'offset',
	'flood-color',
	'flood-opacity',
	'lighting-color',
	'radius',
	'baseFrequency',
	'numOctaves',
	'seed',
	'stitchTiles',
	'scale',
	'xChannelSelector',
	'yChannelSelector',
	'kernelMatrix',
	'order',
	'divisor',
	'bias',
	'targetX',
	'targetY',
	'edgeMode',
	'preserveAlpha',
	'surfaceScale',
	'diffuseConstant',
	'specularConstant',
	'specularExponent',
	'azimuth',
	'elevation',
	'z',
	'pointsAtX',
	'pointsAtY',
	'pointsAtZ',
	'limitingConeAngle',
	'font-family',
	'font-size',
	'font-weight',
	'font-style',
	'font-variant',
	'text-anchor',
	'dominant-baseline',
	'alignment-baseline',
	'baseline-shift',
	'letter-spacing',
	'word-spacing',
	'text-decoration',
	'textLength',
	'lengthAdjust',
	'startOffset',
	'method',
	'spacing',
	'side',
	'writing-mode',
	'direction',
	'unicode-bidi',
	'vector-effect',
	'shape-rendering',
	'text-rendering',
	'image-rendering',
	'color-interpolation',
	'color-interpolation-filters',
	'paint-order',
	'mix-blend-mode',
	'isolation',
	'enable-background',
	'version',
	'xmlns',
	'xmlns:xlink',
	'xml:space',
	'xml:lang',
	'lang',
	'role',
	'focusable',
	'href',
	'xlink:href',
]);

/** Attribute names that may only reference something inside the file. */
const REFERENCES = new Set(['href', 'xlink:href']);

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the entities a well-formed SVG may contain; unknown entities are dropped. */
function decode(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, ref: string) => {
		if (ref[0] === '#') {
			const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
				? String.fromCodePoint(code)
				: '';
		}
		return NAMED[ref.toLowerCase()] ?? '';
	});
}

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (value: string) => escapeText(value).replace(/"/g, '&quot;');

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are part of what's being stripped
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** CSS without external references or script-like constructs. */
export function isSafeCss(css: string): boolean {
	const compact = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\/g, '');
	if (/@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?\s*[a-z]/i.test(compact)) return false;
	for (const match of compact.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
		if (!(match[2] ?? '').trim().startsWith('#')) return false;
	}
	// A url( we couldn't parse (e.g. unbalanced) is refused too.
	return (
		(compact.match(/url\s*\(/gi)?.length ?? 0) === [...compact.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)].length
	);
}

/** An attribute value, or null if it must be dropped. */
function cleanAttribute(name: string, raw: string): string | null {
	const value = decode(raw).replace(CONTROL, '');
	if (REFERENCES.has(name)) return /^#[\w.:-]+$/.test(value.trim()) ? value.trim() : null;
	if (name === 'style') return isSafeCss(value) ? value : null;
	if (/javascript:|vbscript:|data:/i.test(value.replace(/\s+/g, ''))) return null;
	if (/url\s*\(/i.test(value) && !isSafeCss(value)) return null;
	return value;
}

type ParsedNode = {
	type: number;
	name?: string;
	attributes?: Record<string, string>;
	children?: ParsedNode[];
	value?: string;
};

function serialize(node: ParsedNode, root = false): string {
	if (node.type === TEXT_NODE) return escapeText(decode((node.value ?? '').replace(/<!\[CDATA\[|\]\]>/g, '')));
	if (node.type !== ELEMENT_NODE || !node.name) return ''; // comments, doctypes, processing instructions
	const children = () => (node.children ?? []).map((child) => serialize(child)).join('');
	if (UNWRAP.has(node.name)) return children();
	if (!ELEMENTS.has(node.name)) return '';

	if (node.name === 'style') {
		const css = decode(
			(node.children ?? [])
				.filter((c) => c.type === TEXT_NODE)
				.map((c) => c.value ?? '')
				.join('')
				.replace(/<!\[CDATA\[|\]\]>/g, ''),
		);
		return isSafeCss(css) ? `<style>${escapeText(css)}</style>` : '';
	}

	const attrs: string[] = [];
	const seen = new Set<string>();
	for (const [name, raw] of Object.entries(node.attributes ?? {})) {
		if (!ATTRIBUTES.has(name) || /^on/i.test(name) || seen.has(name)) continue;
		if (name === 'xmlns' || name === 'xmlns:xlink') continue; // set below on the root
		const value = cleanAttribute(name, String(raw));
		if (value === null) continue;
		seen.add(name);
		attrs.push(`${name}="${escapeAttr(value)}"`);
	}
	if (root) attrs.unshift(`xmlns="${SVG_NS}"`, `xmlns:xlink="${XLINK_NS}"`);
	const inner = children();
	const open = `<${node.name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
	return inner ? `${open}>${inner}</${node.name}>` : `${open}/>`;
}

function findRoot(node: ParsedNode): ParsedNode | null {
	for (const child of node.children ?? []) {
		if (child.type === ELEMENT_NODE && child.name === 'svg') return child;
		if (child.type === ELEMENT_NODE || child.type === COMMENT_NODE) continue;
	}
	return null;
}

/** A length attribute in px (unitless or `px`), or null. */
function pixels(value: string | undefined): number | null {
	const match = /^\s*([\d.]+)\s*(px)?\s*$/.exec(value ?? '');
	const n = match ? Number(match[1]) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export type SanitizeResult =
	| { ok: true; svg: string; width: number | null; height: number | null }
	| { ok: false; reason: string };

export function sanitizeSvg(input: string): SanitizeResult {
	let tree: ParsedNode;
	try {
		tree = parse(input.replace(/^﻿/, '')) as ParsedNode;
	} catch {
		return { ok: false, reason: 'The SVG could not be read.' };
	}
	const root = findRoot(tree);
	if (!root) return { ok: false, reason: 'The file has no <svg> root element.' };
	const svg = serialize(root, true);
	const attrs = root.attributes ?? {};
	let width = pixels(attrs.width);
	let height = pixels(attrs.height);
	if (width === null || height === null) {
		const box = (attrs.viewBox ?? '')
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (box.length === 4 && box.every(Number.isFinite) && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0) {
			width ??= Math.round(box[2] as number);
			height ??= Math.round(box[3] as number);
		}
	}
	return { ok: true, svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, width, height };
}

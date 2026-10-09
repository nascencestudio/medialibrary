/** A stylesheet's built URL (`?url`): emitted as a file, never attached to pages by Astro. */
declare module '*.css?url' {
	const href: string;
	export default href;
}

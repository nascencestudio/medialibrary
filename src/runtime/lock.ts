/**
 * One structural change at a time (ADR 0100): moving items, changing folders and
 * syncing the disk all run through this queue, so two of them never move the same
 * files at once. One server process; a second process sharing the storage
 * directory would need its own coordination. Server only.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withLock<T>(task: () => Promise<T>): Promise<T> {
	const run = tail.then(task, task);
	tail = run.catch(() => {});
	return run;
}

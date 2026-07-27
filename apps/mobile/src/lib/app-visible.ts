// "Has a human actually seen the screen yet?"
//
// Reported twice: "the good afternoon is STILL not doing the bloom, and the user's name is
// still not doing the big text effect."
//
// The first fix was for the wrong cause. I removed a once-per-launch flag that a remount was
// burning — correct, but not the whole story, because the greeting still animated at a moment
// nobody could witness. The Today screen mounts UNDERNEATH the splash: it lays out, the springs
// run, they settle, and only then does the splash fade away to reveal a greeting that finished
// blooming half a second ago. The animation was never missing. It was never visible.
//
// So mounting is the wrong trigger for anything meant to be watched. This is the right one: the
// splash publishes the moment it gets out of the way, and anything that wants to be SEEN waits
// for it. Module scope rather than a context because it's a single boolean owned by the app
// shell, read from anywhere, and threading a provider through for it would be more machinery
// than the fact deserves.
let visible = false;
const waiting = new Set<() => void>();

/** Called by the splash once it has finished getting out of the way. */
export function markAppVisible() {
  if (visible) return;
  visible = true;
  for (const fn of [...waiting]) fn();
  waiting.clear();
}

export function isAppVisible() {
  return visible;
}

/**
 * Run `fn` once the app is actually on screen — immediately if it already is.
 * Returns an unsubscribe for the case where the caller unmounts first.
 */
export function whenAppVisible(fn: () => void): () => void {
  if (visible) { fn(); return () => {}; }
  waiting.add(fn);
  return () => waiting.delete(fn);
}

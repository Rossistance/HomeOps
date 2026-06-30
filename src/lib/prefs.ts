import { useSyncExternalStore } from "react";

/**
 * Sensory & comfort preferences (Tactile Hearth).
 *
 * Calm Mode is an inclusive, neurodivergent-friendly setting: it flattens the
 * material depth, stills all motion, removes ambient glows, and softens color
 * load. It's a real behavior — the actual CSS lives under `html[data-calm]` in
 * index.css; this module owns the state, persistence, and the root attribute.
 *
 * Kept deliberately separate from the main Zustand store so it stays small,
 * synchronous, and safe to read during first paint (no flash of full-motion UI).
 */

const STORAGE_KEY = "homeops:calm-mode";
const ROOT = typeof document !== "undefined" ? document.documentElement : null;

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let calm = read();
const listeners = new Set<() => void>();

function apply(value: boolean) {
  if (ROOT) ROOT.dataset.calm = value ? "true" : "false";
}

// Apply immediately on module load so the very first paint is correct.
apply(calm);

export function getCalmMode(): boolean {
  return calm;
}

export function setCalmMode(value: boolean): void {
  calm = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* storage may be unavailable; the attribute below still works for the session */
  }
  apply(value);
  listeners.forEach((l) => l());
}

export function toggleCalmMode(): void {
  setCalmMode(!calm);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook — re-renders when Calm Mode changes anywhere in the app. */
export function useCalmMode(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getCalmMode, () => false);
  return [value, setCalmMode];
}

/** True when the OS requests reduced motion (read-only signal for components). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

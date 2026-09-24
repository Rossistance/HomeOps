// Calendars refresh by themselves (ADR-005): on launch, on coming back to the foreground, on
// opening the calendar, every minute while it is open, and on opening an event. Many of those
// fire together (launch + calendar focus + the Today screen), so this is a tiny coordinator in
// front of POST /api/calendar/refresh:
//  - a call made while one is already in flight joins it instead of sending another;
//  - a call within ~20 s of the last one is skipped, unless the caller wants to WAIT for fresh
//    data (a screen that is about to load) — that one always goes through.
// The server keeps its own one-minute floor and runs one refresh per household at a time; this
// only saves the phone pointless requests. Pure logic: the api call is injected, so it tests
// without React Native.

export type RefreshCall = (reason: string, wait: boolean) => Promise<unknown>;
export interface RefreshOptions { wait?: boolean }
export interface Refresher {
  /** Resolves when the refresh this call joined (or started) is done; at once when skipped.
   *  Never rejects: a failed refresh just means the screen shows what the server already has. */
  refresh(reason: string, opts?: RefreshOptions): Promise<void>;
}

export const MIN_GAP_MS = 20_000;

export function createRefresher(call: RefreshCall, { minGapMs = MIN_GAP_MS, now = Date.now }: { minGapMs?: number; now?: () => number } = {}): Refresher {
  let inFlight: { promise: Promise<void>; wait: boolean } | null = null;
  let lastStartedAt = -Infinity;

  const start = (reason: string, wait: boolean): Promise<void> => {
    lastStartedAt = now();
    const promise = Promise.resolve()
      .then(() => call(reason, wait))
      .then(() => undefined, () => undefined)
      .finally(() => { if (inFlight?.promise === promise) inFlight = null; });
    inFlight = { promise, wait };
    return promise;
  };

  return {
    refresh(reason, opts = {}) {
      const wait = opts.wait === true;
      if (inFlight) {
        // Joining is enough unless this caller must wait and the running call won't: a
        // fire-and-forget request answers before the server has finished, so ask again —
        // after it, so there is still only one request on the wire.
        if (!wait || inFlight.wait) return inFlight.promise;
        const before = inFlight.promise;
        const chained = before.then(() => (inFlight && inFlight.promise !== before ? inFlight.promise : start(reason, true)));
        return chained;
      }
      if (!wait && now() - lastStartedAt < minGapMs) return Promise.resolve();
      return start(reason, wait);
    },
  };
}

// The app's one coordinator. api is imported lazily so this file stays loadable in plain node.
let shared: Refresher | null = null;
export function refreshCalendars(reason: string, opts?: RefreshOptions): Promise<void> {
  shared ??= createRefresher(async (r, w) => {
    const { api } = await import("@/lib/api");
    return api.refreshCalendars(r, w);
  });
  return shared.refresh(reason, opts);
}

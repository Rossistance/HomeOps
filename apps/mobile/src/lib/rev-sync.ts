// Cross-device freshness: poll the server's data revision (one tiny number)
// while a screen is focused, and trigger that screen's reload only when the
// revision actually changed. Adds a change made on the web (or by a helper)
// to the phone within ~12s, with near-zero network cost when nothing changed.
import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "@/lib/api";

const POLL_MS = 12_000;

export function useRevSync(reload: () => void): void {
  const lastRev = useRef<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const tick = async () => {
        const rev = await api.rev();
        if (!alive || rev == null) return;
        // Back online: flush any offline-queued writes before comparing state.
        const { replayQueue, queuedCount } = await import("@/lib/offline-queue");
        if ((await queuedCount()) > 0) {
          const r = await replayQueue();
          if (r.sent > 0) { reload(); lastRev.current = null; return; }
        }
        if (lastRev.current != null && rev !== lastRev.current) reload();
        lastRev.current = rev;
      };
      void tick();
      const t = setInterval(() => { void tick(); }, POLL_MS);
      return () => { alive = false; clearInterval(t); };
    }, [reload]),
  );
}

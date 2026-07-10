// Cross-device freshness: poll the server's data revision (one tiny number)
// while a screen is focused, and trigger that screen's reload only when the
// revision actually changed. Adds a change made on the web (or by an agent)
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
        if (lastRev.current != null && rev !== lastRev.current) reload();
        lastRev.current = rev;
      };
      void tick();
      const t = setInterval(() => { void tick(); }, POLL_MS);
      return () => { alive = false; clearInterval(t); };
    }, [reload]),
  );
}

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, loadToken, onSessionExpired, setToken, type Session } from "@/lib/api";

interface SessionCtx {
  loading: boolean;
  session: Session | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setSession: (s: Session | null) => void;
}

const Ctx = createContext<SessionCtx>({
  loading: true, session: null,
  refresh: async () => {}, signOut: async () => {}, setSession: () => {},
});

export function useSession() { return useContext(Ctx); }

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  const refresh = useCallback(async () => {
    await loadToken();
    const s = await api.getSession();
    setSession(s);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* The session used to be checked only on a cold start, so a phone left running past its
   * session kept showing signed-in screens that could not load anything (2026-09-24). Two
   * doors now: the server saying so (any 401 authentication_required — the dead token is
   * dropped and the profile picker comes back), and the app coming back to the foreground
   * (the session is re-read, which also renews it on the server while it is in use). */
  useEffect(() => {
    onSessionExpired(() => { void setToken(null); setSession(null); });
    return () => onSessionExpired(null);
  }, []);
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current !== "active" && next === "active") {
        // Only an answer from the server changes who is signed in; no signal changes nothing.
        // The same session keeps its object, so nothing downstream re-subscribes for nothing.
        void api.sessionStatus().then((st) => {
          if (!st.answered) return;
          // The server really said "no session": drop the dead token too, as a 401 would.
          if (!st.session) void setToken(null);
          setSession((cur) => (st.session && cur && cur.actorId === st.session.actorId && cur.householdId === st.session.householdId
            && cur.role === st.session.role && cur.csrf === st.session.csrf ? cur : st.session));
        });
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, []);

  return <Ctx.Provider value={{ loading, session, refresh, signOut, setSession }}>{children}</Ctx.Provider>;
}

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, loadToken, type Session } from "@/lib/api";

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

  const signOut = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, []);

  return <Ctx.Provider value={{ loading, session, refresh, signOut, setSession }}>{children}</Ctx.Provider>;
}

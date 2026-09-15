import { useEffect, lazy, Suspense } from "react";
import { useStore } from "@/store/useStore";
import { AppShell } from "@/components/Shell";
import { CommandBar } from "@/components/CommandBar";
import { Toaster } from "@/components/Toaster";
import { Icon } from "@/components/Icon";
import { brand } from "@/brand";
import type { ScreenId } from "@/types";
import { Onboarding } from "@/screens/Onboarding";
import { Lock } from "@/screens/Lock";

// Route-level code splitting — each screen is its own chunk (P3-BUILD-001).
// A dynamic import can FAIL when a new build is deployed (or HMR rebuilds in dev) while
// a tab is open: the old chunk hash 404s and the screen would hang forever on the
// Suspense fallback ("Loading…"). lazyWithReload recovers by reloading once to fetch the
// current build, rate-limited so a genuinely-broken chunk can't cause a reload loop.
const RELOAD_KEY = "homeops_chunk_reload_at";
function lazyWithReload<T extends React.ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch((err) => {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // hold render until the reload takes over
      }
      throw err; // reloaded too recently — surface the real error instead of looping
    }),
  );
}
const Dashboard = lazyWithReload(() => import("@/screens/Dashboard").then((m) => ({ default: m.Dashboard })));
const Assistant = lazyWithReload(() => import("@/screens/Assistant").then((m) => ({ default: m.Assistant })));
const Helpers = lazyWithReload(() => import("@/screens/Helpers").then((m) => ({ default: m.Helpers })));
const Connections = lazyWithReload(() => import("@/screens/Connections").then((m) => ({ default: m.Connections })));
const Messages = lazyWithReload(() => import("@/screens/Messages").then((m) => ({ default: m.Messages })));
const FilesKnowledge = lazyWithReload(() => import("@/screens/FilesKnowledge").then((m) => ({ default: m.FilesKnowledge })));
const MiniApps = lazyWithReload(() => import("@/screens/MiniApps").then((m) => ({ default: m.MiniApps })));
const HouseholdSpaces = lazyWithReload(() => import("@/screens/HouseholdSpaces").then((m) => ({ default: m.HouseholdSpaces })));
const Meals = lazyWithReload(() => import("@/screens/Meals").then((m) => ({ default: m.Meals })));
const Calendar = lazyWithReload(() => import("@/screens/Calendar").then((m) => ({ default: m.Calendar })));
const ActivityMemory = lazyWithReload(() => import("@/screens/ActivityMemory").then((m) => ({ default: m.ActivityMemory })));
const Settings = lazyWithReload(() => import("@/screens/Settings").then((m) => ({ default: m.Settings })));

const SCREENS: Record<ScreenId, React.ComponentType> = {
  dashboard: Dashboard,
  assistant: Assistant,
  helpers: Helpers,
  connections: Connections,
  messages: Messages,
  files: FilesKnowledge,
  miniapps: MiniApps,
  spaces: HouseholdSpaces,
  meals: Meals,
  calendar: Calendar,
  activity: ActivityMemory,
  settings: Settings,
};

function Splash({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 bg-sand-100 text-ink-500">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-900 text-sage-400 animate-soft-pulse"><Icon name="House" size={26} /></div>
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export default function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const needsOnboarding = useStore((s) => s.needsOnboarding);
  const session = useStore((s) => s.session);
  const screen = useStore((s) => s.route.screen);
  const canAccess = useStore((s) => s.canAccess);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);

  useEffect(() => { void init(); }, [init]);

  // Role guard: bounce out of screens the current role can't access.
  useEffect(() => {
    if (session && !canAccess(screen)) {
      toast({ kind: "warn", title: "Not available for your profile", message: "That section needs a higher access level." });
      navigate("dashboard");
    }
  }, [screen, session, canAccess, navigate, toast]);

  if (!ready) return <Splash label={`Loading ${brand.name}…`} />;
  if (needsOnboarding) return <><Onboarding /><Toaster /></>;
  if (!session) return <><Lock /><Toaster /></>;

  const Screen = (canAccess(screen) ? SCREENS[screen] : SCREENS.dashboard) ?? Dashboard;

  return (
    <>
      <AppShell>
        <Suspense fallback={<Splash label="Loading…" />}>
          <Screen key={screen} />
        </Suspense>
      </AppShell>
      <CommandBar />
      <Toaster />
    </>
  );
}

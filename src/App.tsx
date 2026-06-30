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
const Dashboard = lazy(() => import("@/screens/Dashboard").then((m) => ({ default: m.Dashboard })));
const Assistant = lazy(() => import("@/screens/Assistant").then((m) => ({ default: m.Assistant })));
const Agents = lazy(() => import("@/screens/Agents").then((m) => ({ default: m.Agents })));
const Automations = lazy(() => import("@/screens/Automations").then((m) => ({ default: m.Automations })));
const Connections = lazy(() => import("@/screens/Connections").then((m) => ({ default: m.Connections })));
const Messages = lazy(() => import("@/screens/Messages").then((m) => ({ default: m.Messages })));
const FilesKnowledge = lazy(() => import("@/screens/FilesKnowledge").then((m) => ({ default: m.FilesKnowledge })));
const MiniApps = lazy(() => import("@/screens/MiniApps").then((m) => ({ default: m.MiniApps })));
const HouseholdSpaces = lazy(() => import("@/screens/HouseholdSpaces").then((m) => ({ default: m.HouseholdSpaces })));
const Playbooks = lazy(() => import("@/screens/Playbooks").then((m) => ({ default: m.Playbooks })));
const ActivityMemory = lazy(() => import("@/screens/ActivityMemory").then((m) => ({ default: m.ActivityMemory })));
const Settings = lazy(() => import("@/screens/Settings").then((m) => ({ default: m.Settings })));
const SkillBuilder = lazy(() => import("@/screens/SkillBuilder").then((m) => ({ default: m.SkillBuilder })));
const FunctionBuilder = lazy(() => import("@/screens/FunctionBuilder").then((m) => ({ default: m.FunctionBuilder })));

const SCREENS: Record<ScreenId, React.ComponentType> = {
  dashboard: Dashboard,
  assistant: Assistant,
  agents: Agents,
  automations: Automations,
  skills: SkillBuilder,
  functions: FunctionBuilder,
  connections: Connections,
  messages: Messages,
  files: FilesKnowledge,
  miniapps: MiniApps,
  spaces: HouseholdSpaces,
  playbooks: Playbooks,
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

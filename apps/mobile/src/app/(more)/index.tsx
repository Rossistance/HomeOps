// More hub — everything that isn't one of the four high-frequency tabs, as a
// two-column grid of tactile tiles. New surfaces get a tile here instead of a
// tab, so the tab bar stays calm as the app grows.
import { View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { API_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, type HearthColors } from "@/theme";
import { HScreen, PressableCard, Rise, SymTile, T } from "@/components/ui";

type Tone = "ember" | "sage" | "sky" | "amber" | "lavender" | "muted";

interface HubItem { label: string; hint: string; icon: string; href: string; tone: Tone }

// Activity lives in the (home) group; router.push("/activity") still resolves.
const ITEMS: HubItem[] = [
  { label: "Tasks & Lists", hint: "Chores, errands & groceries", icon: "checklist", href: "/tasks", tone: "sky" },
  { label: "Meals", hint: "Week plan + groceries", icon: "fork.knife", href: "/meals", tone: "sage" },
  { label: "Files & Knowledge", hint: "Documents & helper memory", icon: "folder", href: "/files", tone: "amber" },
  { label: "Agents", hint: "Your household helpers", icon: "brain.head.profile", href: "/agents", tone: "lavender" },
  { label: "Automations", hint: "Schedules, watchers & webhooks", icon: "arrow.triangle.2.circlepath", href: "/automations", tone: "sky" },
  { label: "Playbooks", hint: "Step-by-step workflows", icon: "book", href: "/playbooks", tone: "ember" },
  { label: "Household", hint: "Members, roles & spaces", icon: "person.3", href: "/household", tone: "sage" },
  { label: "Contacts", hint: "Delivery methods & opt-in", icon: "person.crop.circle", href: "/contacts", tone: "lavender" },
  { label: "Activity", hint: "Runs & audit trail", icon: "clock.arrow.circlepath", href: "/activity", tone: "amber" },
  { label: "Connections", hint: "Accounts & connectors", icon: "link", href: "/connections", tone: "sky" },
  { label: "Settings", hint: "AI providers & session", icon: "gearshape", href: "/settings", tone: "muted" },
];

function tone(c: HearthColors, t: Tone): { fg: string; bg: string } {
  switch (t) {
    case "ember": return { fg: c.ember, bg: c.emberBg };
    case "sage": return { fg: c.sage, bg: c.sageBg };
    case "sky": return { fg: c.sky, bg: c.skyBg };
    case "amber": return { fg: c.amber, bg: c.amberBg };
    case "lavender": return { fg: c.lavender, bg: c.lavenderBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken };
  }
}

export default function MoreHub() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <HScreen>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {ITEMS.map((it, i) => {
          const tn = tone(colors, it.tone);
          return (
            <Rise key={it.href} index={i} style={{ flexBasis: "46%", flexGrow: 1 }}>
              <PressableCard
                onPress={() => router.push(it.href)}
                accessibilityRole="button"
                accessibilityLabel={it.label}
                accessibilityHint={it.hint}
                style={{ gap: spacing.sm, minHeight: 132, flex: 1 }}
              >
                <SymTile name={it.icon} color={tn.fg} bg={tn.bg} size={40} />
                <T kind="h3" color={colors.text}>{it.label}</T>
                <T kind="sub" numberOfLines={2}>{it.hint}</T>
              </PressableCard>
            </Rise>
          );
        })}
      </View>

      <Rise index={ITEMS.length} style={{ alignItems: "center", gap: 3, marginTop: spacing.xl }}>
        {session ? (
          <T kind="caption" color={colors.textFaint} center>
            Signed in as {session.actorName} · {session.role}
          </T>
        ) : null}
        <T kind="caption" color={colors.textFaint} center selectable>
          HomeOps {version}
        </T>
        <T kind="caption" color={colors.textFaint} center selectable>
          {API_URL}
        </T>
      </Rise>
    </HScreen>
  );
}

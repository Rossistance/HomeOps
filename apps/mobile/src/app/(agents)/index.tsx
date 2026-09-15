// Helpers — everything the household has asked Famili to look after.
//
// This screen used to be Agents, and it was the loudest complaint in the whole app:
// "overly complicated and cumbersome with what happens where, what gates approve what."
// It was fair. A helper's behaviour was spread across an Agent, a Skill, a Function, a
// Playbook, an Automation and a Trigger, each with its own screen, its own status word and
// its own idea of what "approved" meant — and the card here could only show you fragments
// of that, so the honest answer to "what will this thing do?" was: open six screens.
//
// There is one record now. So there is one card, and it answers the only four questions a
// person actually has, in the order they ask them:
//
//   what is it        → the icon, the name, the purpose
//   when does it run  → scheduleText, written by the server
//   what may it do    → autonomyText, also the server's words
//   what happened     → the last run, in plain English
//
// Nothing here is derived, inferred or reassembled on the device. If the phone and the
// server ever disagreed about a schedule, the phone was wrong — so the phone stopped
// guessing.
//
// The route folder is still (agents): deep links, the tab-swipe order (lib/tab-order) and
// anything already installed point at it. Renaming the folder buys a tidier path and costs
// every existing link, which is a bad trade for a word only the code sees.
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, type PublicHelper } from "@/lib/api";
import { useSession } from "@/lib/session";
import { canManageOwn } from "@/lib/roles";
import { useTheme } from "@/theme";
import {
  EmptyState, ErrorState, HScreen, PressableCard, Rise, SkeletonCards, Sym, SymTile, T,
} from "@/components/ui";
import { NewHelperSheet } from "@/components/sheets/new-helper-sheet";
import { helperLook, helperTint, lastRunLine } from "@/lib/helper-meta";

export default function HelpersScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const { create } = useLocalSearchParams<{ create?: string }>();
  /* Any adult may build a helper for themselves. What an Adult Member can't do is make one
   * that runs for the whole household — the server refuses that and says so in words, which
   * the editor shows verbatim rather than pre-empting with a hidden control. */
  const canManage = canManageOwn(session?.role);

  const [helpers, setHelpers] = useState<PublicHelper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const list = await api.helpers();
    if (list.length === 0 && !(await api.health())) setError("The Famili server didn't answer.");
    else { setError(null); setHelpers(list); }
    setLoading(false);
  }, []);
  // Refetch on focus: coming back from the editor must not show the helper you just changed
  // as it was before you changed it.
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  useEffect(() => { if (create === "1" && canManage) setCreateOpen(true); }, [create, canManage]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  /* Paused last. A paused helper is still yours and still worth seeing, but it isn't going
   * to do anything tonight, and the ones that are should be the ones you read first. */
  const ordered = useMemo(() => {
    const rank = (h: PublicHelper) => (h.status === "Active" ? 0 : 1);
    return [...helpers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [helpers]);

  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;
  if (error) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message={error} onRetry={() => void load()} /></HScreen>;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {canManage && (
        <Rise index={0}>
          <PressableCard
            onPress={() => setCreateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="New helper"
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
          >
            <SymTile name="plus" color={colors.ember} bg={colors.emberBg} />
            <View style={{ flex: 1, gap: 2 }}>
              <T kind="rowTitle">New helper</T>
              <T kind="detail">Start from a ready-made one, or write your own.</T>
            </View>
            <Sym name="chevron.right" size={13} color={colors.textFaint} />
          </PressableCard>
        </Rise>
      )}

      {/* Said once, plainly, rather than by hiding a button and leaving them to work it out. */}
      {!canManage && ordered.length > 0 ? (
        <T kind="caption" center color={colors.textFaint}>
          You can see what the household&apos;s helpers do. Making or changing one needs an adult account.
        </T>
      ) : null}

      {ordered.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="No helpers yet"
          hint={canManage
            ? "A helper is one job you'd rather not remember — the Monday bin, the school forms, the bill that arrives quietly. Pick one to start with."
            : "Nobody has set one up yet. An adult in your household can make the first one."}
          action={canManage ? { title: "New helper", onPress: () => setCreateOpen(true) } : undefined}
        />
      ) : null}

      {ordered.map((h, i) => (
        <Rise key={h.id} index={i + 1}>
          <HelperCard helper={h} onPress={() => router.push(`/(agents)/${h.id}`)} />
        </Rise>
      ))}

      <NewHelperSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onPicked={(draft) => {
          setCreateOpen(false);
          /* A template opens the EDITOR, pre-filled. It is never saved from the sheet: the
           * instructions are the helper, and agreeing to text you haven't read is how you end
           * up with something in your house that does a thing you didn't ask for. */
          router.push({ pathname: "/(agents)/[id]", params: { id: "new", ...draft } });
        }}
      />
    </HScreen>
  );
}

/** One helper, whole, on one card. Four questions, four lines, no expansion required. */
function HelperCard({ helper, onPress }: { helper: PublicHelper; onPress: () => void }) {
  const { colors, spacing } = useTheme();
  const look = helperLook(colors, helper);
  const tint = helperTint(colors, helper.status);
  const last = lastRunLine(helper.lastRun);
  const lastColor = last.tone === "bad" ? colors.coral
    : last.tone === "warn" ? colors.amber
    : last.tone === "good" ? colors.sage
    : colors.textFaint;
  const paused = helper.status !== "Active";

  return (
    <PressableCard
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${helper.name}. ${helper.purpose}. ${helper.scheduleText}. ${helper.autonomyText}. ${last.text}`}
      style={{ gap: spacing.sm, opacity: paused ? 0.72 : 1 }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <SymTile name={look.icon} color={look.fg} bg={look.bg} />
        <View style={{ flex: 1, gap: 3 }}>
          {/* A name you can't read is not a name: it wraps, always. */}
          <T kind="rowTitle">{helper.name}</T>
          {helper.purpose ? <T kind="sub">{helper.purpose}</T> : null}
        </View>
        {/* Paused says PAUSED. It used to be one of five status words that all looked alike,
            so the one state that means "this will not happen" read like the four that don't. */}
        {paused ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: tint.bg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 }}>
            <Sym name="pause.fill" size={10} color={tint.fg} />
            <T kind="caption" color={tint.fg}>Paused</T>
          </View>
        ) : (
          <Sym name="chevron.right" size={13} color={colors.textFaint} />
        )}
      </View>

      <View style={{ gap: 5, paddingLeft: 52 }}>
        <Fact icon="clock" text={paused ? `${helper.scheduleText} — paused` : helper.scheduleText} color={colors.textSecondary} />
        <Fact icon="hand.raised" text={helper.autonomyText} color={colors.textSecondary} />
        <Fact
          icon={last.tone === "bad" ? "exclamationmark.triangle" : last.tone === "warn" ? "clock.badge.checkmark" : "checkmark.circle"}
          text={last.text}
          color={lastColor}
        />
      </View>
    </PressableCard>
  );
}

function Fact({ icon, text, color }: { icon: string; text: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}>
      <Sym name={icon} size={12} color={color} style={{ marginTop: 2 }} />
      <T kind="detail" color={color} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

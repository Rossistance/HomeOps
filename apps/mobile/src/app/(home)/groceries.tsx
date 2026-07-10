// Groceries — the shared list (tasks of type "list" on the Groceries list).
// Cart progress, quick-add, check-off, and a share sheet that routes outside
// sends through the planner (so they land in approvals like everything else).
import { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { api, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { useTheme, tapHaptic, motion } from "@/theme";
import {
  T, Card, Well, SectionHeader, SkeletonCards, ErrorState, Rise, HScreen,
  Sym, PressableScale, HSheet, SheetCTA, Notice, useConfirmFlash,
} from "@/components/ui";

function ProgressBar({ done, total }: { done: number; total: number }) {
  const { colors } = useTheme();
  const w = useSharedValue(0);
  const pct = total > 0 ? done / total : 0;
  w.value = withTiming(pct, { duration: 400, easing: motion.easing });
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
      <Animated.View style={[{ height: 10, borderRadius: 6, backgroundColor: colors.ember }, a]} />
    </View>
  );
}

export default function GroceriesScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const { flash, show } = useConfirmFlash();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<TaskRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [smsLive, setSmsLive] = useState(false);
  const [draft, setDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePhone, setSharePhone] = useState("");
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);

  const load = useCallback(async () => {
    const [h, tks, mem, conns] = await Promise.all([api.health(), api.tasks(), api.members(), api.connectors()]);
    setOffline(!h);
    if (h) {
      setItems(tks.filter((t) => t.type === "list" && t.listName === "Groceries"));
      setMembers(mem);
      setSmsLive(conns.some((c) => /sms|twilio|messag|text/i.test(`${c.id} ${c.name}`) && c.live));
    }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  useRevSync(useCallback(() => { void load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const done = useMemo(() => items.filter((t) => t.status === "done").length, [items]);
  const open = items.filter((t) => t.status !== "done");
  const checked = items.filter((t) => t.status === "done");

  async function addItem() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    tapHaptic("light");
    const r = await api.createTask({ title, type: "list", listName: "Groceries" });
    // POST may not persist listName — patch it after, like the Tasks screen does.
    if (r.task && (r.task as TaskRec).listName !== "Groceries") {
      await api.updateTask((r.task as TaskRec).id, { listName: "Groceries" });
    }
    if (r.error) Alert.alert("Couldn't add that", "Something went wrong — try again.");
    await load();
  }

  const toggle = async (t: TaskRec) => {
    tapHaptic("select");
    const next = t.status === "done" ? "todo" : "done";
    setItems((list) => list.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const r = await api.updateTask(t.id, { status: next });
    if (r.error) setItems((list) => list.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
  };

  const remove = (t: TaskRec) => {
    Alert.alert("Remove item?", t.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { void api.deleteTask(t.id).then(load); } },
    ]);
  };

  async function sendCopy() {
    if (!sharePhone.trim() || shareBusy) return;
    setShareBusy(true);
    setShareNote(null);
    const list = open.map((t) => t.title).join(", ");
    const r = await api.assistant(
      `Text a copy of our grocery list to ${sharePhone.trim()}. The list: ${list || "(empty)"}.`,
    );
    setShareBusy(false);
    if (!r.ok) {
      setShareNote(r.message ?? "Famili couldn't draft that right now — try again.");
      return;
    }
    show("send", () => {
      setShareOpen(false);
      setSharePhone("");
      void load();
    });
  }

  const ItemRow = ({ t, i }: { t: TaskRec; i: number }) => {
    const isDone = t.status === "done";
    return (
      <View
        style={{
          flexDirection: "row", alignItems: "center", gap: spacing.md,
          paddingHorizontal: spacing.lg, paddingVertical: 12,
          borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
        }}
      >
        <PressableScale onPress={() => void toggle(t)} haptic={null} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: isDone }} accessibilityLabel={t.title}>
          <View
            style={{
              width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
              borderWidth: isDone ? 0 : 1.5, borderColor: colors.textFaint,
              backgroundColor: isDone ? colors.ember : "transparent",
            }}
          >
            {isDone && <Sym name="checkmark" size={14} color={colors.onEmber} />}
          </View>
        </PressableScale>
        <PressableScale onLongPress={() => remove(t)} haptic={null} style={{ flex: 1 }}>
          <T kind="rowTitle" color={isDone ? colors.textFaint : colors.text} style={isDone ? { textDecorationLine: "line-through" } : undefined}>
            {t.title}
          </T>
        </PressableScale>
      </View>
    );
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {loading ? <SkeletonCards count={3} /> : offline ? (
        <ErrorState message={`Can't reach the backend at ${api.url}.`} onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <>
          <Rise index={0}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T kind="sub">This week · {items.length} item{items.length === 1 ? "" : "s"}</T>
              <PressableScale onPress={() => setShareOpen(true)} haptic="select" style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.emberBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }} accessibilityRole="button" accessibilityLabel="Share list">
                <Sym name="square.and.arrow.up" size={13} color={colors.ember} />
                <T kind="subMedium" color={colors.ember}>Share</T>
              </PressableScale>
            </View>
          </Rise>

          <Rise index={1}>
            <Card style={{ gap: 10 }}>
              <T kind="rowTitle">{done} of {items.length} in the cart</T>
              <ProgressBar done={done} total={items.length} />
            </Card>
          </Rise>

          <Rise index={2}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Well style={{ flex: 1, padding: 0 }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={() => void addItem()}
                  returnKeyType="done"
                  placeholder="Add an item…"
                  placeholderTextColor={colors.textFaint}
                  style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
                />
              </Well>
              <PressableScale onPress={() => void addItem()} accessibilityRole="button" accessibilityLabel="Add item" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ember, alignItems: "center", justifyContent: "center" }}>
                <Sym name="plus" size={18} color={colors.onEmber} />
              </PressableScale>
            </View>
          </Rise>

          <Rise index={3}>
            <SectionHeader title="To get" />
            {open.length === 0 ? (
              <Card><T kind="sub">{items.length > 0 ? "Everything's in the cart." : "The list is empty — add the first item above."}</T></Card>
            ) : (
              <Card padded={false}>{open.map((t, i) => <ItemRow key={t.id} t={t} i={i} />)}</Card>
            )}
          </Rise>

          {checked.length > 0 && (
            <Rise index={4}>
              <SectionHeader title="In the cart" />
              <Card padded={false}>{checked.map((t, i) => <ItemRow key={t.id} t={t} i={i} />)}</Card>
            </Rise>
          )}

          {smsLive && (
            <T kind="detail" center style={{ marginTop: spacing.sm }}>
              Anyone in the household can text items to Famili — the list stays current all week.
            </T>
          )}
        </>
      )}

      <HSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share list"
        heightPct={0.66}
        footer={<SheetCTA title="Review & send" onPress={() => void sendCopy()} disabled={!sharePhone.trim() || shareBusy} />}
      >
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
          <View style={{ gap: 8 }}>
            <T kind="eyebrow">Household access</T>
            <Card padded={false}>
              {members.filter((m) => !m.isCurrentUser).map((m, i) => (
                <View key={m.actorId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 11, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
                    <T kind="caption" color={colors.ember}>{m.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T kind="rowTitle">{m.displayName}</T>
                    <T kind="detail">{m.relationship ?? m.role} · can view & add</T>
                  </View>
                </View>
              ))}
            </Card>
          </View>
          <View style={{ gap: 8 }}>
            <T kind="eyebrow">Send a copy outside</T>
            <Well style={{ padding: 0 }}>
              <TextInput
                value={sharePhone}
                onChangeText={setSharePhone}
                placeholder="(555) 010-1234"
                placeholderTextColor={colors.textFaint}
                keyboardType="phone-pad"
                style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
              />
            </Well>
            <T kind="detail">Numbers outside the household need your approval before anything is sent.</T>
            {shareNote && <Notice text={shareNote} ok={false} />}
          </View>
        </View>
      </HSheet>
      {flash}
    </HScreen>
  );
}

// Assign-a-chore sheet (80%): what / who / when, then one tap to put a real
// chore on a kid's list (createTask type "chore" with assignee + due time).
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { api, type MemberRec, type TaskRec } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { T, Chip, ChipRow, Well, SymTile, PressableScale, HSheet, SheetCTA, useConfirmFlash } from "@/components/ui";

const SUGGESTIONS = [
  { title: "Feed the pet", icon: "pawprint" },
  { title: "Water the plants", icon: "sun.max" },
  { title: "Set the table", icon: "fork.knife" },
  { title: "Tidy your room", icon: "house" },
] as const;

function whenToDue(label: string): string {
  const d = new Date();
  if (label === "This weekend") {
    const day = d.getDay();
    d.setDate(d.getDate() + ((6 - day + 7) % 7 || 7));
    d.setHours(10, 0, 0, 0);
  } else {
    const [h, m] = label === "After school" ? [15, 0] : label === "Before dinner" ? [17, 30] : [19, 30];
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

export function isKidMember(m: MemberRec): boolean {
  return m.role.toLowerCase().includes("child") || (m.relationship ?? "").toLowerCase().includes("child");
}

export function ChoreSheet({ visible, onClose, members, onAssigned }: {
  visible: boolean;
  onClose: () => void;
  members: MemberRec[];
  onAssigned: () => void;
}) {
  const { colors, spacing } = useTheme();
  const { flash, show } = useConfirmFlash();
  const [title, setTitle] = useState("");
  const [kidId, setKidId] = useState<string | null>(null);
  const [when, setWhen] = useState("After school");
  const [counts, setCounts] = useState<Record<string, { done: number; total: number }>>({});
  const [busy, setBusy] = useState(false);

  const kids = useMemo(() => {
    const k = members.filter(isKidMember);
    return k.length ? k : members.filter((m) => !m.isCurrentUser);
  }, [members]);

  useEffect(() => {
    if (!visible) return;
    setTitle(""); setKidId(kids[0]?.actorId ?? null); setWhen("After school");
    void api.tasks().then((tasks: TaskRec[]) => {
      const byKid: Record<string, { done: number; total: number }> = {};
      for (const t of tasks) {
        if (t.type !== "chore" || !t.assignedMemberId) continue;
        const c = (byKid[t.assignedMemberId] ??= { done: 0, total: 0 });
        c.total += 1;
        if (t.status === "done") c.done += 1;
      }
      setCounts(byKid);
    });
  }, [visible, kids]);

  const kidFirst = kids.find((k) => k.actorId === kidId)?.displayName.split(" ")[0];

  async function assign() {
    if (!title.trim() || !kidId || busy) return;
    setBusy(true);
    const r = await api.createTask({ title: title.trim(), type: "chore", assignedMemberId: kidId, dueAt: whenToDue(when) });
    setBusy(false);
    if (r.error) {
      Alert.alert("Couldn't assign the chore", r.error === "insufficient_role" ? "Only household adults can assign chores." : "Something went wrong — try again.");
      return;
    }
    show("chore", () => { onAssigned(); onClose(); });
  }

  return (
    <>
      <HSheet
        visible={visible} onClose={onClose} title="Assign a chore" leftLabel="Cancel" heightPct={0.8}
        footer={<SheetCTA title={kidFirst ? `Assign to ${kidFirst}` : "Assign"} onPress={() => void assign()} disabled={!title.trim() || !kidId || busy} />}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }}>
          <View style={{ gap: 8 }}>
            <T kind="eyebrow">What</T>
            <Well style={{ padding: 0 }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Feed the pet"
                placeholderTextColor={colors.textFaint}
                style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
              />
            </Well>
            <ChipRow>
              {SUGGESTIONS.map((s) => (
                <Chip key={s.title} label={s.title} icon={s.icon} selected={title === s.title} onPress={() => setTitle(s.title)} />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: 8 }}>
            <T kind="eyebrow">Who</T>
            {kids.length === 0 ? (
              <Well><T kind="sub">No other household members yet — invite someone from Settings → Household.</T></Well>
            ) : (
              <View style={{ gap: 8 }}>
                {kids.map((k) => {
                  const on = kidId === k.actorId;
                  const c = counts[k.actorId];
                  return (
                    <PressableScale
                      key={k.actorId}
                      onPress={() => { tapHaptic("select"); setKidId(k.actorId); }}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 12, padding: 13,
                        borderRadius: 16, borderCurve: "continuous",
                        backgroundColor: colors.surface,
                        borderWidth: on ? 1.5 : 1, borderColor: on ? colors.ember : colors.border,
                      }}
                    >
                      <SymTile name="person.fill" color={on ? colors.ember : colors.textMuted} bg={on ? colors.emberBg : colors.surfaceSunken} size={40} iconSize={18} />
                      <View style={{ flex: 1 }}>
                        <T kind="rowTitle">{k.displayName.split(" ")[0]}</T>
                        <T kind="detail">{c ? `${c.done} of ${c.total} done` : "No chores yet"}</T>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <T kind="eyebrow">When</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {["After school", "Before dinner", "Before bed", "This weekend"].map((w) => (
                <View key={w} style={{ flexBasis: "47%", flexGrow: 1 }}>
                  <Chip label={w} selected={when === w} onPress={() => setWhen(w)} />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </HSheet>
      {flash}
    </>
  );
}

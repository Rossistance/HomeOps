// Playbooks — browse the household's step-by-step workflows: what each one is
// for, the numbered steps helpers follow, what it needs connected, and where it
// pauses for approval. Read-only on mobile; authoring stays in Ask Famili and
// on the web. (Redesigned port of the pre-Hearth src/app/playbooks.tsx.)
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { api, type PlaybookRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
// "ui/index" (not "ui"): the legacy src/components/ui.tsx still shadows the ui/
// directory until the old screens are all ported — this resolves the new system.
import { Badge, Chip, ChipRow, EmptyState, ErrorState, HScreen, PressableCard, Rise, SectionHeader, SkeletonCards, Sym, T } from "@/components/ui";

export default function PlaybooksScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();

  const [playbooks, setPlaybooks] = useState<PlaybookRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const all = await api.playbooks();
    if (all.length === 0 && !(await api.health())) {
      setError("The FamiliOS server didn't answer.");
    } else {
      setError(null);
      setPlaybooks(all.filter((p) => !p.archived));
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const categories = useMemo(
    () => [...new Set(playbooks.map((p) => p.category || "Custom"))].sort((a, b) => a.localeCompare(b)),
    [playbooks],
  );
  const sections = useMemo(() => {
    const map = new Map<string, PlaybookRec[]>();
    for (const p of playbooks) {
      const cat = p.category || "Custom";
      if (category !== "All" && cat !== category) continue;
      map.set(cat, [...(map.get(cat) ?? []), p]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [playbooks, category]);

  if (loading) return <HScreen><SkeletonCards count={4} /></HScreen>;
  if (error) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message={error} onRetry={() => void load()} /></HScreen>;

  let riseIdx = 0;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {playbooks.length === 0 ? (
        <EmptyState
          icon="book"
          title="No playbooks yet"
          hint="Ask Famili to draft one — a school-morning routine, a bill-triage checklist — or create one on the web app."
        />
      ) : (
        <>
          {categories.length > 1 ? (
            <Rise index={riseIdx++}>
              <ChipRow>
                <Chip label="All" icon="books.vertical" selected={category === "All"} onPress={() => setCategory("All")} />
                {categories.map((c) => (
                  <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
                ))}
              </ChipRow>
            </Rise>
          ) : null}

          {sections.map(([cat, items]) => (
            <View key={cat}>
              <SectionHeader title={cat} />
              <View style={{ gap: spacing.md }}>
                {items.map((p) => {
                  const open = expanded === p.id;
                  return (
                    <Rise key={p.id} index={riseIdx++}>
                      <PressableCard
                        onPress={() => setExpanded(open ? null : p.id)}
                        haptic="select"
                        scaleTo={0.99}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={`${p.name}, ${p.steps.length} steps${open ? ", collapse" : ", expand"}`}
                        style={{ gap: spacing.sm }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                          <View style={{ width: 34, height: 34, borderRadius: 11, borderCurve: "continuous", backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
                            <Sym name="book" size={17} color={colors.ember} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <T kind="h3" color={colors.text} numberOfLines={2}>{p.name}</T>
                          </View>
                          <Badge label={`${p.steps.length} steps`} fg={colors.textMuted} bg={colors.surfaceSunken} />
                          <Sym name={open ? "chevron.up" : "chevron.down"} size={13} color={colors.textFaint} />
                        </View>

                        {p.description ? (
                          <T kind="sub" numberOfLines={open ? undefined : 2}>{p.description}</T>
                        ) : null}

                        {open ? (
                          <Animated.View
                            entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
                            style={{ gap: spacing.lg, marginTop: spacing.xs }}
                          >
                            {p.whenToUse ? (
                              <View style={{ gap: 4 }}>
                                <T kind="eyebrow">When to use</T>
                                <T kind="sub" color={colors.textSecondary}>{p.whenToUse}</T>
                              </View>
                            ) : null}

                            <View style={{ gap: 6 }}>
                              <T kind="eyebrow">Steps</T>
                              <View>
                                {p.steps.map((s, i) => {
                                  const lastStep = i === p.steps.length - 1;
                                  return (
                                    <View key={i} style={{ flexDirection: "row", gap: spacing.md }}>
                                      <View style={{ alignItems: "center", width: 24 }}>
                                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
                                          <T kind="caption" color={colors.ember}>{i + 1}</T>
                                        </View>
                                        {!lastStep ? (
                                          <View style={{ flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.border, marginVertical: 3 }} />
                                        ) : null}
                                      </View>
                                      <T kind="sub" color={colors.textSecondary} style={{ flex: 1, paddingTop: 2, paddingBottom: lastStep ? 0 : spacing.md }}>
                                        {s}
                                      </T>
                                    </View>
                                  );
                                })}
                              </View>
                            </View>

                            {p.requiredConnections.length > 0 ? (
                              <View style={{ gap: 6 }}>
                                <T kind="eyebrow">Needs connected</T>
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                  {p.requiredConnections.map((c) => (
                                    <Badge key={c} label={c} icon="link" fg={colors.sky} bg={colors.skyBg} />
                                  ))}
                                </View>
                              </View>
                            ) : null}

                            {p.approvalRules.length > 0 ? (
                              <View style={{ gap: 6 }}>
                                <T kind="eyebrow">Pauses for approval</T>
                                <View style={{ gap: 5 }}>
                                  {p.approvalRules.map((r, i) => (
                                    <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                                      <Sym name="lock" size={12} color={colors.amber} style={{ marginTop: 3 }} />
                                      <T kind="sub" color={colors.textSecondary} style={{ flex: 1 }}>{r}</T>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            ) : null}

                            {p.outputFormat ? (
                              <View style={{ gap: 4 }}>
                                <T kind="eyebrow">Produces</T>
                                <T kind="sub" color={colors.textSecondary}>{p.outputFormat}</T>
                              </View>
                            ) : null}

                            {p.system ? (
                              <View style={{ flexDirection: "row" }}>
                                <Badge label="Built-in playbook" icon="checkmark.seal" fg={colors.sky} bg={colors.skyBg} />
                              </View>
                            ) : null}
                          </Animated.View>
                        ) : null}
                      </PressableCard>
                    </Rise>
                  );
                })}
              </View>
            </View>
          ))}

          <Rise index={riseIdx}>
            <T kind="caption" center color={colors.textFaint} style={{ marginTop: spacing.sm }}>
              Read them here — edit in Ask Famili or on the web app.
            </T>
          </Rise>
        </>
      )}
    </HScreen>
  );
}

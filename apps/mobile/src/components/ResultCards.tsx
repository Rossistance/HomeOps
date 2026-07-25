// Results as cards, in line, in the chat.
//
// Typed verbatim during the 2026-07-25 agent-chat recordings, after the third attempt:
// "still not returned in line, in chat, results as cards". The ask before it was
// "give me a list of the 5 best restaurants near me, sort them by highest to lowest and for
// each give me the results on whether it is often busy or not right now, estimated wait time"
// — a comparison. Prose plus two links is not a comparison; you cannot scan it.
//
// So every row a run fetched arrives as structure (`resultGroups` on the run_result message,
// built once in server/assistant-runs.mjs) and renders through ExpandCard, which means these
// inherit the three canonical rules: the title wraps, the identifying facts stay visible while
// collapsed, and the action sits at the bottom and collapses with the card.
//
// What each card shows is decided by what the tool actually returned. Nothing is invented —
// if a place's busy status and wait time weren't fetched, no chip claims them.
import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { router } from "expo-router";
import { useTheme, tapHaptic } from "@/theme";
import { mapQuery, openDirections, openInMaps } from "@/lib/maps";
import { ExpandCard, Sym, T, type CardChip } from "@/components/ui";
import { api, type ResultCardRec, type ResultGroupRec } from "@/lib/api";

/** Device-local formatting — the server deliberately ships `when` raw so this can happen here. */
function whenLabel(when: string | undefined, allDay?: boolean): string | null {
  if (!when) return null;
  const d = new Date(when);
  if (Number.isNaN(+d)) return when;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  });
  if (allDay) return date;
  return `${date} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Chips that survive collapse: when, where, then whatever facts the tool supplied. */
function chipsFor(card: ResultCardRec): CardChip[] {
  const out: CardChip[] = [];
  const when = whenLabel(card.when, card.allDay);
  if (when) out.push({ label: when, icon: "calendar", tone: "info" });
  if (card.where) out.push({ label: card.where, icon: "mappin.and.ellipse" });
  for (const m of card.meta ?? []) {
    // "Open now" / "Closed now" already read as a sentence — don't prefix them with a label.
    const label = /^(Open|Closed)\s/i.test(m.value) ? m.value : `${m.label} ${m.value}`;
    const tone: CardChip["tone"] =
      /^open now$/i.test(m.value) ? "good"
      : /^closed/i.test(m.value) || /^busy$/i.test(m.label) ? "warn"
      : "muted";
    out.push({ label, tone });
  }
  return out;
}

function iconFor(group: ResultGroupRec): string {
  const t = group.toolId ?? "";
  if (/calendar|event/i.test(t)) return "calendar";
  if (/task|todo|list/i.test(t)) return "checklist";
  if (/place|restaurant|maps|search/i.test(t)) return "mappin.and.ellipse";
  if (/mail|message|email/i.test(t)) return "envelope";
  if (/contact|people|member/i.test(t)) return "person.2";
  return "square.grid.2x2";
}

function ResultCard({ card, icon }: { card: ResultCardRec; icon: string }) {
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const place = mapQuery(card.where, card.title);
  /* A card that came out of a FILE is a proposal, not a record — "I found these items, here
   * are the cards, choose which ones you'd want to add." Adding is per-card on purpose: the
   * ones nobody taps are simply never created. */
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const cand = card.candidate;

  const addIt = async () => {
    if (!cand || adding || added) return;
    setAdding(true);
    const r = await api.addExtracted(cand);
    setAdding(false);
    if (!r.ok) {
      Alert.alert("Couldn't add that", r.message ?? "Something went wrong.");
      return;
    }
    tapHaptic("success");
    setAdded(true);
  };

  // The action is whatever this row can actually do. A card whose row has no address and no
  // link gets no button rather than a decorative one.
  const action = cand
    ? {
        label: added ? "Added" : adding ? "Adding…" : cand.type === "event" ? "Add to calendar" : cand.type === "list_item" ? "Add to groceries" : "Add task",
        icon: added ? "checkmark" : "plus",
        loading: adding,
        disabled: added,
        onPress: () => void addIt(),
      }
    : card.where
    ? { label: "Directions", icon: "location.fill", onPress: () => void openDirections(place, "apple").then((ok) => { if (!ok) Alert.alert("Couldn't open Maps"); }) }
    : card.url
      ? { label: "Open", icon: "safari", onPress: () => void Linking.openURL(card.url!) }
      : card.refId && /^evt|^task/.test(card.refId)
        ? { label: "Open", icon: "chevron.right", onPress: () => router.push(card.refId!.startsWith("task") ? "/(home)" : "/(home)") }
        : undefined;
  const secondaryAction = cand
    ? undefined
    : card.where && card.url
    ? { label: "Details", icon: "safari", onPress: () => void Linking.openURL(card.url!) }
    : card.where
      ? { label: "In Google Maps", icon: "map", onPress: () => void openInMaps(place, "google") }
      : undefined;

  return (
    <ExpandCard
      title={card.title}
      icon={icon}
      summary={card.detail}
      collapsedSummaryLines={2}
      chips={chipsFor(card)}
      expanded={open}
      onToggle={setOpen}
      action={action}
      secondaryAction={secondaryAction}
    >
      {/* Expanded: the address in full (it is the thing most often clipped — "I can't tell
          where that's at"), plus any fact that didn't fit the chip row. */}
      {card.where ? (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Sym name="mappin.and.ellipse" size={14} color={colors.textMuted} style={{ marginTop: 2 }} />
          <T kind="sub" selectable style={{ flex: 1 }}>{card.where}</T>
        </View>
      ) : null}
      {(card.meta ?? []).length > 0 ? (
        <View style={{ gap: 4 }}>
          {card.meta!.map((m, i) => (
            <View key={`${m.label}-${i}`} style={{ flexDirection: "row", gap: spacing.sm }}>
              <T kind="sub" color={colors.textFaint} style={{ width: 92 }}>{m.label}</T>
              <T kind="sub" color={colors.textSecondary} style={{ flex: 1 }}>{m.value}</T>
            </View>
          ))}
        </View>
      ) : null}
    </ExpandCard>
  );
}

/**
 * Every group of rows a run fetched. The group header names the step and the connection it
 * came through — A10's "what was involved" — so a list of events is visibly *your Google
 * calendar's* events and not something the assistant made up.
 */
export function ResultCards({ groups }: { groups: ResultGroupRec[] }) {
  const { colors, spacing } = useTheme();
  if (!groups?.length) return null;
  return (
    <View style={{ gap: spacing.md }}>
      {groups.map((g, gi) => {
        const icon = iconFor(g);
        return (
          <View key={`${g.title}-${gi}`} style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <T kind="eyebrow">{g.title}</T>
              {g.connector ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Sym name="link" size={10} color={colors.textFaint} />
                  <T kind="caption" color={colors.textFaint}>{g.connector}</T>
                </View>
              ) : null}
              <T kind="caption" color={colors.textFaint}>
                · {g.rows.length + (g.more ?? 0)} {g.rows.length + (g.more ?? 0) === 1 ? "result" : "results"}
              </T>
            </View>
            {g.rows.map((r, i) => <ResultCard key={`${r.title}-${i}`} card={r} icon={icon} />)}
            {g.more ? (
              // Never let a cap masquerade as the whole answer.
              <T kind="caption" color={colors.textFaint}>…and {g.more} more not shown here</T>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

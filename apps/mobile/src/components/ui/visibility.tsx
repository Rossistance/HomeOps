// Who can see this.
//
// "The privacy option needs to extend to tasks and lists for new or pre-existing tasks, it
//  needs to read just me, my nest, then everyone. The actual logic of who sees what needs to
//  extend throughout the app."
//
// THE ORDER IS THE POINT, and it was backwards. The Library offered "Everyone · Just me",
// which puts the widest possible audience under your thumb as the first thing you can hit,
// and reads as a scale that starts at maximum. Narrowest first is both the safer misfire and
// the order he drew: Just me → My Nest → Everyone.
//
// One component, because there were three different versions of this control and they didn't
// agree with each other or with the server. Tasks had a two-way boolean and inferred nest
// scope from which space chip happened to be selected — so the one scope people most wanted
// wasn't in the privacy control at all. The Library had two chips and sent a word ("personal")
// that the visibility gate has never recognised.
//
// MY NEST IS OFFERED ONLY WHEN THERE IS ONE. A chip that names a thing you don't have is a
// promise the app can't keep; with no nests the control is honestly a two-way choice. With
// several, picking My Nest reveals which — rather than guessing, which is how something ends
// up shared with the wrong half of the family.
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { Chip, ChipRow } from "./badge";
import { T } from "./text";

/** The stored vocabulary. Matches normalizeVisibility on the server exactly — the whole
 *  reason the old "personal" was a bug is that the two ends disagreed. */
export type Visibility = "private" | "nest" | "household";

export interface NestOption { id: string; label: string }

/** Mirrors normalizeVisibility in server/store.mjs.
 *
 * Both ends have to agree or the whole thing is theatre — a record stored under the Library's
 * old "personal" spelling has to read as private HERE too, or the badge says shared while the
 * server is (now correctly) hiding it. Anything unrecognised is the household default, which
 * is what an absent value has always meant. */
export function normalizeVisibility(v: string | null | undefined): Visibility {
  const s = String(v ?? "").toLowerCase();
  if (s === "private" || s === "personal") return "private";
  if (s === "nest") return "nest";
  return "household";
}

export function VisibilityPicker({ value, nestId, nests, onChange, label = "Who can see it" }: {
  value: Visibility;
  nestId: string | null;
  nests: NestOption[];
  onChange: (next: { visibility: Visibility; nestId: string | null }) => void;
  label?: string;
}) {
  const { colors } = useTheme();
  // Only asked for when it's ambiguous: with one nest, choosing "My Nest" has one meaning.
  const [choosing, setChoosing] = useState(false);
  const chosen = nests.find((n) => n.id === nestId) ?? null;

  const pickNest = () => {
    if (nests.length === 1) { onChange({ visibility: "nest", nestId: nests[0].id }); return; }
    if (chosen) { onChange({ visibility: "nest", nestId: chosen.id }); setChoosing(true); return; }
    setChoosing(true);
    onChange({ visibility: "nest", nestId: nests[0].id });
  };

  return (
    <View style={{ gap: 6 }}>
      <T kind="eyebrow">{label}</T>
      <ChipRow>
        {/* Narrowest first. */}
        <Chip label="Just me" icon="lock" selected={value === "private"}
          onPress={() => { setChoosing(false); onChange({ visibility: "private", nestId: null }); }} />
        {nests.length > 0 ? (
          <Chip label="My Nest" icon="person.2.fill" selected={value === "nest"} onPress={pickNest} />
        ) : null}
        <Chip label="Everyone" icon="house.fill" selected={value === "household"}
          onPress={() => { setChoosing(false); onChange({ visibility: "household", nestId: null }); }} />
      </ChipRow>

      {/* Which nest — only when there's a real question to answer. */}
      {value === "nest" && nests.length > 1 && (choosing || !chosen) ? (
        <ChipRow>
          {nests.map((n) => (
            <Chip key={n.id} label={n.label} selected={nestId === n.id}
              onPress={() => onChange({ visibility: "nest", nestId: n.id })} />
          ))}
        </ChipRow>
      ) : null}

      <T kind="caption" color={colors.textFaint}>{explain(value, chosen?.label)}</T>
    </View>
  );
}

/* Said plainly and specifically. "Only you" and "everyone" are the two claims a person is
 * most likely to check afterwards, so they're the two worth being exact about — and the nest
 * line names the nest, because "shared with your nest" is only reassuring if you know which
 * one the app means. */
function explain(v: Visibility, nestLabel?: string): string {
  if (v === "private") return "Only you — nobody else sees this, not even an admin.";
  if (v === "nest") return nestLabel ? `${nestLabel} only — the rest of the household can't see it.` : "Your nest only — the rest of the household can't see it.";
  return "Everyone in the household can see this, so they can offer to help.";
}

/** The same three states as a read-only badge, for a row that shows an existing item's scope. */
export function VisibilityNote({ visibility, nestLabel, children }: {
  visibility: Visibility; nestLabel?: string; children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <T kind="caption" color={colors.textFaint}>{explain(visibility, nestLabel)}</T>
      {children}
    </View>
  );
}

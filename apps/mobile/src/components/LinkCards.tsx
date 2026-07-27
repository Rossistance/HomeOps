// Links in an answer, as cards.
//
// "When results are returned for, let's say, this one — these are links. I asked it to look at a
//  picture and tell me similar items. These need to be displayed as CARDS, just like throughout
//  the app, within this actual chat card, this chat bubble — individual ones, so they're more
//  structured, I can see them, I can click on them."
//
// A lookup answer comes back as prose with markdown links threaded through it, and inline links
// in a paragraph are the hardest thing on the screen to hit and the easiest to miss. Everything
// else in this app that represents a THING you can go to is a card; a search result is a thing
// you can go to.
//
// The prose stays. He asked for the links to be cards, not for the sentences to be deleted, and
// the sentence around a result is usually why that result is there — "the closest match is X,
// though Y is cheaper" is doing work that a list of three cards cannot.
//
// Deduped by URL: a model that mentions the same page twice in one answer would otherwise
// produce two identical cards, which reads as a bug rather than as emphasis.
import { Linking, View } from "react-native";
import { useTheme } from "@/theme";
import { depth, rimColor } from "@/theme/neumorph";
import { PressableScale } from "./ui/pressable-scale";
import { Sym } from "./ui/symbol";
import { T } from "./ui/text";
import { linksIn, hostOf, type AnswerLink } from "@/lib/answer-links";

export function LinkCards({ links }: { links: AnswerLink[] }) {
  const { colors, dark, spacing } = useTheme();
  if (links.length === 0) return null;
  return (
    <View style={{ gap: 6, marginTop: spacing.sm }}>
      {links.map((l) => (
        <PressableScale
          key={l.url}
          onPress={() => void Linking.openURL(l.url).catch(() => {})}
          haptic="select"
          accessibilityRole="link"
          accessibilityLabel={`${l.title}, ${hostOf(l.url)}`}
          style={{
            flexDirection: "row", alignItems: "center", gap: spacing.sm,
            backgroundColor: dark ? colors.surfaceSunken : colors.bg,
            borderRadius: 12, borderCurve: "continuous",
            borderWidth: 1, borderColor: rimColor(colors, dark),
            boxShadow: depth("raisedSm", colors, dark),
            paddingHorizontal: spacing.md, paddingVertical: 10,
          }}
        >
          <Sym name="globe" size={16} color={colors.sky} />
          <View style={{ flex: 1, gap: 1 }}>
            <T kind="subMedium" color={colors.text} numberOfLines={2}>{l.title}</T>
            {/* The host, so you know where a tap is about to take you before it does. */}
            <T kind="caption" color={colors.textFaint} numberOfLines={1}>{hostOf(l.url)}</T>
          </View>
          <Sym name="arrow.up.right" size={13} color={colors.textMuted} />
        </PressableScale>
      ))}
    </View>
  );
}

export { linksIn };
export type { AnswerLink };

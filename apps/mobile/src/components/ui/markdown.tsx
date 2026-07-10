// Minimal markdown renderer for assistant responses: headings, bullets,
// numbered lists, bold/italic/inline-code, fenced code blocks, and tappable
// [text](url) / bare-URL links. Deliberately dependency-free; anything
// unrecognized falls through as plain text.
import { Linking, View } from "react-native";
import { Text } from "react-native";
import { useTheme, fonts } from "@/theme";
import { T } from "./text";

function inline(text: string, colors: { text: string; ember: string; surfaceSunken: string }, keyBase: string) {
  // Tokenize [links](url), bare URLs, **bold**, *italic*, `code`
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)<>"']+|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    const md = p.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (md) {
      return (
        <Text
          key={key}
          accessibilityRole="link"
          onPress={() => { void Linking.openURL(md[2]); }}
          style={{ color: colors.ember, textDecorationLine: "underline", fontFamily: fonts.semibold }}
        >
          {md[1]}
        </Text>
      );
    }
    if (/^https?:\/\//.test(p)) {
      const clean = p.replace(/[.,;:]+$/, "");
      return (
        <Text
          key={key}
          accessibilityRole="link"
          onPress={() => { void Linking.openURL(clean); }}
          style={{ color: colors.ember, textDecorationLine: "underline" }}
        >
          {clean}
        </Text>
      );
    }
    if (p.startsWith("**") && p.endsWith("**")) return <Text key={key} style={{ fontFamily: fonts.semibold }}>{p.slice(2, -2)}</Text>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <Text key={key} style={{ fontStyle: "italic" }}>{p.slice(1, -1)}</Text>;
    if (p.startsWith("`") && p.endsWith("`")) {
      return <Text key={key} style={{ fontFamily: "Menlo", fontSize: 13, backgroundColor: colors.surfaceSunken }}>{p.slice(1, -1)}</Text>;
    }
    return <Text key={key}>{p}</Text>;
  });
}

export function MarkdownText({ text }: { text: string }) {
  const { colors, spacing } = useTheme();
  const blocks: Array<{ kind: "code" | "text"; body: string }> = [];
  const fence = text.split(/```[a-zA-Z]*\n?/);
  fence.forEach((seg, i) => blocks.push({ kind: i % 2 === 1 ? "code" : "text", body: seg }));

  return (
    <View style={{ gap: spacing.sm }}>
      {blocks.map((b, bi) => {
        if (!b.body.trim()) return null;
        if (b.kind === "code") {
          return (
            <View key={bi} style={{ backgroundColor: colors.surfaceSunken, borderRadius: 10, borderCurve: "continuous", padding: spacing.md }}>
              <Text selectable style={{ fontFamily: "Menlo", fontSize: 12.5, lineHeight: 18, color: colors.textSecondary }}>{b.body.replace(/\n$/, "")}</Text>
            </View>
          );
        }
        const lines = b.body.split("\n");
        return (
          <View key={bi} style={{ gap: 3 }}>
            {lines.map((ln, li) => {
              const key = `${bi}-${li}`;
              const h = ln.match(/^(#{1,3})\s+(.*)/);
              if (h) return <T key={key} kind={h[1].length === 1 ? "h2" : "h3"} color={colors.text} style={{ marginTop: li ? 6 : 0 }}>{h[2]}</T>;
              const bullet = ln.match(/^\s*[-*]\s+(.*)/);
              if (bullet) {
                return (
                  <View key={key} style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}>
                    <T color={colors.ember} style={{ lineHeight: 22 }}>•</T>
                    <T selectable style={{ flex: 1 }}>{inline(bullet[1], colors, key)}</T>
                  </View>
                );
              }
              const num = ln.match(/^\s*(\d+)[.)]\s+(.*)/);
              if (num) {
                return (
                  <View key={key} style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}>
                    <T kind="bodyMedium" color={colors.textMuted} style={{ minWidth: 18, lineHeight: 22 }}>{num[1]}.</T>
                    <T selectable style={{ flex: 1 }}>{inline(num[2], colors, key)}</T>
                  </View>
                );
              }
              if (!ln.trim()) return null;
              return <T key={key} selectable>{inline(ln, colors, key)}</T>;
            })}
          </View>
        );
      })}
    </View>
  );
}

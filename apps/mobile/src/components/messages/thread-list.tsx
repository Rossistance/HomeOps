// The Messages segment of the Inbox: search, New message, and one row per thread with an
// avatar stack, the title (never my own name), the last line, how long ago, unread count
// and a muted mark. Tapping opens the thread; search results jump into the thread at the hit.
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { router } from "expo-router";
import { api, type MessageRec, type ThreadRec } from "@/lib/api";
import { threadTitle } from "@/lib/messages";
import { memberAccent, fade } from "@/lib/member-colors";
import { useTheme } from "@/theme";
import { T, Card, Button, EmptyState, Sym, PressableScale, Rise } from "@/components/ui";

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AvatarStack({ t, meActorId, size = 40 }: { t: ThreadRec; meActorId: string | null | undefined; size?: number }) {
  const { colors } = useTheme();
  const others = t.members.filter((m) => !m.leftAt && m.actorId !== meActorId).slice(0, 2);
  if (others.length === 0) return <View style={{ width: size, height: size }} />;
  const tile = (m: ThreadRec["members"][number], i: number, small: boolean) => {
    const accent = memberAccent(colors, m.color ?? null) ?? colors.sky;
    const s = small ? size * 0.68 : size;
    return (
      <View key={m.actorId} style={{ position: "absolute", left: small ? (i === 0 ? 0 : size - s) : 0, top: small ? (i === 0 ? 0 : size - s) : 0, width: s, height: s, borderRadius: s / 2, backgroundColor: fade(accent, 0.18), borderWidth: 1.5, borderColor: accent, alignItems: "center", justifyContent: "center" }}>
        <T kind="subMedium" color={accent} style={{ fontSize: Math.max(10, s * 0.34) }}>{(m.displayName || "?").slice(0, 1)}</T>
      </View>
    );
  };
  return <View style={{ width: size, height: size }}>{others.map((m, i) => tile(m, i, others.length > 1))}</View>;
}

export function ThreadList({ threads, meActorId, now, onChanged }: { threads: ThreadRec[]; meActorId: string | null | undefined; now: number; onChanged: () => void }) {
  const { colors, spacing } = useTheme();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ threadId: string; message: MessageRec }[] | null>(null);
  const [hitThreads, setHitThreads] = useState<Record<string, ThreadRec>>({});

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setHits(null); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      void api.searchMessages(needle).then((r) => { if (cancelled) return; setHits(r.hits); setHitThreads(r.threads); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q]);
  void onChanged;

  const live = threads.filter((t) => !t.archived);
  return (
    <>
      <Rise index={1}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 999, backgroundColor: colors.surfaceSunken }}>
            <Sym name="magnifyingglass" size={14} color={colors.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search messages"
              placeholderTextColor={colors.textFaint}
              style={{ flex: 1, color: colors.text, fontSize: 15 }}
              accessibilityLabel="Search messages"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          <Button title="New" small icon="square.and.pencil" variant="ember" onPress={() => router.push("/messages/new" as never)} />
        </View>
      </Rise>
      {hits ? (
        <Rise index={2}>
          {hits.length === 0 ? (
            <EmptyState icon="magnifyingglass" title="No matches" hint="Search looks through the messages in your threads." />
          ) : (
            <Card padded={false}>
              {hits.map((h, i) => {
                const t = hitThreads[h.threadId];
                return (
                  <PressableScale
                    key={h.message.id}
                    onPress={() => router.push({ pathname: "/messages/[id]", params: { id: h.threadId, jump: h.message.id } } as never)}
                    haptic="select"
                    accessibilityRole="button"
                    accessibilityLabel={`Message in ${t ? threadTitle(t, meActorId) : "a thread"}: ${h.message.text}`}
                    style={{ paddingHorizontal: spacing.lg, paddingVertical: 12, gap: 2, borderBottomWidth: i === hits.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
                  >
                    <T kind="caption" color={colors.textFaint}>{t ? threadTitle(t, meActorId) : ""} · {ago(h.message.at, now)}</T>
                    <T kind="sub" color={colors.text} numberOfLines={2}>{h.message.text || (h.message.attachments[0] && "name" in h.message.attachments[0] ? h.message.attachments[0].name : "Attachment")}</T>
                  </PressableScale>
                );
              })}
            </Card>
          )}
        </Rise>
      ) : live.length === 0 ? (
        <Rise index={2}>
          <EmptyState icon="bubble.left.and.bubble.right" title="No messages yet" hint="Start one with anyone in the family. Add people later to turn it into a group." action={{ title: "New message", onPress: () => router.push("/messages/new" as never) }} />
        </Rise>
      ) : (
        <Rise index={2}>
          <Card padded={false}>
            {live.map((t, i) => {
              const unread = t.unreadCount > 0;
              return (
                <PressableScale
                  key={t.id}
                  onPress={() => router.push({ pathname: "/messages/[id]", params: { id: t.id } } as never)}
                  haptic="select"
                  accessibilityRole="button"
                  accessibilityLabel={`${threadTitle(t, meActorId)}${unread ? `, ${t.unreadCount} unread` : ""}${t.muted ? ", muted" : ""}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: i === live.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
                >
                  <AvatarStack t={t} meActorId={meActorId} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <T kind={unread ? "bodyMedium" : "body"} color={colors.text} style={{ flex: 1 }} numberOfLines={1}>{threadTitle(t, meActorId)}</T>
                      {t.muted ? <Sym name="bell.slash" size={12} color={colors.textFaint} /> : null}
                      <T kind="caption" color={unread ? colors.ember : colors.textFaint}>{ago(t.lastMessageAt, now)}</T>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <T kind="sub" color={unread ? colors.textSecondary : colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
                        {t.lastPreview ? `${t.lastPreview.actorId === meActorId ? "You" : t.lastPreview.from.split(" ")[0]}: ${t.lastPreview.text}` : "No messages yet"}
                      </T>
                      {unread ? (
                        <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.ember }}>
                          <T kind="caption" color={colors.onEmber}>{t.unreadCount > 99 ? "99+" : String(t.unreadCount)}</T>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </PressableScale>
              );
            })}
          </Card>
        </Rise>
      )}
    </>
  );
}

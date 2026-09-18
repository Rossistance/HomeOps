// Share a thing from anywhere in the app into a family chat: pick a thread (or start one),
// see the card the others will get, add a note, send. The item itself is not changed — a
// private event shared here stays private; the recipients get the preview the server lets
// them see.
import { useEffect, useState, type ReactElement } from "react";
import { TextInput, View } from "react-native";
import { router } from "expo-router";
import { api, type ShareType, type SharePreview, type ThreadRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { threadTitle } from "@/lib/messages";
import { useTheme, tapHaptic } from "@/theme";
import { T, Card, Row, HSheet, SheetCTA, Notice, Sym, PressableScale } from "@/components/ui";
import { ShareCard } from "@/components/messages/share-card";
import { AvatarStack } from "@/components/messages/thread-list";

export interface ShareTarget { type: ShareType; id: string; preview: SharePreview }

export function ShareToThreadSheet({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const [threads, setThreads] = useState<ThreadRec[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!target) { setThreads(null); setPicked(null); setNote(""); setErr(null); return; }
    void api.threads().then((ts) => { const live = ts.filter((t) => !t.archived && !t.left); setThreads(live); setPicked(live[0]?.id ?? null); });
  }, [target]);

  async function send() {
    if (!target || !picked) return;
    setBusy(true); setErr(null);
    const r = await api.sendMessage(picked, { text: note.trim(), attachments: [{ kind: "ref", type: target.type, id: target.id }] });
    setBusy(false);
    if (r.error && r.error !== "queued_offline") { tapHaptic("error"); setErr(r.error); return; }
    tapHaptic("success");
    onClose();
    router.push({ pathname: "/messages/[id]", params: { id: picked } } as never);
  }

  return (
    <HSheet visible={!!target} onClose={onClose} title="Share to a chat" heightPct={0.8}
      footer={<SheetCTA title={busy ? "Sending…" : "Send"} disabled={!picked || busy} onPress={() => void send()} />}
    >
      {target ? (
        <View style={{ gap: spacing.md }}>
          <ShareCard type={target.type} preview={target.preview} mine={false} />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={4000}
            accessibilityLabel="Note to send with it"
            style={{ minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.surfaceSunken, color: colors.text, fontSize: 16 }}
          />
          <T kind="eyebrow">Send to</T>
          {threads === null ? null : threads.length === 0 ? (
            <Card>
              <T kind="sub">No chats yet.</T>
              <Row icon="square.and.pencil" title="Start a new message" chevron onPress={() => { onClose(); router.push("/messages/new" as never); }} last />
            </Card>
          ) : (
            <Card padded={false}>
              {threads.map((t, i) => (
                <PressableScale
                  key={t.id}
                  onPress={() => setPicked(t.id)}
                  haptic="select"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked === t.id }}
                  accessibilityLabel={threadTitle(t, session?.actorId)}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 11, borderBottomWidth: i === threads.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
                >
                  <AvatarStack t={t} meActorId={session?.actorId} size={34} />
                  <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={1}>{threadTitle(t, session?.actorId)}</T>
                  <Sym name={picked === t.id ? "checkmark.circle.fill" : "circle"} size={20} color={picked === t.id ? colors.ember : colors.textFaint} />
                </PressableScale>
              ))}
              <Row icon="square.and.pencil" title="New message…" chevron onPress={() => { onClose(); router.push("/messages/new" as never); }} last />
            </Card>
          )}
          {err ? <Notice text={err} ok={false} /> : null}
        </View>
      ) : null}
    </HSheet>
  );
}

/** Build the preview the sheet shows before the server has one, from what the screen knows. */
export function localPreview(type: ShareType, id: string, fields: Partial<SharePreview>): ShareTarget {
  return { type, id, preview: { type, id, ...fields } };
}

/** One hook for every screen with a Share action: `share(target)` opens the sheet, `sheet`
 *  is rendered once near the screen's root. */
export function useShareToThread(): { share: (t: ShareTarget) => void; sheet: ReactElement } {
  const [target, setTarget] = useState<ShareTarget | null>(null);
  return { share: setTarget, sheet: <ShareToThreadSheet target={target} onClose={() => setTarget(null)} /> };
}

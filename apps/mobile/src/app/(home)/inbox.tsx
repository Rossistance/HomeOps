// Unified Inbox — everything waiting on you in one place. A chip-style
// segmented bar switches between Approvals (decisions the helpers are blocked
// on), Updates (the durable delivery inbox), and Chats (assistant
// conversations). Counts stay live across all three segments.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { api, type ApprovalRec, type ConversationRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { useTheme, riskColor, statusColor, tapHaptic } from "@/theme";
// NOTE: "/index" is deliberate — the legacy src/components/ui.tsx still exists
// until the old screens are deleted, and it shadows the ui/ directory on the
// bare "@/components/ui" specifier. This path resolves the new kit either way.
import {
  T, Card, Well, Button, Badge, Row, SectionHeader, SkeletonCards,
  EmptyState, ErrorState, Notice, Rise, HScreen, Sym, SymTile, PressableScale,
} from "@/components/ui";

type Segment = "approvals" | "updates" | "chats";
type NoticeRec = { id: string; channel: string; title: string; body: string; read: boolean; createdAt: number };

// Channel → SF symbol for the delivery inbox rows.
const CHANNEL_ICON: Record<string, string> = {
  in_app: "app.badge",
  email: "envelope",
  sms: "message",
  dashboard: "rectangle.on.rectangle",
};

// The approval record deliberately carries only a hash of its input — the REAL resolved
// content lives on the originating run step. Render it as readable "Label: value" lines
// (long id lists collapse to a count), mirroring the web's formatApprovalInput.
function formatInput(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v == null || v === "") continue;
    const label = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
    const s = Array.isArray(v) ? v : typeof v === "string" && v.includes(",") && v.length > 60 ? v.split(",") : null;
    if (s && s.length > 3) { lines.push(`${label}: ${s.length} item(s)`); continue; }
    const text = typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push(`${label}: ${text.length > 120 ? text.slice(0, 117) + "…" : text}`);
  }
  return lines.join("\n");
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function agoIso(iso: string, now: number): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ago(t, now) : "";
}

// Live expiry countdown for a pending approval (the server enforces the real
// deadline — this is honest signal, not a client-side gate).
function expiryLabel(expiresAt: number, now: number): { text: string; urgent: boolean; expired: boolean } {
  const ms = expiresAt - now;
  if (ms <= 0) return { text: "Expired", urgent: false, expired: true };
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return { text: `Expires in ${m}m`, urgent: m <= 15, expired: false };
  const h = Math.floor(m / 60);
  if (h < 24) return { text: `Expires in ${h}h ${m % 60}m`, urgent: false, expired: false };
  return { text: `Expires in ${Math.floor(h / 24)}d`, urgent: false, expired: false };
}

// Last-message preview for a conversation row. An old thread's plan turn can carry no text
// of its own, so its title stands in rather than leaving the row blank.
function convoPreview(c: ConversationRec): string {
  const last = c.messages[c.messages.length - 1];
  if (!last) return "No messages yet";
  const text = last.text || last.plan?.title || "";
  return text.replace(/\s+/g, " ").trim() || "No messages yet";
}

export default function InboxScreen() {
  const { session } = useSession();
  const { colors, dark, spacing, radii } = useTheme();

  const [seg, setSeg] = useState<Segment>("approvals");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Approvals
  const [approvalItems, setApprovalItems] = useState<ApprovalRec[]>([]);
  const [stepInputs, setStepInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decisionMsg, setDecisionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Updates
  const [notices, setNotices] = useState<NoticeRec[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ text: string; ok: boolean } | null>(null);

  // Chats
  const [convos, setConvos] = useState<ConversationRec[]>([]);

  const load = useCallback(async () => {
    // list endpoints swallow transport errors into empty arrays, so probe
    // health alongside them to render an honest error state instead of a
    // false "all caught up".
    const [health, approvals, delivered, conversations] = await Promise.all([
      api.health(), api.approvals(), api.notifications(), api.conversations(),
    ]);
    if (!health?.ok) {
      setError("The FamiliOS backend didn't answer.");
      setLoaded(true);
      return;
    }
    setError(null);
    setApprovalItems(approvals);
    setNotices(delivered);
    setConvos(conversations);
    // Enrich pending approvals with the gated run step's REAL resolved input.
    if (approvals.some((a) => a.status === "pending")) {
      const runs = await api.runs("waiting_for_approval");
      const map: Record<string, string> = {};
      for (const r of runs) for (const s of r.steps) {
        if (s.approvalId && Object.keys(s.input ?? {}).length) {
          const txt = formatInput(s.input);
          if (txt) map[s.approvalId] = txt;
        }
      }
      setStepInputs(map);
    } else {
      setStepInputs({});
    }
    setNow(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => { if (session) void load(); }, [session, load]);
  useRevSync(useCallback(() => { void load(); }, [load]));
  // 30s tick keeps expiry countdowns and time-ago labels honest while open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const decide = useCallback(async (a: ApprovalRec, approve: boolean) => {
    setBusyId(a.id);
    setDecisionMsg(null);
    const r = await api.decideApproval(a.id, approve);
    if (r.error) {
      tapHaptic("error");
      setDecisionMsg({ text: `Couldn't ${approve ? "approve" : "deny"} ${a.toolId}: ${r.error}`, ok: false });
    } else {
      tapHaptic(approve ? "success" : "warning");
      setDecisionMsg({ text: approve ? `Approved — ${a.toolId} can run.` : `Denied — ${a.toolId} will not run.`, ok: approve });
    }
    await load();
    setBusyId(null);
  }, [load]);

  const confirmDeny = useCallback((a: ApprovalRec) => {
    Alert.alert("Deny this request?", `"${a.toolId}" will be blocked from running.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Deny", style: "destructive", onPress: () => void decide(a, false) },
    ]);
  }, [decide]);

  const markRead = useCallback(async (n: NoticeRec) => {
    if (n.read) return;
    setNotices((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x))); // optimistic
    const r = await api.markNotificationRead(n.id);
    if (!r.ok) void load(); // restore server truth on failure
  }, [load]);

  // Real delivery through the same channel router the helpers use — no fake success.
  const sendTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const r = await api.notify({ methodType: "In-App", title: "FamiliOS test", body: "Test notification from your phone — delivery is working." });
    setTesting(false);
    setTestResult(r.delivered
      ? { text: "Delivered — it's at the top of the list.", ok: true }
      : { text: r.message ?? r.error ?? "Delivery failed.", ok: false });
    await load();
  }, [load]);

  const confirmDeleteConvo = useCallback((c: ConversationRec) => {
    Alert.alert("Delete conversation?", `"${c.title || "Untitled chat"}" and its messages will be removed from every device.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setConvos((list) => list.filter((x) => x.id !== c.id)); // optimistic
          void (async () => {
            const r = await api.deleteConversation(c.id);
            if (r.error) { tapHaptic("error"); await load(); }
            else tapHaptic("success");
          })();
        },
      },
    ]);
  }, [load]);

  const pending = useMemo(() => approvalItems.filter((a) => a.status === "pending"), [approvalItems]);
  const decided = useMemo(() => approvalItems.filter((a) => a.status !== "pending").slice(0, 10), [approvalItems]);
  const unreadCount = useMemo(() => notices.filter((n) => !n.read).length, [notices]);
  const sortedConvos = useMemo(
    () => [...convos].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)),
    [convos],
  );

  const segments: { key: Segment; label: string; count: number; countNoun: string }[] = [
    { key: "approvals", label: "Approvals", count: pending.length, countNoun: "pending" },
    { key: "updates", label: "Updates", count: unreadCount, countNoun: "unread" },
    { key: "chats", label: "Chats", count: sortedConvos.length, countNoun: "conversations" },
  ];

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {/* Chip-style segmented bar with live count badges. */}
      <Rise index={0}>
        <View style={{ flexDirection: "row", gap: 4, padding: 4, backgroundColor: colors.surfaceSunken, borderRadius: radii.pill }}>
          {segments.map((s) => {
            const selected = seg === s.key;
            return (
              <PressableScale
                key={s.key}
                haptic={null}
                onPress={() => { if (!selected) { tapHaptic("select"); setSeg(s.key); } }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={s.count > 0 ? `${s.label}, ${s.count} ${s.countNoun}` : s.label}
                style={{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                  paddingVertical: 8, borderRadius: radii.pill,
                  backgroundColor: selected ? colors.surface : "transparent",
                  borderWidth: 1, borderColor: selected ? (dark ? colors.rim : colors.border) : "transparent",
                  boxShadow: selected && !dark ? `0 2px 8px ${colors.shadow}` : "none",
                }}
              >
                <T kind="subMedium" color={selected ? colors.text : colors.textMuted}>{s.label}</T>
                {s.count > 0 ? (
                  <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.emberBg }}>
                    <T kind="caption" color={colors.ember}>{s.count > 99 ? "99+" : String(s.count)}</T>
                  </View>
                ) : null}
              </PressableScale>
            );
          })}
        </View>
      </Rise>

      {!loaded ? (
        <SkeletonCards count={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : seg === "approvals" ? (
        <>
          {decisionMsg ? <Rise index={1}><Notice text={decisionMsg.text} ok={decisionMsg.ok} /></Rise> : null}
          {pending.length === 0 ? (
            <Rise index={1}>
              <EmptyState icon="checkmark.seal" title="Nothing waiting on you" hint="When a helper needs your sign-off, the request lands here. Server-enforced — nothing runs without it." />
            </Rise>
          ) : (
            pending.map((a, i) => {
              const risk = riskColor(colors, a.risk);
              const exp = expiryLabel(a.expiresAt, now);
              const expColor = exp.expired ? colors.coral : exp.urgent ? colors.amber : colors.textFaint;
              return (
                <Rise key={a.id} index={i + 1}>
                  <Card>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <T kind="h3" color={colors.text} style={{ flex: 1 }}>{a.toolId}</T>
                      <Badge label={`${a.risk} risk`} fg={risk.fg} bg={risk.bg} />
                    </View>
                    {a.preview ? <T kind="sub" style={{ marginTop: 6 }}>{a.preview}</T> : null}
                    {stepInputs[a.id] ? (
                      <Well style={{ marginTop: spacing.sm }}>
                        <T kind="sub" color={colors.textSecondary} selectable>{stepInputs[a.id]}</T>
                      </Well>
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm }}>
                      <T kind="caption" color={colors.textFaint} style={{ flex: 1 }} numberOfLines={1}>
                        {a.category}{a.connectorId ? ` · ${a.connectorId}` : ""}
                      </T>
                      <Sym name="clock" size={11} color={expColor} />
                      <T kind="caption" color={expColor}>{exp.text}</T>
                    </View>
                    <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                      <View style={{ flex: 1 }}>
                        <Button title="Approve" variant="success" icon="checkmark" loading={busyId === a.id} onPress={() => void decide(a, true)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button title="Deny" variant="danger" icon="xmark" disabled={busyId === a.id} onPress={() => confirmDeny(a)} />
                      </View>
                    </View>
                  </Card>
                </Rise>
              );
            })
          )}
          {decided.length > 0 ? (
            <Rise index={pending.length + 1}>
              <SectionHeader title="Recently decided" />
              <Card padded={false} style={{ opacity: 0.85 }}>
                {decided.map((a, i) => {
                  // WP-004: statusColor() doesn't recognize "expired" and would fall to
                  // its neutral gray default — an expired approval means nothing was
                  // sent, which deserves the same visible caution as a denial, not a
                  // shrug.
                  const sc = a.status === "approved" || a.status === "consumed"
                    ? { fg: colors.sage, bg: colors.sageBg }
                    : a.status === "expired"
                      ? { fg: colors.coral, bg: colors.coralBg }
                      : statusColor(colors, a.status);
                  return (
                    <Row
                      key={a.id}
                      title={a.toolId}
                      subtitle={a.decidedAt ? `${a.decidedBy ? `${a.decidedBy} · ` : ""}${ago(a.decidedAt, now)}` : undefined}
                      trailing={<Badge label={a.status} fg={sc.fg} bg={sc.bg} />}
                      last={i === decided.length - 1}
                    />
                  );
                })}
              </Card>
            </Rise>
          ) : null}
        </>
      ) : seg === "updates" ? (
        <>
          {notices.length === 0 ? (
            <Rise index={1}>
              <EmptyState icon="app.badge" title="No updates yet" hint="In-app deliveries from helpers and approvals land here. Send a test below to see the real path work." />
            </Rise>
          ) : (
            <Rise index={1}>
              <Card padded={false}>
                {notices.map((n, i) => (
                  <PressableScale
                    key={n.id}
                    scaleTo={0.99}
                    haptic={n.read ? null : "select"}
                    onPress={() => {
                      /* Cluster I — "when I go to select one, I can't actually see any
                       * context about it… if I click it, I can't see any more. It just
                       * disappears." A notification that only knows how to vanish is a
                       * dead end. If it names a thing, tapping goes TO the thing; marking
                       * read rides along instead of being the whole event. */
                      void markRead(n);
                      const d = (n as { data?: { type?: string; id?: string } }).data;
                      if (d?.type === "event" && d.id) router.push({ pathname: "/event-form", params: { id: d.id } });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${n.title}${n.read ? "" : ", unread"}`}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13, borderBottomWidth: i === notices.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                      <SymTile
                        name={CHANNEL_ICON[n.channel] ?? "app.badge"}
                        color={n.read ? colors.textFaint : colors.ember}
                        bg={n.read ? colors.surfaceSunken : colors.emberBg}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          {!n.read ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ember }} /> : null}
                          <T kind={n.read ? "body" : "bodyMedium"} color={n.read ? colors.textSecondary : colors.text} style={{ flex: 1 }} numberOfLines={2}>{n.title}</T>
                        </View>
                        {n.body ? <T kind="sub" numberOfLines={2}>{n.body}</T> : null}
                        <T kind="caption" color={colors.textFaint}>{ago(n.createdAt, now)}{n.read ? "" : " · tap to mark read"}</T>
                      </View>
                    </View>
                  </PressableScale>
                ))}
              </Card>
            </Rise>
          )}
          <Rise index={2}>
            <SectionHeader title="Delivery check" />
            <Card>
              <T kind="sub">Sends a real in-app notification through the same channel router helpers use.</T>
              <View style={{ marginTop: spacing.md, alignSelf: "flex-start" }}>
                <Button title="Send test" small icon="paperplane" loading={testing} onPress={() => void sendTest()} />
              </View>
              {testResult ? <View style={{ marginTop: spacing.sm }}><Notice text={testResult.text} ok={testResult.ok} /></View> : null}
            </Card>
          </Rise>
        </>
      ) : (
        <>
          {sortedConvos.length === 0 ? (
            <Rise index={1}>
              <EmptyState
                icon="bubble.left.and.bubble.right"
                title="No conversations yet"
                hint="Chats you start with Ask Famili appear here — on every device."
                action={{ title: "Ask Famili", onPress: () => router.push("/(ask)") }}
              />
            </Rise>
          ) : (
            <Rise index={1}>
              <Card padded={false}>
                {sortedConvos.map((c, i) => (
                  <Row
                    key={c.id}
                    icon="bubble.left"
                    title={c.title || "Conversation"}
                    subtitle={convoPreview(c)}
                    trailing={<T kind="caption" color={colors.textFaint}>{agoIso(c.updatedAt, now)}</T>}
                    chevron
                    onPress={() => router.push(`/(ask)?c=${c.id}`)}
                    onLongPress={() => confirmDeleteConvo(c)}
                    last={i === sortedConvos.length - 1}
                  />
                ))}
              </Card>
            </Rise>
          )}
        </>
      )}
    </HScreen>
  );
}

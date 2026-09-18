// Unified Inbox — everything waiting on you in one place, read left to right:
// Messages (the family talking to each other), Approvals (decisions the helpers are
// blocked on) and Updates (every deliverable, grouped by who sent it, each one openable
// in full and one tap from the helper's own chat). Counts stay live across all three.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { api, type ApprovalRec, type NotificationRec, type PublicHelper } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { notificationSources, sourceKeyOf, notificationTarget } from "@/lib/messages";
import { useTheme, riskColor, statusColor, tapHaptic } from "@/theme";
// NOTE: "/index" is deliberate — the legacy src/components/ui.tsx still exists
// until the old screens are deleted, and it shadows the ui/ directory on the
// bare "@/components/ui" specifier. This path resolves the new kit either way.
import {
  T, Card, Well, Button, Badge, Row, SectionHeader, SkeletonCards,
  EmptyState, ErrorState, Notice, Rise, HScreen, Sym, SymTile, PressableScale, Chip,
} from "@/components/ui";

type Segment = "messages" | "approvals" | "updates";

// Source → SF symbol for an update row's tile.
const SOURCE_ICON: Record<string, string> = {
  helper: "sparkles",
  assistant: "sparkle",
  thread: "bubble.left.and.bubble.right",
  member: "person",
  system: "app.badge",
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

export default function InboxScreen() {
  const { session } = useSession();
  const { colors, dark, spacing, radii } = useTheme();

  const params = useLocalSearchParams<{ seg?: string }>();
  const [seg, setSeg] = useState<Segment>(
    params.seg === "approvals" || params.seg === "updates" || params.seg === "messages" ? params.seg : "messages",
  );
  useEffect(() => {
    if (params.seg === "approvals" || params.seg === "updates" || params.seg === "messages") setSeg(params.seg);
  }, [params.seg]);
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
  const [notices, setNotices] = useState<NotificationRec[]>([]);
  const [helpers, setHelpers] = useState<PublicHelper[]>([]);
  const [sourceKey, setSourceKey] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    // list endpoints swallow transport errors into empty arrays, so probe
    // health alongside them to render an honest error state instead of a
    // false "all caught up".
    const [health, approvals, delivered, helperList] = await Promise.all([
      api.health(), api.approvals(), api.notifications(), api.helpers(),
    ]);
    if (!health?.ok) {
      setError("The FamiliOS backend didn't answer.");
      setLoaded(true);
      return;
    }
    setError(null);
    setApprovalItems(approvals);
    setNotices(delivered);
    setHelpers(helperList);
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

  const markRead = useCallback(async (n: NotificationRec) => {
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

  const pending = useMemo(() => approvalItems.filter((a) => a.status === "pending"), [approvalItems]);
  const decided = useMemo(() => approvalItems.filter((a) => a.status !== "pending").slice(0, 10), [approvalItems]);
  const unreadCount = useMemo(() => notices.filter((n) => !n.read).length, [notices]);
  // Updates, grouped by who sent them. The chips are the "dropdown" on a phone: every helper
  // is a source before its first delivery, and the selected helper's own thread is one tap away.
  const sources = useMemo(() => notificationSources(notices, helpers), [notices, helpers]);
  const selectedSource = useMemo(() => sources.find((c) => c.key === sourceKey) ?? sources[0], [sources, sourceKey]);
  const visibleNotices = useMemo(
    () => (sourceKey === "all" ? notices : notices.filter((n) => sourceKeyOf(n) === sourceKey)),
    [notices, sourceKey],
  );
  const openChat = useCallback((conversationId: string | null | undefined) => {
    if (!conversationId) return;
    router.push({ pathname: "/(ask)", params: { c: conversationId } });
  }, []);

  const segments: { key: Segment; label: string; count: number; countNoun: string }[] = [
    { key: "messages", label: "Messages", count: 0, countNoun: "unread" },
    { key: "approvals", label: "Approvals", count: pending.length, countNoun: "pending" },
    { key: "updates", label: "Updates", count: unreadCount, countNoun: "unread" },
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
      ) : seg === "messages" ? (
        <Rise index={1}>
          <EmptyState icon="bubble.left.and.bubble.right" title="No messages yet" hint="Family messages arrive here: one-to-one, or a group you grow as you go." />
        </Rise>
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
      ) : (
        <>
          {/* Who sent it. Selecting a helper filters the list and arms "Open chat". */}
          <Rise index={1}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                {sources.map((c) => (
                  <Chip key={c.key} label={c.label} selected={c.key === sourceKey} onPress={() => setSourceKey(c.key)} icon={c.kind === "helper" ? "sparkles" : undefined} />
                ))}
              </ScrollView>
              <Button
                title="Open chat"
                small
                icon="bubble.left"
                disabled={!selectedSource?.conversationId}
                onPress={() => openChat(selectedSource?.conversationId)}
              />
            </View>
          </Rise>
          {visibleNotices.length === 0 ? (
            <Rise index={2}>
              <EmptyState
                icon="app.badge"
                title={sourceKey === "all" ? "No updates yet" : `Nothing from ${selectedSource?.label ?? "this source"} yet`}
                hint={sourceKey === "all" ? "Deliveries from helpers, Famili and the family land here. Send a test below to see the real path work." : "Run the helper, or wait for its next scheduled turn."}
              />
            </Rise>
          ) : (
            <Rise index={2}>
              <Card padded={false}>
                {visibleNotices.map((n, i) => {
                  const expanded = expandedId === n.id;
                  const kind = n.source?.kind ?? "system";
                  const target = notificationTarget(n);
                  return (
                    <View key={n.id} style={{ borderBottomWidth: i === visibleNotices.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                      <PressableScale
                        scaleTo={0.99}
                        haptic={n.read ? null : "select"}
                        onPress={() => {
                          /* Tapping an update opens it in place — the whole deliverable, not two lines
                           * of it — and marks it read on the way. Going to the thing it names is a
                           * separate, visible button, so reading never navigates away by surprise. */
                          void markRead(n);
                          setExpandedId(expanded ? null : n.id);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        accessibilityLabel={`${n.title}${n.read ? "" : ", unread"}`}
                      >
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13 }}>
                          <SymTile
                            name={SOURCE_ICON[kind] ?? "app.badge"}
                            color={n.read ? colors.textFaint : colors.ember}
                            bg={n.read ? colors.surfaceSunken : colors.emberBg}
                          />
                          <View style={{ flex: 1, gap: 2 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              {!n.read ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ember }} /> : null}
                              <T kind={n.read ? "body" : "bodyMedium"} color={n.read ? colors.textSecondary : colors.text} style={{ flex: 1 }} numberOfLines={expanded ? undefined : 2}>{n.title}</T>
                            </View>
                            {n.body ? (
                              <T kind="sub" color={expanded ? colors.textSecondary : undefined} numberOfLines={expanded ? undefined : 2} selectable={expanded}>{n.body}</T>
                            ) : null}
                            <T kind="caption" color={colors.textFaint}>
                              {n.source?.name ? `${n.source.name} · ` : ""}{ago(n.createdAt, now)}{expanded ? "" : " · tap to read"}
                            </T>
                          </View>
                          <Sym name={expanded ? "chevron.up" : "chevron.down"} size={12} color={colors.textFaint} />
                        </View>
                      </PressableScale>
                      {expanded && (n.conversationId || target) ? (
                        <View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                          {n.conversationId ? <Button title="Open chat" small icon="bubble.left" onPress={() => openChat(n.conversationId)} /> : null}
                          {target ? <Button title="Open" small icon="arrow.up.right" onPress={() => router.push(target as never)} /> : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            </Rise>
          )}
          <Rise index={3}>
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
      )}
    </HScreen>
  );
}

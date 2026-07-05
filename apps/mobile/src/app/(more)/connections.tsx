// Connections — OAuth accounts, connector readiness, and subscribed calendars.
// The OAuth flow runs through ASWebAuthenticationSession; the token exchange is
// server-side, so we always reload after the browser closes.
import { useCallback, useEffect, useState } from "react";
import { Alert, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api, type CalendarSubscription } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, type HearthColors } from "@/theme";
import {
  Badge, Button, Card, EmptyState, HScreen, Notice, Rise, Row,
  SectionHeader, SkeletonCards, SymTile, T,
} from "@/components/ui";

// Allow ASWebAuthenticationSession to complete and hand back to the app.
WebBrowser.maybeCompleteAuthSession();

type Tone = { label: string; fg: string; bg: string };

function readinessMeta(c: HearthColors, r: string): Tone {
  switch (r) {
    case "connected": return { label: "Connected", fg: c.sage, bg: c.sageBg };
    case "authorized_write": return { label: "Authorized", fg: c.sage, bg: c.sageBg };
    case "authorized_readonly": return { label: "Read-only", fg: c.sky, bg: c.skyBg };
    case "local_only": return { label: "Local-only", fg: c.sky, bg: c.skyBg };
    case "needs_auth": return { label: "Needs auth", fg: c.amber, bg: c.amberBg };
    case "not_configured": return { label: "Setup required", fg: c.amber, bg: c.amberBg };
    case "runtime_unavailable": return { label: "Runtime offline", fg: c.amber, bg: c.amberBg };
    case "not_installed": return { label: "Not installed", fg: c.textMuted, bg: c.surfaceSunken };
    case "degraded": return { label: "Degraded", fg: c.amber, bg: c.amberBg };
    case "error": return { label: "Error", fg: c.coral, bg: c.coralBg };
    case "revoked": return { label: "Revoked", fg: c.coral, bg: c.coralBg };
    default: return { label: r.replace(/_/g, " "), fg: c.textMuted, bg: c.surfaceSunken };
  }
}

function providerIcon(id: string): string {
  const k = id.toLowerCase();
  if (k.includes("calendar")) return "calendar";
  if (k.includes("google") || k.includes("microsoft") || k.includes("outlook") || k.includes("mail")) return "envelope";
  return "globe";
}

interface ProviderRow { id: string; name: string; readiness: string; accounts: unknown[] }

export default function ConnectionsScreen() {
  const { session } = useSession();
  const { colors, spacing, radii, fonts } = useTheme();
  const canManage = ["Owner", "Adult Admin", "Adult Member"].includes(session?.role ?? "");
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; readiness: string; live: boolean }>>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Calendar subscription form
  const [feedUrl, setFeedUrl] = useState("");
  const [icsPaste, setIcsPaste] = useState("");
  const [subBusy, setSubBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, p, s] = await Promise.all([api.connectors(), api.providers(), api.calendarSubscriptions()]);
    setConnectors(c);
    setProviders(p as ProviderRow[]);
    setSubs(s);
    setLoaded(true);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const connect = async (providerId: string, providerName: string) => {
    setConnecting(providerId);
    setNotice(null);
    try {
      const start = await api.oauthStart(providerId);
      if (!start.url || start.error) {
        setNotice({ text: start.message ?? start.error ?? "Could not start OAuth.", ok: false });
        return;
      }
      // ASWebAuthenticationSession: opens a secure in-app browser and waits for the
      // homeops:// redirect that the server issues after the code exchange completes.
      // The server reports failures through the same deep link (ok=0&message=...), so
      // the user always lands back here instead of being stranded in the browser.
      const result = await WebBrowser.openAuthSessionAsync(start.url, "homeops://");
      if (result.type === "success") {
        const u = new URL(result.url);
        if (u.searchParams.get("ok") === "0") {
          setNotice({ text: u.searchParams.get("message") ?? "The provider connection failed. Please try again.", ok: false });
        } else {
          const displayName = u.searchParams.get("displayName") ?? "";
          setNotice({ text: `${providerName}${displayName ? ` (${displayName})` : ""} connected!`, ok: true });
        }
      } else if (result.type === "cancel" || result.type === "dismiss") {
        setNotice({ text: "Authorization cancelled.", ok: false });
      }
      // Refresh regardless of how the browser closed — the exchange happens
      // server-side, so the account may be connected even if the return leg failed.
      await load();
    } catch (e) {
      setNotice({ text: String((e as Error)?.message ?? "OAuth error"), ok: false });
    } finally {
      setConnecting(null);
    }
  };

  const syncLabel = (s: CalendarSubscription) => {
    if (s.lastResult?.error) return `Sync failed: ${s.lastResult.error}`;
    if (s.lastSyncAt) return `Synced ${new Date(s.lastSyncAt).toLocaleString()} · ${s.eventCount} event${s.eventCount === 1 ? "" : "s"}`;
    return "Not synced yet";
  };

  const subscribe = async () => {
    if (!feedUrl.trim()) return;
    setSubBusy("url"); setNotice(null);
    const r = await api.subscribeCalendar({ url: feedUrl.trim() });
    setSubBusy(null);
    if (r.subscription) { setFeedUrl(""); setNotice({ text: `Subscribed — ${r.sync?.imported ?? 0} event${(r.sync?.imported ?? 0) === 1 ? "" : "s"} imported.`, ok: true }); await load(); }
    else setNotice({ text: r.error === "insufficient_role" ? "Subscribing needs an adult member." : r.message ?? r.error ?? "Couldn't subscribe.", ok: false });
  };

  const importPasted = async () => {
    if (!icsPaste.trim()) return;
    setSubBusy("paste"); setNotice(null);
    const r = await api.importIcs({ ics: icsPaste.trim() });
    setSubBusy(null);
    if (r.subscription) { setIcsPaste(""); setNotice({ text: `Imported — ${r.sync?.imported ?? 0} event${(r.sync?.imported ?? 0) === 1 ? "" : "s"} added to the calendar.`, ok: true }); await load(); }
    else setNotice({ text: r.error === "insufficient_role" ? "Importing needs an adult member." : r.message ?? r.error ?? "Couldn't import that .ics.", ok: false });
  };

  const connectGoogleCal = async () => {
    setSubBusy("google"); setNotice(null);
    const r = await api.connectGoogleCalendar();
    setSubBusy(null);
    if (r.subscription) { setNotice({ text: `Google Calendar connected — ${r.sync?.imported ?? 0} event${(r.sync?.imported ?? 0) === 1 ? "" : "s"} imported.`, ok: true }); await load(); }
    else setNotice({ text: r.error === "connect_google_first" ? "Connect your Google account above first." : r.message ?? r.error ?? "Couldn't connect Google Calendar.", ok: false });
  };

  const syncSub = async (s: CalendarSubscription) => {
    setSubBusy(`sync:${s.id}`); setNotice(null);
    const r = await api.syncCalendar(s.id);
    setSubBusy(null);
    if (r.sync?.ok) setNotice({ text: `${s.name}: ${r.sync.imported ?? 0} new, ${r.sync.updated ?? 0} updated, ${r.sync.removed ?? 0} removed.`, ok: true });
    else setNotice({ text: `Sync failed: ${r.sync?.error ?? r.error ?? "unknown error"}`, ok: false });
    await load();
  };

  const removeSub = async (s: CalendarSubscription) => {
    setSubBusy(`del:${s.id}`); setNotice(null);
    const r = await api.deleteCalendarSubscription(s.id);
    setSubBusy(null);
    if (r.ok) setNotice({ text: `${s.name} removed${r.removedEvents ? ` (${r.removedEvents} events cleared)` : ""}.`, ok: true });
    else setNotice({ text: r.error === "insufficient_role" ? "Removing needs an adult member." : `Couldn't remove: ${r.error ?? "unknown error"}`, ok: false });
    await load();
  };

  const confirmRemoveSub = (s: CalendarSubscription) => {
    Alert.alert(`Remove “${s.name}”?`, "Its imported events disappear from the calendar.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void removeSub(s) },
    ]);
  };

  const googleConnected = ((providers.find((p) => p.id === "google")?.accounts?.length) ?? 0) > 0;
  const inputStyle = {
    backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous" as const,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15,
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <Rise index={0}>
        <T kind="sub">Connect accounts to let plans act on your behalf.</T>
      </Rise>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {!loaded ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          {providers.length > 0 ? <SectionHeader title="Accounts (OAuth)" /> : null}
          {providers.map((p, i) => {
            const connected = (p.accounts?.length ?? 0) > 0;
            const needsAuth = !connected && (p.readiness === "configured" || p.readiness === "not_configured");
            const m = connected ? readinessMeta(colors, "connected") : readinessMeta(colors, p.readiness === "configured" ? "needs_auth" : "not_configured");
            return (
              <Rise key={p.id} index={Math.min(i + 1, 8)}>
                <Card style={{ gap: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <SymTile name={providerIcon(p.id)} color={m.fg} bg={m.bg} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="bodyMedium" color={colors.text}>{p.name}</T>
                      <T kind="sub">
                        {connected
                          ? `${(p.accounts as unknown[]).length} account${(p.accounts as unknown[]).length === 1 ? "" : "s"} connected`
                          : needsAuth ? "Authorize to let plans act on this account" : "Server-side setup required first"}
                      </T>
                    </View>
                    <Badge label={connected ? `${(p.accounts as unknown[]).length} connected` : m.label} fg={m.fg} bg={m.bg} />
                  </View>
                  {needsAuth ? (
                    <Button
                      title={connecting === p.id ? "Opening…" : `Connect ${p.name}`}
                      variant="ember"
                      icon="link"
                      full
                      loading={connecting === p.id}
                      onPress={() => connect(p.id, p.name)}
                    />
                  ) : null}
                </Card>
              </Rise>
            );
          })}

          <SectionHeader title="Subscribed calendars" />
          <Rise index={1}>
            <T kind="sub">School, sports, and holiday feeds show up on the calendar read-only and stay in sync.</T>
          </Rise>
          {subs.length === 0 ? (
            <EmptyState icon="calendar.badge.plus" title="No calendar feeds yet" hint={canManage ? "Subscribe to a feed URL or paste an .ics below." : "An adult member can subscribe to feeds here."} />
          ) : (
            subs.map((s, i) => (
              <Rise key={s.id} index={Math.min(i + 2, 8)}>
                <Card style={{ gap: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <SymTile name="calendar" color={colors.sky} bg={colors.skyBg} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="bodyMedium" color={colors.text} numberOfLines={1}>{s.name}</T>
                      <T kind="sub" numberOfLines={2}>
                        {s.source === "google" ? "Google Calendar" : s.url ? "ICS feed" : "Imported .ics"} · {syncLabel(s)}
                      </T>
                    </View>
                  </View>
                  {canManage ? (
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Button title="Sync now" variant="neutral" small icon="arrow.clockwise" loading={subBusy === `sync:${s.id}`} onPress={() => void syncSub(s)} />
                      <Button title="Remove" variant="ghost" small icon="trash" loading={subBusy === `del:${s.id}`} onPress={() => confirmRemoveSub(s)} />
                    </View>
                  ) : null}
                </Card>
              </Rise>
            ))
          )}

          {canManage ? (
            <Rise index={3}>
              <Card style={{ gap: spacing.sm }}>
                <T kind="eyebrow">Add a feed</T>
                <TextInput
                  style={inputStyle}
                  placeholder="Feed URL (webcal:// or https://…ics)"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url"
                  value={feedUrl} onChangeText={setFeedUrl}
                  accessibilityLabel="Calendar feed URL"
                />
                <Button title="Subscribe to feed" variant="neutral" full loading={subBusy === "url"} disabled={!feedUrl.trim()} onPress={() => void subscribe()} />
                <TextInput
                  style={[inputStyle, { minHeight: 72 }]}
                  placeholder="…or paste .ics contents here"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none" autoCorrect={false} multiline
                  value={icsPaste} onChangeText={setIcsPaste}
                  accessibilityLabel="Paste ICS contents"
                />
                <Button title="Import pasted .ics" variant="neutral" full loading={subBusy === "paste"} disabled={!icsPaste.trim()} onPress={() => void importPasted()} />
                {googleConnected ? (
                  <Button title="Connect Google Calendar" variant="ember" icon="calendar" full loading={subBusy === "google"} onPress={() => void connectGoogleCal()} />
                ) : (
                  <T kind="caption" color={colors.textFaint}>Connect a Google account above to sync Google Calendar.</T>
                )}
              </Card>
            </Rise>
          ) : (
            <Rise index={3}>
              <T kind="caption" color={colors.textFaint}>Managing calendar feeds needs an adult member.</T>
            </Rise>
          )}

          <SectionHeader title="Connectors" />
          {connectors.length === 0 ? (
            <EmptyState icon="bolt.slash" title="No connectors loaded" hint="Is the runtime online?" />
          ) : (
            <Rise index={4}>
              <Card padded={false}>
                {connectors.map((c, i) => {
                  const m = readinessMeta(colors, c.readiness);
                  return (
                    <Row
                      key={c.id}
                      title={c.name}
                      icon="puzzlepiece.extension"
                      iconColor={colors.textMuted}
                      iconBg={colors.surfaceSunken}
                      trailing={<Badge label={m.label} fg={m.fg} bg={m.bg} />}
                      last={i === connectors.length - 1}
                    />
                  );
                })}
              </Card>
            </Rise>
          )}
        </>
      )}
    </HScreen>
  );
}

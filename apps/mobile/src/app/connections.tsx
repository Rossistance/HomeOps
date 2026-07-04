import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api, type CalendarSubscription } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Allow ASWebAuthenticationSession to complete and hand back to the app.
WebBrowser.maybeCompleteAuthSession();

const READINESS: Record<string, { label: string; color: string; bg: string }> = {
  connected: { label: "Connected", color: Hearth.sage600, bg: Hearth.sageBg },
  authorized_write: { label: "Authorized", color: Hearth.sage600, bg: Hearth.sageBg },
  authorized_readonly: { label: "Read-only", color: Hearth.sky500, bg: Hearth.skyBg },
  local_only: { label: "Local-only", color: Hearth.sky500, bg: Hearth.skyBg },
  needs_auth: { label: "Needs auth", color: Hearth.amber600, bg: Hearth.amberBg },
  not_configured: { label: "Setup required", color: Hearth.amber600, bg: Hearth.amberBg },
  runtime_unavailable: { label: "Runtime offline", color: Hearth.amber600, bg: Hearth.amberBg },
  not_installed: { label: "Not installed", color: Hearth.ink500, bg: Hearth.surfaceSunken },
  degraded: { label: "Degraded", color: Hearth.amber600, bg: Hearth.amberBg },
  error: { label: "Error", color: Hearth.coral600, bg: Hearth.coralBg },
  revoked: { label: "Revoked", color: Hearth.coral600, bg: Hearth.coralBg },
};
function meta(r: string) { return READINESS[r] ?? { label: r.replace(/_/g, " "), color: Hearth.ink500, bg: Hearth.surfaceSunken }; }

interface ProviderRow { id: string; name: string; readiness: string; accounts: unknown[] }

export default function ConnectionsScreen() {
  const { session } = useSession();
  const canManage = ["Owner", "Adult Admin", "Adult Member"].includes(session?.role ?? "");
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; readiness: string; live: boolean }>>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
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
      const result = await WebBrowser.openAuthSessionAsync(start.url, "homeops://");
      if (result.type === "success") {
        const u = new URL(result.url);
        const displayName = u.searchParams.get("displayName") ?? "";
        setNotice({ text: `${providerName}${displayName ? ` (${displayName})` : ""} connected!`, ok: true });
        await load();
      } else if (result.type === "cancel" || result.type === "dismiss") {
        setNotice({ text: "Authorization cancelled.", ok: false });
      }
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

  const googleConnected = ((providers.find((p) => p.id === "google")?.accounts?.length) ?? 0) > 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Connections</H1>
        <Muted style={{ marginTop: 4 }}>Connect accounts to let plans act on your behalf.</Muted>

        {notice ? (
          <View style={[st.notice, { backgroundColor: notice.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: notice.ok ? Hearth.sage500 : Hearth.coral500 }]}>
            <Body style={{ color: notice.ok ? Hearth.sage600 : Hearth.coral600, fontSize: 14 }}>{notice.text}</Body>
          </View>
        ) : null}

        {providers.length > 0 ? <View style={{ marginTop: 20 }}><Eyebrow>Accounts (OAuth)</Eyebrow></View> : null}
        {providers.map((p) => {
          const connected = (p.accounts?.length ?? 0) > 0;
          const needsAuth = !connected && (p.readiness === "configured" || p.readiness === "not_configured");
          const m = connected ? READINESS.connected : meta(p.readiness === "configured" ? "needs_auth" : "not_configured");
          return (
            <Card key={p.id} style={{ marginTop: 8 }}>
              <View style={st.between}>
                <Body style={{ fontWeight: "600", flex: 1 }}>{p.name}</Body>
                <Badge label={connected ? `${(p.accounts as unknown[]).length} connected` : m.label} color={m.color} bg={m.bg} />
              </View>
              {needsAuth && (
                <View style={{ marginTop: 10 }}>
                  <Button
                    title={connecting === p.id ? "Opening…" : `Connect ${p.name}`}
                    variant="ghost"
                    loading={connecting === p.id}
                    onPress={() => connect(p.id, p.name)}
                  />
                </View>
              )}
            </Card>
          );
        })}

        <View style={{ marginTop: 20 }}><Eyebrow>Subscribed calendars</Eyebrow></View>
        <Muted style={{ marginTop: 4, fontSize: 12 }}>
          School, sports, and holiday feeds show up on the calendar read-only and stay in sync.
        </Muted>
        {subs.map((s) => (
          <Card key={s.id} style={{ marginTop: 8 }}>
            <View style={st.between}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>{s.name}</Body>
                <Muted style={{ fontSize: 12, marginTop: 2 }}>{s.source === "google" ? "Google Calendar" : s.url ? "ICS feed" : "Imported .ics"} · {syncLabel(s)}</Muted>
              </View>
            </View>
            {canManage && (
              <View style={st.btnRow}>
                <View style={{ flex: 1 }}>
                  <Button title="Sync now" variant="ghost" loading={subBusy === `sync:${s.id}`} onPress={() => void syncSub(s)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Remove" variant="danger" loading={subBusy === `del:${s.id}`} onPress={() => void removeSub(s)} />
                </View>
              </View>
            )}
          </Card>
        ))}
        {subs.length === 0 && <Card style={{ marginTop: 8 }}><Muted>No calendar feeds yet.</Muted></Card>}

        {canManage ? (
          <Card style={{ marginTop: 8, gap: 8 }}>
            <TextInput
              style={st.input}
              placeholder="Feed URL (webcal:// or https://…ics)"
              placeholderTextColor={Hearth.ink400}
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
              value={feedUrl} onChangeText={setFeedUrl}
              accessibilityLabel="Calendar feed URL"
            />
            <Button title="Subscribe to feed" variant="primary" loading={subBusy === "url"} disabled={!feedUrl.trim()} onPress={() => void subscribe()} />
            <TextInput
              style={[st.input, { minHeight: 72 }]}
              placeholder="…or paste .ics contents here"
              placeholderTextColor={Hearth.ink400}
              autoCapitalize="none" autoCorrect={false} multiline
              value={icsPaste} onChangeText={setIcsPaste}
              accessibilityLabel="Paste ICS contents"
            />
            <Button title="Import pasted .ics" variant="ghost" loading={subBusy === "paste"} disabled={!icsPaste.trim()} onPress={() => void importPasted()} />
            {googleConnected ? (
              <Button title="Connect Google Calendar" variant="ember" loading={subBusy === "google"} onPress={() => void connectGoogleCal()} />
            ) : (
              <Muted style={{ fontSize: 12 }}>Connect a Google account above to sync Google Calendar.</Muted>
            )}
          </Card>
        ) : (
          <Muted style={{ marginTop: 8, fontSize: 12 }}>Managing calendar feeds needs an adult member.</Muted>
        )}

        <View style={{ marginTop: 20 }}>
          <Eyebrow>Connectors</Eyebrow>
          {connectors.map((c) => {
            const m = meta(c.readiness);
            return (
              <Card key={c.id} style={{ marginTop: 8 }}>
                <View style={st.between}>
                  <Body style={{ fontWeight: "600" }}>{c.name}</Body>
                  <Badge label={m.label} color={m.color} bg={m.bg} />
                </View>
              </Card>
            );
          })}
          {connectors.length === 0 ? <Muted style={{ marginTop: 12 }}>No connectors loaded — is the runtime online?</Muted> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  notice: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  input: {
    borderWidth: 1, borderColor: Hearth.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Hearth.ink900, backgroundColor: Hearth.white,
  },
});

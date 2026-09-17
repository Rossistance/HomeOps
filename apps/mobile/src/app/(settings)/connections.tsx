// Connections — OAuth accounts, connector readiness, and subscribed calendars.
// The OAuth flow runs through ASWebAuthenticationSession; the token exchange is
// server-side, so we always reload after the browser closes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, type LayoutChangeEvent, ScrollView, TextInput, View } from "react-native";
import Animated, {
  ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import * as WebBrowser from "expo-web-browser";
import * as DocumentPicker from "expo-document-picker";
// The legacy entry point is the one the rest of the app uses (see (ask)/index.tsx).
import { readAsStringAsync } from "expo-file-system/legacy";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { api, type CalendarSubscription, type ProviderRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { categoryStyle } from "@/theme/categories";
import { useTheme, riskColor, tapHaptic, type HearthColors } from "@/theme";
import {
  Badge, BrandIcon, Button, Card, CollapsibleSection, EmptyState, Expander, HScreen, Notice, PressableScale, Rise, Row,
  SectionHeader, SkeletonCards, Sym, SymTile, T,
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

export default function ConnectionsScreen() {
  const { session } = useSession();
  const { colors, spacing, radii, fonts } = useTheme();
  const canManage = ["Owner", "Adult Admin", "Adult Member"].includes(session?.role ?? "");
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; readiness: string; live: boolean }>>([]);
  const [providers, setProviders] = useState<ProviderRec[]>([]);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Calendar subscription form
  const [feedUrl, setFeedUrl] = useState("");
  const [icsPaste, setIcsPaste] = useState("");
  const [subBusy, setSubBusy] = useState<string | null>(null);

  /* F2 [07:02] — "when I tap Reconnect it should scroll to and focus that specific provider
   * card, with an animated coloured ring around it, so I know which one it means."
   * F4 [08:42] — "back must return to where I came from. Calendar to Connections to Back
   * should land me on the Calendar, not in Settings."
   *
   * Both ride on link params: `focus` names the provider to highlight, `from` names the route
   * that sent us. Neither is guessed — the caller says so, because only the caller knows. */
  const params = useLocalSearchParams<{ focus?: string; from?: string }>();
  const focusProvider = typeof params.focus === "string" ? params.focus : null;
  const fromRoute = typeof params.from === "string" ? params.from : null;
  const scroller = useRef<ScrollView>(null);
  /* Which providers are open. Collapsed by default — see the note on the card head. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /* T2/T3 — "at the bottom of the page there's some things that give information I'm not sure
   * is necessary: whether or not a custom HTTP is set up, if a webhook receiver is set up. I'm
   * not even sure if that will be used often. And text messaging is currently, even though
   * there's credentials, not fully vetted and accurate and active, so it doesn't really even
   * need to be there yet."
   *
   * Hidden rather than deleted. A connector that isn't ready is a row that answers a question
   * nobody asked and invites one that has no good answer ("why is this offline?"). They come
   * back on their own the moment they're genuinely usable — nothing to remember to re-enable,
   * which is the failure mode of commenting a feature out. Texting left this list on
   * 2026-09-17: the carrier gateway it was waiting on is gone, replaced by the household's
   * own iMessage bridge (BlueBubbles), which is a real thing to set up and see. */
  const NOT_YET = /webhook|custom http/i;
  const shownConnectors = connectors.filter((c) => !(NOT_YET.test(c.name) && !c.live));

  const cardY = useRef<Record<string, number>>({});
  const [ringFor, setRingFor] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const scrolledTo = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [c, p, s] = await Promise.all([api.connectors(), api.providers(), api.calendarSubscriptions()]);
    setConnectors(c);
    setProviders(p);
    setSubs(s);
    setLoaded(true);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  /* "Reconnect" that wouldn't go away, part two.
   *
   * An account's status only ever updated when something happened to USE it, so a stale
   * "needs reconnect" on an account nobody was touching — another member's, or one with no
   * calendar behind it — never corrected. A timer now re-probes them server-side; this is the
   * button for when you're standing in front of the screen and don't want to wait for it. */
  const checkNow = useCallback(async () => {
    setChecking(true); setNotice(null);
    const r = await api.checkConnections();
    setChecking(false);
    if (r.error) {
      setNotice({ text: r.error === "insufficient_role" ? "Re-checking connections needs an adult member." : "Couldn't check just now.", ok: false });
      return;
    }
    await load();
    // Say what actually changed, including "nothing" — a check that reports success either
    // way teaches you to stop believing it.
    const healed = r.healed ?? 0;
    const marked = r.marked ?? 0;
    setNotice({
      ok: marked === 0,
      text: healed > 0 && marked === 0
        ? `${healed} connection${healed === 1 ? " was" : "s were"} fine after all — the warning is cleared.`
        : marked > 0
          ? `${marked} connection${marked === 1 ? "" : "s"} really ${marked === 1 ? "does" : "do"} need reconnecting${healed ? `, and ${healed} cleared` : ""}.`
          : `Checked ${r.checked ?? 0} connection${(r.checked ?? 0) === 1 ? "" : "s"} — nothing changed.`,
    });
  }, [load]);

  // F2 — once the cards have laid out, bring the named one into view and ring it. Runs once
  // per focus request: re-running on every render would fight the user's own scrolling.
  useEffect(() => {
    if (!loaded || !focusProvider || scrolledTo.current === focusProvider) return;
    const y = cardY.current[focusProvider];
    if (y == null) return;                     // its onLayout hasn't fired yet — try next paint
    scrolledTo.current = focusProvider;
    setTimeout(() => {
      scroller.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      setRingFor(focusProvider);
      tapHaptic("light");
      // The ring is a pointer, not a state: it fades out on its own rather than needing a tap
      // to dismiss something that was only ever "look here".
      setTimeout(() => setRingFor(null), 2600);
    }, 220);
  }, [loaded, focusProvider, providers.length]);

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
      // familios:// redirect that the server issues after the code exchange completes.
      // The server reports failures through the same deep link (ok=0&message=...), so
      // the user always lands back here instead of being stranded in the browser.
      // Ephemeral = private context: the PWA's service worker / Safari cookies can
      // never intercept the /api/oauth/callback navigation (a stale worker used to
      // swallow it and render the cached web app instead of finishing the exchange).
      const result = await WebBrowser.openAuthSessionAsync(start.url, "familios://", { preferEphemeralSession: true });
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

  /* Cluster V — "I'd rather this be a file upload — import ICS file." Pasting the contents
   * of a calendar file into a text box asks a person to do a computer's job: find the file,
   * open it in something that can show raw text, select thousands of lines, copy, come back.
   * The picker does it in one tap, and .ics is a real file type iOS can hand us. */
  const importFile = async () => {
    setSubBusy("paste"); setNotice(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        // iOS reports .ics as text/calendar; some exporters send octet-stream, so both.
        type: ["text/calendar", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) { setSubBusy(null); return; }
      const ics = await readAsStringAsync(res.assets[0].uri);
      if (!/BEGIN:VCALENDAR/i.test(ics)) {
        setSubBusy(null);
        setNotice({ text: "That doesn't look like a calendar file — pick a .ics export.", ok: false });
        return;
      }
      const r = await api.importIcs({ ics });
      setSubBusy(null);
      if (r.subscription) { setNotice({ text: `Imported — ${r.sync?.imported ?? 0} event${(r.sync?.imported ?? 0) === 1 ? "" : "s"} added to the calendar.`, ok: true }); await load(); }
      else setNotice({ text: r.error === "insufficient_role" ? "Importing needs an adult member." : r.message ?? r.error ?? "Couldn't import that .ics.", ok: false });
    } catch {
      setSubBusy(null);
      setNotice({ text: "Couldn't read that file — try exporting it again.", ok: false });
    }
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
    <HScreen refreshing={refreshing} onRefresh={onRefresh} scrollRef={scroller} keyboardAware>
      {/* F4 — Connections lives in the Settings stack, so the default Back always went to
          Settings no matter where you came from. When a caller tells us where it sent us
          from, Back says so and goes there. */}
      {fromRoute ? (
        <Stack.Screen
          options={{
            headerLeft: () => (
              <PressableScale
                onPress={() => { tapHaptic("light"); router.replace(fromRoute as never); }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Back to ${fromRoute.includes("calendar") ? "Calendar" : "where you were"}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
              >
                <Sym name="chevron.left" size={17} color={colors.ember} />
                <T kind="bodyMedium" color={colors.ember}>{fromRoute.includes("calendar") ? "Calendar" : "Back"}</T>
              </PressableScale>
            ),
          }}
        />
      ) : null}
      <Rise index={0}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T kind="sub" style={{ flex: 1 }}>Connect accounts to let plans act on your behalf.</T>
          {canManage ? (
            <Button
              small variant="neutral" icon="arrow.clockwise"
              title={checking ? "Checking…" : "Check now"}
              loading={checking}
              onPress={() => void checkNow()}
            />
          ) : null}
        </View>
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
            const ringed = ringFor === p.id;
            return (
              <Rise key={p.id} index={Math.min(i + 1, 8)}>
                <FocusRing active={ringed} onLayout={(e) => { cardY.current[p.id] = e.nativeEvent.layout.y; }}>
                {/* T1 — "these cards are very large and they need to be able to be condensed
                    down into essentially a single line saying whether or not setup is required
                    and if they're active. They could be expanded to reveal all this detail, but
                    there's no need to display such large cards on a single screen when that
                    information is not accessed all the time."
                    So the head is the single line: who, and what state it's in. Everything else
                    lives behind the expander, closed by default, unless it's the one you just
                    came back to (`ringed`) — that one opens itself, because you arrived here to
                    look at it. */}
                <Card style={{ gap: expanded[p.id] ?? ringed ? spacing.md : 0 }}>
                  <PressableScale
                    onPress={() => setExpanded((e) => ({ ...e, [p.id]: !(e[p.id] ?? ringed) }))}
                    haptic="select"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expanded[p.id] ?? ringed }}
                    accessibilityLabel={`${p.name}, ${m.label}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
                  >
                    <BrandIcon provider={p.id} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="bodyMedium" color={colors.text}>{p.name}</T>
                      <T kind="sub" color={m.fg}>
                        {connected
                          ? `${p.accounts.length} account${p.accounts.length === 1 ? "" : "s"} connected`
                          : needsAuth ? "Authorize to let plans act on this account" : "Server-side setup required first"}
                      </T>
                    </View>
                    <Expander open={expanded[p.id] ?? ringed} tone={m.fg} />
                  </PressableScale>
                  {(expanded[p.id] ?? ringed) ? (
                  <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <Badge label={connected ? `${p.accounts.length} connected` : m.label} fg={m.fg} bg={m.bg} />
                  </View>
                  {connected ? (
                    <View style={{ gap: 6 }}>
                      {p.accounts.map((a) => {
                        const broken = ["needs_reconnect", "revoked", "expired", "degraded"].includes(a.status ?? "");
                        return (
                          <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceSunken, borderRadius: 10, borderCurve: "continuous", paddingHorizontal: 10, paddingVertical: 8 }}>
                            <BrandIcon provider={p.id} size={22} />
                            <View style={{ flex: 1 }}>
                              {/* B4 [09:48] — "it shows wr…@gmail.com; it should show ROSS. Our
                                  family identifies each other by name, not email." The name
                                  leads; the address is the small print underneath. */}
                              <T kind="subMedium" color={colors.text}>
                                {a.memberName || a.displayName || "Connected account"}
                              </T>
                              {a.memberName && a.displayName && a.displayName !== a.memberName ? (
                                <T kind="caption" color={colors.textFaint} numberOfLines={1}>{a.displayName}</T>
                              ) : null}
                            </View>
                            {/* F3 [07:32] — "there should be a Reconnect button on the card
                                itself, in the list view" — rather than only in a banner
                                somewhere else that tells you to come here. */}
                            {broken && canManage ? (
                              <Button
                                small variant="neutral" icon="arrow.clockwise"
                                title={connecting === p.id ? "Opening…" : "Reconnect"}
                                loading={connecting === p.id}
                                onPress={() => void connect(p.id, p.name)}
                              />
                            ) : (
                              <Sym name="checkmark.circle.fill" size={14} color={colors.sage} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                  {(p.scopes?.length ?? 0) > 0 ? (
                    <View style={{ gap: 6 }}>
                      <T kind="eyebrow">Permissions {connected ? "granted" : "you'll grant"}</T>
                      {p.scopes!.map((s) => {
                        const rc = riskColor(colors, s.risk);
                        return (
                          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Sym name="checkmark.shield" size={13} color={colors.sage} />
                            <T kind="sub" style={{ flex: 1 }} numberOfLines={1}>{s.label}</T>
                            <Badge label={s.risk} fg={rc.fg} bg={rc.bg} />
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
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
                  {!connected && !needsAuth && p.clientIdEnv ? (
                    <T kind="caption" color={colors.textFaint}>
                      Deployment setup needed: set {p.clientIdEnv} and {p.clientSecretEnv} on the server, then connect here.
                    </T>
                  ) : null}
                  </>
                  ) : null}
                </Card>
                </FocusRing>
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
                      <T kind="bodyMedium" color={colors.text}>{s.name}</T>
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
              <Card padded={false}>
                {/* Cluster V — "this can be collapsed a bit… I do like this connect Google
                    Calendar button, however it should just be 'connect calendar' because it
                    could be any type of calendar." Connecting an account is the common act
                    and stays out front; the feed URL and file import are the rare ones and
                    fold away until asked for. */}
                {googleConnected ? (
                  <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                    <Button title="Connect calendar" variant="ember" icon="calendar" full loading={subBusy === "google"} onPress={() => void connectGoogleCal()} />
                  </View>
                ) : (
                  <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                    <T kind="caption" color={colors.textFaint}>Connect an account above, and its calendar comes with it.</T>
                  </View>
                )}
                <CollapsibleSection title="Other calendar options">
                  <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
                    <Button title="Import calendar file (.ics)" variant="neutral" icon="square.and.arrow.down" full loading={subBusy === "paste"} onPress={() => void importFile()} />
                    <TextInput
                      style={inputStyle}
                      placeholder="Feed URL (webcal:// or https://…ics)"
                      placeholderTextColor={colors.textFaint}
                      autoCapitalize="none" autoCorrect={false} keyboardType="url"
                      value={feedUrl} onChangeText={setFeedUrl}
                      accessibilityLabel="Calendar feed URL"
                    />
                    <Button title="Subscribe to feed" variant="neutral" full loading={subBusy === "url"} disabled={!feedUrl.trim()} onPress={() => void subscribe()} />
                  </View>
                </CollapsibleSection>
              </Card>
            </Rise>
          ) : (
            <Rise index={3}>
              <T kind="caption" color={colors.textFaint}>Managing calendar feeds needs an adult member.</T>
            </Rise>
          )}

          {/* Cluster V — "it would be prudent to move the AI providers under the all
              connections and calendars. Currently it services everything here." The model
              that answers the household IS a connection; keeping it in a separate branch of
              Settings made people hunt for it in the one place it doesn't live. */}
          <Rise index={4}>
            <Card padded={false}>
              <Row
                icon="cpu" iconColor={colors.ember} iconBg={colors.emberBg}
                title="AI providers" subtitle="The model answering for this household"
                chevron onPress={() => router.push("/ai")} last
              />
            </Card>
          </Rise>

          {/* "This information down here is like a connector status — it's useful, but it can
              also benefit from a collapsed state." Folded by default: it answers a question
              you only ask when something's wrong. */}
          <SectionHeader title="Connectors" />
          {shownConnectors.length === 0 ? (
            <EmptyState icon="bolt.slash" title="No connectors loaded" hint="Is the runtime online?" />
          ) : (
            <Rise index={5}>
              <Card padded={false}>
                <CollapsibleSection title="Connector status" count={shownConnectors.length}>
                {/* Cluster V — "for connectors that have not been set up by the application
                    developer, these need to be grayed out with a note saying coming soon —
                    everything but Google for now." Live rows keep their state badge; the
                    rest dim to 40% with one honest label, so the list reads as a roadmap
                    rather than a wall of inexplicable 'offline's. */}
                {shownConnectors.map((c, i) => {
                  const live = c.live || ["connected", "authorized_write", "authorized_readonly", "local_only", "healthy"].includes(c.readiness);
                  const m = live ? readinessMeta(colors, c.readiness) : { label: "Coming soon", fg: colors.textFaint, bg: colors.surfaceSunken };
                  const look = categoryStyle(colors, c.name);
                  return (
                    <View key={c.id} style={{ opacity: live ? 1 : 0.4 }}>
                      <Row
                        title={c.name}
                        icon={look.icon}
                        iconColor={look.fg}
                        iconBg={look.bg}
                        trailing={<Badge label={m.label} fg={m.fg} bg={m.bg} />}
                        last={i === shownConnectors.length - 1}
                      />
                    </View>
                  );
                })}
                </CollapsibleSection>
              </Card>
            </Rise>
          )}
        </>
      )}
    </HScreen>
  );
}

/** F2 — the "which one do you mean" ring. A coloured outline that pulses a few times around
 *  the card the user was sent to, then stops. Deliberately a POINTER and not a state: it
 *  fades on its own rather than leaving something to dismiss. Respects Reduce Motion, where
 *  it settles into a steady outline instead of pulsing. */
function FocusRing({ active, children, onLayout }: {
  active: boolean; children: React.ReactNode; onLayout: (e: LayoutChangeEvent) => void;
}) {
  const { colors, radii } = useTheme();
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!active) { glow.value = withTiming(0, { duration: 260 }); return; }
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 520, reduceMotion: ReduceMotion.System }),
        withTiming(0.35, { duration: 520, reduceMotion: ReduceMotion.System }),
      ),
      3, false, undefined, ReduceMotion.System,
    );
  }, [active, glow]);
  const style = useAnimatedStyle(() => ({
    borderColor: colors.ember,
    borderWidth: 2 * glow.value,
    opacity: 0.35 + 0.65 * glow.value,
  }));
  return (
    <View onLayout={onLayout}>
      {children}
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", left: -3, right: -3, top: -3, bottom: -3, borderRadius: radii.lg, borderCurve: "continuous" },
            style,
          ]}
        />
      ) : null}
    </View>
  );
}

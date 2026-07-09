// Settings — AI providers (truthful, probe-verified readiness), the admin-only
// approval-gate overrides, honest link-outs for web-only surfaces, and session.
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Switch, TextInput, View } from "react-native";
import { api, API_URL, type AIProviderRec, type CatalogToolRec, type RiskOverrideRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
import {
  Badge, Button, Card, ErrorState, HScreen, Notice, PressableScale,
  Rise, Row, SectionHeader, SkeletonCards, Sym, SymTile, T, Well,
} from "@/components/ui";

const WEB_URL = "https://homeops-ai.onrender.com";

// Truthful readiness labels — mirror the server vocabulary in server/ai.mjs.
// "configured" is NOT "working": only a real probe upgrades it to Reachable.
function readinessMeta(c: HearthColors, r: string): { label: string; fg: string; bg: string } {
  switch (r) {
    case "healthy": return { label: "Reachable", fg: c.sage, bg: c.sageBg };
    case "configured": case "needs_health_check": return { label: "Test to verify", fg: c.amber, bg: c.amberBg };
    case "unreachable": return { label: "Unreachable", fg: c.coral, bg: c.coralBg };
    case "not_configured": return { label: "Not configured", fg: c.textMuted, bg: c.surfaceSunken };
    default: return { label: r, fg: c.textMuted, bg: c.surfaceSunken };
  }
}

interface ProviderForm { apiKey: string; baseUrl: string; model: string }

export default function SettingsScreen() {
  const { session, signOut } = useSession();
  const { colors, spacing, radii, fonts } = useTheme();
  const [providers, setProviders] = useState<AIProviderRec[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>({ apiKey: "", baseUrl: "", model: "" });
  const [busy, setBusy] = useState<string | null>(null); // "<providerId>:<action>"
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [testReply, setTestReply] = useState<{ providerId: string; text: string; model?: string; ok: boolean } | null>(null);

  const isAdmin = session?.role === "Owner" || session?.role === "Adult Admin";

  const load = useCallback(async () => {
    setProviders(await api.aiProviders());
    setLoaded(true);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const open = (p: AIProviderRec) => {
    if (expanded === p.id) { setExpanded(null); return; }
    setExpanded(p.id);
    setTestReply(null);
    setNotice(null);
    setForm({ apiKey: "", baseUrl: p.baseUrl === p.defaultBaseUrl ? "" : p.baseUrl, model: p.model === p.defaultModel ? "" : p.model });
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNotice(null);
    try { await fn(); } finally { setBusy(null); }
  };

  const save = (p: AIProviderRec) => run(`${p.id}:save`, async () => {
    const cfg: { apiKey?: string; baseUrl?: string; model?: string } = {};
    if (form.apiKey.trim()) cfg.apiKey = form.apiKey.trim();
    if (form.baseUrl.trim() || p.needsBaseUrl || p.local) cfg.baseUrl = form.baseUrl.trim();
    cfg.model = form.model.trim();
    const r = await api.aiConfigure(p.id, cfg);
    if (r.error) { setNotice({ text: r.error === "insufficient_role" ? "Only an adult admin can configure providers." : `Save failed: ${r.error}`, ok: false }); return; }
    setForm((f) => ({ ...f, apiKey: "" }));
    setNotice({ text: `${p.name} saved. Run “Test connection” to verify it.`, ok: true });
    await load();
  });

  const test = (p: AIProviderRec) => run(`${p.id}:test`, async () => {
    const h = await api.aiHealth(p.id);
    setNotice(h.ok
      ? { text: `${p.name} is reachable${h.latencyMs != null ? ` (${h.latencyMs} ms)` : ""}${h.models?.length ? ` · ${h.models.length} models` : ""}.`, ok: true }
      : { text: h.message ?? h.error ?? `${p.name} is unreachable.`, ok: false });
    await load();
  });

  const activate = (p: AIProviderRec) => run(`${p.id}:active`, async () => {
    const r = await api.aiSetActive(p.id);
    if (r.error) { setNotice({ text: r.error === "insufficient_role" ? "Only an adult admin can set the active provider." : `Failed: ${r.error}`, ok: false }); return; }
    setNotice({ text: `${p.name} is now the active provider for Ask HomeOps.`, ok: true });
    await load();
  });

  const sendTest = (p: AIProviderRec) => run(`${p.id}:chat`, async () => {
    setTestReply(null);
    const r = await api.aiChat("Reply with one short sentence confirming you can hear HomeOps.", p.id);
    if (r.ok && r.text) setTestReply({ providerId: p.id, text: r.text.slice(0, 280), model: r.model, ok: true });
    else setTestReply({ providerId: p.id, text: r.message ?? r.error ?? "No reply.", ok: false });
    await load();
  });

  const revoke = (p: AIProviderRec) => run(`${p.id}:revoke`, async () => {
    const r = await api.aiRevoke(p.id);
    if (r.error) { setNotice({ text: r.error === "insufficient_role" ? "Only an adult admin can remove a provider." : `Failed: ${r.error}`, ok: false }); return; }
    setNotice({ text: `${p.name} configuration removed.`, ok: true });
    await load();
  });

  const confirmRevoke = (p: AIProviderRec) => {
    Alert.alert(`Remove ${p.name} configuration?`, "Its key and settings are deleted from the server.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void revoke(p) },
    ]);
  };

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll need to pick your profile again to sign back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  const openWeb = () => { void Linking.openURL(WEB_URL); };

  const inputStyle = {
    backgroundColor: colors.surface, borderRadius: radii.sm, borderCurve: "continuous" as const,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 11,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15,
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <SectionHeader title="AI providers" />
      <Rise index={0} style={{ gap: 4 }}>
        <T kind="sub">
          Ask HomeOps needs one working provider. Status is verified by real probes — nothing shows as working until it is.
        </T>
        {!isAdmin ? (
          <T kind="caption" color={colors.textFaint}>
            You can see provider status; configuring or switching providers needs an adult admin.
          </T>
        ) : null}
      </Rise>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {!loaded ? (
        <SkeletonCards count={3} />
      ) : providers.length === 0 ? (
        <ErrorState message="Can't load providers — is the backend reachable?" onRetry={() => void load()} />
      ) : (
        providers.map((p, i) => {
          const m = readinessMeta(colors, p.readiness);
          const isOpen = expanded === p.id;
          return (
            <Rise key={p.id} index={Math.min(i + 1, 8)}>
              <Card padded={false}>
                <PressableScale
                  scaleTo={0.99}
                  haptic="select"
                  onPress={() => open(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${m.label}${p.active ? ", active" : ""}`}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg }}>
                    <SymTile name={p.kind === "local" ? "desktopcomputer" : "cloud"} color={m.fg} bg={m.bg} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <T kind="bodyMedium" color={colors.text}>{p.name}</T>
                        {p.active ? <Badge label="Active" fg={colors.ember} bg={colors.emberBg} /> : null}
                      </View>
                      <T kind="sub" numberOfLines={1}>
                        {p.kind === "local" ? "Runs on your computer" : "Cloud"}{p.model ? ` · ${p.model}` : ""}
                      </T>
                    </View>
                    <Badge label={m.label} fg={m.fg} bg={m.bg} />
                    <Sym name={isOpen ? "chevron.up" : "chevron.down"} size={13} color={colors.textFaint} />
                  </View>
                </PressableScale>

                {isOpen ? (
                  <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                    <Well style={{ gap: spacing.sm }}>
                      <T kind="sub">{p.docs}</T>
                      {p.health ? (
                        <T kind="caption" color={colors.textFaint}>
                          Last check: {p.health.ok ? "reachable" : "unreachable"}
                          {p.health.latencyMs != null ? ` · ${p.health.latencyMs} ms` : ""}
                          {p.health.at ? ` · ${new Date(p.health.at).toLocaleString()}` : ""}
                        </T>
                      ) : null}

                      {isAdmin ? (
                        <>
                          {p.needsKey ? (
                            <TextInput
                              style={inputStyle}
                              placeholder={p.keySet ? "API key saved — paste to replace" : "API key"}
                              placeholderTextColor={colors.textFaint}
                              autoCapitalize="none" autoCorrect={false} secureTextEntry
                              value={form.apiKey}
                              onChangeText={(v) => setForm((f) => ({ ...f, apiKey: v }))}
                              accessibilityLabel={`${p.name} API key`}
                            />
                          ) : null}
                          {(p.needsBaseUrl || p.local) ? (
                            <TextInput
                              style={inputStyle}
                              placeholder={p.defaultBaseUrl ? `Base URL (default ${p.defaultBaseUrl})` : "Base URL (required)"}
                              placeholderTextColor={colors.textFaint}
                              autoCapitalize="none" autoCorrect={false} keyboardType="url"
                              value={form.baseUrl}
                              onChangeText={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
                              accessibilityLabel={`${p.name} base URL`}
                            />
                          ) : null}
                          <TextInput
                            style={inputStyle}
                            placeholder={p.defaultModel ? `Model (default ${p.defaultModel})` : "Model (blank = auto-discover)"}
                            placeholderTextColor={colors.textFaint}
                            autoCapitalize="none" autoCorrect={false}
                            value={form.model}
                            onChangeText={(v) => setForm((f) => ({ ...f, model: v }))}
                            accessibilityLabel={`${p.name} model`}
                          />
                          <Button title="Save configuration" variant="ember" full loading={busy === `${p.id}:save`} onPress={() => save(p)} />
                        </>
                      ) : null}

                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <View style={{ flex: 1 }}>
                          <Button title="Test connection" variant="neutral" small full loading={busy === `${p.id}:test`} onPress={() => test(p)} />
                        </View>
                        {isAdmin && !p.active ? (
                          <View style={{ flex: 1 }}>
                            <Button title="Set active" variant="success" small full loading={busy === `${p.id}:active`} disabled={p.readiness === "not_configured"} onPress={() => activate(p)} />
                          </View>
                        ) : null}
                      </View>
                      {p.readiness !== "not_configured" ? (
                        <Button title="Send a test message" variant="ghost" small full loading={busy === `${p.id}:chat`} onPress={() => sendTest(p)} />
                      ) : null}
                      {testReply?.providerId === p.id ? (
                        <Notice text={testReply.ok ? `“${testReply.text}”${testReply.model ? ` — ${testReply.model}` : ""}` : testReply.text} ok={testReply.ok} />
                      ) : null}
                      {isAdmin && (p.keySet || p.readiness !== "not_configured") ? (
                        <Button title="Remove configuration" variant="ghost" small full icon="trash" onPress={() => confirmRevoke(p)} loading={busy === `${p.id}:revoke`} />
                      ) : null}
                    </Well>
                  </View>
                ) : null}
              </Card>
            </Rise>
          );
        })
      )}

      {isAdmin ? <RiskOverridesSection /> : null}

      <SectionHeader title="On the web" />
      <Rise index={2}>
        <Card padded={false}>
          <Row
            title="Approvals PIN"
            subtitle="Set or change the approval PIN on the web app"
            icon="lock"
            iconColor={colors.textMuted}
            iconBg={colors.surfaceSunken}
            trailing={<Sym name="arrow.up.right" size={13} color={colors.textFaint} />}
            onPress={openWeb}
          />
          <Row
            title="Advanced builders"
            subtitle="Agent, skill & automation builders live on the web"
            icon="hammer"
            iconColor={colors.textMuted}
            iconBg={colors.surfaceSunken}
            trailing={<Sym name="arrow.up.right" size={13} color={colors.textFaint} />}
            onPress={openWeb}
          />
          <Row
            title="Appearance"
            subtitle="Matches your device light/dark setting"
            icon="circle.lefthalf.filled"
            iconColor={colors.textMuted}
            iconBg={colors.surfaceSunken}
            last
          />
        </Card>
      </Rise>

      <SectionHeader title="Session" />
      <Rise index={3}>
        <Card style={{ gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <T kind="sub">Signed in as {session?.actorName} · {session?.role}</T>
            <T kind="caption" color={colors.textFaint} selectable>Backend: {API_URL}</T>
          </View>
          <Button title="Sign out" variant="danger" icon="rectangle.portrait.and.arrow.right" full onPress={confirmSignOut} />
        </Card>
      </Rise>
    </HScreen>
  );
}

/* ---- Risk & approvals (item 9 mirror) ----
 * Same server records as the web card: skip a trusted tool's approval gate for
 * this household. Enforced server-side in the engine; every change audited. */
function RiskOverridesSection() {
  const { colors, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [catalog, setCatalog] = useState<CatalogToolRec[]>([]);
  const [overrides, setOverrides] = useState<RiskOverrideRec[]>([]);
  const [busyTool, setBusyTool] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.riskOverrides();
    if (r) { setCatalog(r.catalog); setOverrides(r.overrides); setFailed(false); }
    else setFailed(true);
    setLoaded(true);
  }, []);
  useEffect(() => { if (open && !loaded) void load(); }, [open, loaded, load]);

  const ovFor = (toolId: string) => overrides.find((o) => o.toolId === toolId);
  const toggleSkip = async (t: CatalogToolRec) => {
    setBusyTool(t.toolId);
    const current = ovFor(t.toolId);
    const nextSkip = !current?.skipApproval;
    if (!nextSkip && !current?.riskClass) await api.clearRiskOverride(t.toolId);
    else await api.setRiskOverride(t.toolId, { skipApproval: nextSkip, riskClass: current?.riskClass ?? null });
    await load();
    setBusyTool(null);
  };

  // Only gated tools are worth listing on the phone — the full risk-class matrix
  // stays on the web's larger surface; skipping approval is the high-value control.
  const gated = catalog.filter((t) => t.defaultRequiresApproval ?? t.requiresApproval);

  return (
    <>
      <SectionHeader title="Risk & approvals" />
      <Rise index={1}>
        <Card padded={false}>
          <PressableScale
            scaleTo={0.99}
            haptic="select"
            onPress={() => setOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Configure approval-gated tools"
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg }}>
              <SymTile name="checkmark.shield" color={colors.amber} bg={colors.amberBg} />
              <View style={{ flex: 1, gap: 2 }}>
                <T kind="bodyMedium" color={colors.text}>Approval-gated tools</T>
                <T kind="sub">Let a trusted tool run without asking. Server-enforced; every skipped gate is still audited.</T>
              </View>
              <Sym name={open ? "chevron.up" : "chevron.down"} size={13} color={colors.textFaint} />
            </View>
          </PressableScale>

          {open && !loaded ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              <T kind="sub">Loading tool catalog…</T>
            </View>
          ) : null}
          {open && loaded && failed ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              <T kind="sub" color={colors.coral}>Couldn't load the tool catalog — pull to refresh or try again.</T>
            </View>
          ) : null}
          {open && loaded && !failed ? gated.map((t, i) => {
            const ov = ovFor(t.toolId);
            const skips = !!ov?.skipApproval;
            return (
              <View
                key={t.toolId}
                style={{
                  flexDirection: "row", alignItems: "center", gap: spacing.md,
                  paddingHorizontal: spacing.lg, paddingVertical: 12,
                  borderTopWidth: 1, borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <T kind="bodyMedium" color={colors.text}>{t.name}{t.riskOverridden ? "  ·  custom" : ""}</T>
                  <T kind="sub" numberOfLines={2}>{t.connectorName} · {t.action} · default {t.defaultRisk ?? t.risk}</T>
                  <T kind="caption" color={skips ? colors.coral : colors.textFaint}>
                    {skips ? "Runs without asking" : "Asks for approval"}
                  </T>
                </View>
                <Switch
                  value={skips}
                  disabled={busyTool === t.toolId}
                  onValueChange={() => { tapHaptic(skips ? "select" : "warning"); void toggleSkip(t); }}
                  trackColor={{ true: colors.ember, false: colors.surfaceSunken }}
                  accessibilityLabel={`${t.name}: ${skips ? "runs without asking" : "asks for approval"}`}
                />
              </View>
            );
          }) : null}
          {open && loaded && !failed && gated.length === 0 ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              <T kind="sub">No approval-gated tools in the catalog.</T>
            </View>
          ) : null}
        </Card>
      </Rise>
    </>
  );
}

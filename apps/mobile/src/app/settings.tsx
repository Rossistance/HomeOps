import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type AIProviderRec, type CatalogToolRec, type RiskOverrideRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Truthful readiness labels — mirror the server vocabulary in server/ai.mjs.
// "configured" is NOT "working": only a real probe upgrades it to Reachable.
const READINESS: Record<string, { label: string; color: string; bg: string }> = {
  healthy: { label: "Reachable", color: Hearth.sage600, bg: Hearth.sageBg },
  configured: { label: "Test to verify", color: Hearth.amber600, bg: Hearth.amberBg },
  needs_health_check: { label: "Test to verify", color: Hearth.amber600, bg: Hearth.amberBg },
  unreachable: { label: "Unreachable", color: Hearth.coral600, bg: Hearth.coralBg },
  not_configured: { label: "Not configured", color: Hearth.ink500, bg: Hearth.surfaceSunken },
};

interface ProviderForm { apiKey: string; baseUrl: string; model: string }

export default function SettingsScreen() {
  const { session, signOut } = useSession();
  const [providers, setProviders] = useState<AIProviderRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>({ apiKey: "", baseUrl: "", model: "" });
  const [busy, setBusy] = useState<string | null>(null); // "<providerId>:<action>"
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [testReply, setTestReply] = useState<{ providerId: string; text: string; model?: string; ok: boolean } | null>(null);

  const isAdmin = session?.role === "Owner" || session?.role === "Adult Admin";

  const load = useCallback(async () => {
    setProviders(await api.aiProviders());
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Settings</H1>
        <Muted style={{ marginTop: 4 }}>{session?.actorName} · {session?.role}</Muted>

        <View style={{ marginTop: 20 }}><Eyebrow>AI providers</Eyebrow></View>
        <Muted style={{ marginTop: 4, fontSize: 12 }}>
          Ask HomeOps needs one working provider. Status is verified by real probes — nothing shows as working until it is.
        </Muted>
        {!isAdmin && (
          <Muted style={{ marginTop: 8, fontSize: 12 }}>
            You can see provider status; configuring or switching providers needs an adult admin.
          </Muted>
        )}

        {notice ? (
          <View style={[st.notice, { backgroundColor: notice.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: notice.ok ? Hearth.sage500 : Hearth.coral500 }]}>
            <Body style={{ color: notice.ok ? Hearth.sage600 : Hearth.coral600, fontSize: 14 }}>{notice.text}</Body>
          </View>
        ) : null}

        {providers.map((p) => {
          const m = READINESS[p.readiness] ?? { label: p.readiness, color: Hearth.ink500, bg: Hearth.surfaceSunken };
          const isOpen = expanded === p.id;
          return (
            <Card key={p.id} style={{ marginTop: 8 }}>
              <Pressable onPress={() => open(p)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${m.label}${p.active ? ", active" : ""}`}>
                <View style={st.between}>
                  <View style={{ flex: 1 }}>
                    <View style={st.row}>
                      <Body style={{ fontWeight: "600" }}>{p.name}</Body>
                      {p.active && <Badge label="Active" color={Hearth.ember600} bg={Hearth.ember50} />}
                    </View>
                    <Muted style={{ fontSize: 12, marginTop: 2 }}>{p.kind === "local" ? "Runs on your computer" : "Cloud"}{p.model ? ` · ${p.model}` : ""}</Muted>
                  </View>
                  <View style={st.row}>
                    <Badge label={m.label} color={m.color} bg={m.bg} />
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={Hearth.ink400} style={{ marginLeft: 6 }} />
                  </View>
                </View>
              </Pressable>

              {isOpen && (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <Muted style={{ fontSize: 12 }}>{p.docs}</Muted>
                  {p.health && (
                    <Muted style={{ fontSize: 12 }}>
                      Last check: {p.health.ok ? "reachable" : "unreachable"}
                      {p.health.latencyMs != null ? ` · ${p.health.latencyMs} ms` : ""}
                      {p.health.at ? ` · ${new Date(p.health.at).toLocaleString()}` : ""}
                    </Muted>
                  )}

                  {isAdmin && (
                    <>
                      {p.needsKey && (
                        <TextInput
                          style={st.input}
                          placeholder={p.keySet ? "API key saved — paste to replace" : "API key"}
                          placeholderTextColor={Hearth.ink400}
                          autoCapitalize="none" autoCorrect={false} secureTextEntry
                          value={form.apiKey}
                          onChangeText={(v) => setForm((f) => ({ ...f, apiKey: v }))}
                        />
                      )}
                      {(p.needsBaseUrl || p.local) && (
                        <TextInput
                          style={st.input}
                          placeholder={p.defaultBaseUrl ? `Base URL (default ${p.defaultBaseUrl})` : "Base URL (required)"}
                          placeholderTextColor={Hearth.ink400}
                          autoCapitalize="none" autoCorrect={false} keyboardType="url"
                          value={form.baseUrl}
                          onChangeText={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
                        />
                      )}
                      <TextInput
                        style={st.input}
                        placeholder={p.defaultModel ? `Model (default ${p.defaultModel})` : "Model (blank = auto-discover)"}
                        placeholderTextColor={Hearth.ink400}
                        autoCapitalize="none" autoCorrect={false}
                        value={form.model}
                        onChangeText={(v) => setForm((f) => ({ ...f, model: v }))}
                      />
                      <Button title="Save configuration" variant="primary" loading={busy === `${p.id}:save`} onPress={() => save(p)} />
                    </>
                  )}

                  <View style={st.btnRow}>
                    <View style={{ flex: 1 }}>
                      <Button title="Test connection" variant="ghost" loading={busy === `${p.id}:test`} onPress={() => test(p)} />
                    </View>
                    {isAdmin && !p.active && (
                      <View style={{ flex: 1 }}>
                        <Button title="Set active" variant="ember" loading={busy === `${p.id}:active`} disabled={p.readiness === "not_configured"} onPress={() => activate(p)} />
                      </View>
                    )}
                  </View>
                  {p.readiness !== "not_configured" && (
                    <Button title="Send a test message" variant="ghost" loading={busy === `${p.id}:chat`} onPress={() => sendTest(p)} />
                  )}
                  {testReply?.providerId === p.id && (
                    <View style={[st.notice, { marginTop: 0, backgroundColor: testReply.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: testReply.ok ? Hearth.sage500 : Hearth.coral500 }]}>
                      <Body style={{ fontSize: 13, color: testReply.ok ? Hearth.ink800 : Hearth.coral600 }}>
                        {testReply.ok ? `“${testReply.text}”` : testReply.text}
                      </Body>
                      {testReply.ok && testReply.model ? <Muted style={{ fontSize: 11, marginTop: 4 }}>{testReply.model}</Muted> : null}
                    </View>
                  )}
                  {isAdmin && (p.keySet || p.readiness !== "not_configured") && (
                    <Button title="Remove configuration" variant="danger" loading={busy === `${p.id}:revoke`} onPress={() => revoke(p)} />
                  )}
                </View>
              )}
            </Card>
          );
        })}
        {providers.length === 0 && <Card style={{ marginTop: 8 }}><Muted>Can&apos;t load providers — is the backend reachable?</Muted></Card>}

        {isAdmin && <RiskOverridesSection />}

        <View style={{ marginTop: 24 }}><Eyebrow>More</Eyebrow></View>
        <Card style={{ marginTop: 8, padding: 0 }}>
          <Pressable style={st.navRow} onPress={() => router.push("/connections")} accessibilityRole="button" accessibilityLabel="Connections">
            <Ionicons name="link-outline" size={18} color={Hearth.ink500} />
            <Body style={{ flex: 1, marginLeft: 10 }}>Connections</Body>
            <Ionicons name="chevron-forward" size={16} color={Hearth.ink400} />
          </Pressable>
          <Pressable style={[st.navRow, st.navDivider]} onPress={() => router.push("/activity")} accessibilityRole="button" accessibilityLabel="Activity log">
            <Ionicons name="pulse-outline" size={18} color={Hearth.ink500} />
            <Body style={{ flex: 1, marginLeft: 10 }}>Activity log</Body>
            <Ionicons name="chevron-forward" size={16} color={Hearth.ink400} />
          </Pressable>
          <View style={[st.navRow, st.navDivider]}>
            <Ionicons name="keypad-outline" size={18} color={Hearth.ink400} />
            <Body style={{ flex: 1, marginLeft: 10, color: Hearth.ink400 }}>Approvals PIN</Body>
            <Muted style={{ fontSize: 12 }}>Manage on web</Muted>
          </View>
          <View style={[st.navRow, st.navDivider]}>
            <Ionicons name="moon-outline" size={18} color={Hearth.ink400} />
            <Body style={{ flex: 1, marginLeft: 10, color: Hearth.ink400 }}>Calm Mode</Body>
            <Muted style={{ fontSize: 12 }}>Manage on web</Muted>
          </View>
        </Card>

        <View style={{ marginTop: 24 }}><Eyebrow>Session</Eyebrow></View>
        <Card style={{ marginTop: 8 }}>
          <Muted style={{ fontSize: 12 }}>Backend: {api.url}</Muted>
          <View style={{ marginTop: 10 }}>
            <Button title="Sign out" variant="danger" onPress={() => void signOut()} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

/* ---- Risk & approvals (item 9 mirror) ----
 * Same server records as the web card: re-class a tool's risk or skip its approval
 * gate for this household. Enforced server-side in the engine; every change audited. */
function RiskOverridesSection() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [catalog, setCatalog] = useState<CatalogToolRec[]>([]);
  const [overrides, setOverrides] = useState<RiskOverrideRec[]>([]);
  const [busyTool, setBusyTool] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.riskOverrides();
    if (r) { setCatalog(r.catalog); setOverrides(r.overrides); }
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
      <View style={{ marginTop: 24 }}><Eyebrow>Risk & approvals</Eyebrow></View>
      <Card style={{ marginTop: 8 }}>
        <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Configure approval-gated tools">
          <View style={st.between}>
            <Body style={{ fontWeight: "600", flex: 1 }}>Approval-gated tools</Body>
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={Hearth.ink400} />
          </View>
          <Muted style={{ fontSize: 12, marginTop: 2 }}>Let a trusted tool run without asking. Server-enforced; every skipped gate is still audited.</Muted>
        </Pressable>
        {open && !loaded && <Muted style={{ marginTop: 10 }}>Loading tool catalog…</Muted>}
        {open && loaded && gated.map((t) => {
          const ov = ovFor(t.toolId);
          return (
            <View key={t.toolId} style={st.ovRow}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontSize: 14, fontWeight: "600" }}>{t.name}{t.riskOverridden ? "  ·  custom" : ""}</Body>
                <Muted style={{ fontSize: 12 }}>{t.connectorName} · {t.action} · default {t.defaultRisk ?? t.risk}</Muted>
              </View>
              <Button title={ov?.skipApproval ? "Asks: off" : "Asks: on"} variant={ov?.skipApproval ? "danger" : "ghost"} loading={busyTool === t.toolId} onPress={() => void toggleSkip(t)} />
            </View>
          );
        })}
      </Card>
    </>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  ovRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Hearth.border },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  notice: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  input: {
    borderWidth: 1, borderColor: Hearth.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Hearth.ink900, backgroundColor: Hearth.white,
  },
  btnRow: { flexDirection: "row", gap: 8 },
  navRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13 },
  navDivider: { borderTopWidth: 1, borderTopColor: Hearth.border },
});

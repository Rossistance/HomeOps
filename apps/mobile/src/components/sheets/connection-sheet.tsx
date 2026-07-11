// Connection sheet (82%): what a service unlocks, its honest permission scopes
// under the approval model, and a real Connect via OAuth (ASWebAuthenticationSession).
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/lib/api";
import { useTheme } from "@/theme";
import { T, Badge, Card, Well, Sym, SymTile, HSheet, SheetCTA, Notice, useConfirmFlash } from "@/components/ui";

WebBrowser.maybeCompleteAuthSession();

export interface ConnectionService {
  id: string;
  name: string;
  readiness: string;
  connected: boolean;
  kind: "provider" | "connector";
}

function serviceIcon(id: string, name: string): string {
  const k = `${id} ${name}`.toLowerCase();
  if (k.includes("gmail") || k.includes("mail")) return "envelope";
  if (k.includes("calendar")) return "calendar";
  if (k.includes("sms") || k.includes("twilio") || k.includes("messag") || k.includes("text")) return "paperplane";
  if (k.includes("weather")) return "sun.max";
  if (k.includes("webhook")) return "link";
  return "link";
}

function benefits(id: string, name: string): string[] {
  const k = `${id} ${name}`.toLowerCase();
  if (k.includes("gmail") || k.includes("mail")) return [
    "School and bill emails filed the moment they arrive",
    "Replies drafted for your approval",
  ];
  if (k.includes("calendar")) return [
    "Family events stay in sync",
    "Agents plan around your real schedule",
  ];
  if (k.includes("sms") || k.includes("twilio") || k.includes("messag")) return [
    "Family members add grocery items by text",
    "Updates reach family the way they prefer",
  ];
  if (k.includes("weather")) return ["Morning briefings include the day's forecast"];
  if (k.includes("webhook")) return ["Other services can ping your agents safely", "Every incoming event is logged in Activity"];
  return [`Agents can use ${name} on your behalf — with approval`];
}

export function ConnectionSheet({ service, visible, onClose, onChanged }: {
  service: ConnectionService | null;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { colors, spacing } = useTheme();
  const { flash, show } = useConfirmFlash();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!service) return <>{flash}</>;
  const tone = service.connected ? { fg: colors.sage, bg: colors.sageBg } : { fg: colors.amber, bg: colors.amberBg };

  async function connect() {
    if (!service || busy) return;
    setBusy(true); setNote(null);
    try {
      const start = await api.oauthStart(service.id);
      if (!start.url || start.error) {
        setNote(start.message ?? start.error ?? "Could not start the connection.");
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(start.url, "familios://", { preferEphemeralSession: true });
      if (result.type === "success") {
        const u = new URL(result.url);
        if (u.searchParams.get("ok") === "0") {
          setNote(u.searchParams.get("message") ?? "The connection failed. Please try again.");
        } else {
          show("connect", () => { onChanged(); onClose(); });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // Real in-app disconnect: revoke every one of YOUR accounts on this provider
  // (DELETE /accounts/:id is ownership-checked server-side, so this never touches
  // another family member's connection).
  function disconnect() {
    Alert.alert(
      `Disconnect ${service?.name}?`,
      "FamiliOS deletes its saved access for your account. Agents lose this connection immediately; you can reconnect anytime.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect", style: "destructive",
          onPress: () => void (async () => {
            if (!service || busy) return;
            setBusy(true); setNote(null);
            try {
              const providers = await api.providers();
              const accounts = providers.find((p) => p.id === service.id)?.accounts ?? [];
              if (accounts.length === 0) { setNote("No connected account of yours found on this service."); return; }
              for (const a of accounts) {
                const r = await api.deleteAccount(a.id);
                if (r.error) { setNote(r.error === "forbidden" ? "Only the person who connected this account can disconnect it." : `Couldn't disconnect: ${r.error}`); return; }
              }
              show("connect", () => { onChanged(); onClose(); });
            } finally {
              setBusy(false);
            }
          })(),
        },
      ],
    );
  }

  return (
    <>
      <HSheet
        visible={visible} onClose={onClose} title={service.name} heightPct={0.82}
        footer={service.kind === "provider"
          ? (service.connected
            ? <SheetCTA title="Disconnect" danger onPress={disconnect} />
            : <SheetCTA title={busy ? "Connecting…" : `Connect ${service.name}`} onPress={() => void connect()} disabled={busy} />)
          : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ width: 56, height: 56, borderRadius: 16, borderCurve: "continuous", backgroundColor: tone.bg, alignItems: "center", justifyContent: "center" }}>
              <Sym name={serviceIcon(service.id, service.name)} size={24} color={tone.fg} />
            </View>
            <View style={{ flex: 1 }}>
              <T kind="h2Serif">{service.name}</T>
            </View>
            <Badge label={service.connected ? "Connected" : "Setup required"} fg={tone.fg} bg={tone.bg} />
          </View>

          {note && <Notice text={note} ok={false} />}

          <View style={{ gap: 8 }}>
            <T kind="eyebrow">What it unlocks</T>
            <Card style={{ gap: spacing.md }}>
              {benefits(service.id, service.name).map((b) => (
                <View key={b} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <Sym name="checkmark" size={14} color={colors.sage} style={{ marginTop: 2 }} />
                  <T kind="sub" color={colors.textSecondary} style={{ flex: 1 }}>{b}</T>
                </View>
              ))}
            </Card>
          </View>

          <View style={{ gap: 8 }}>
            <T kind="eyebrow">Permissions</T>
            <Card style={{ gap: spacing.md }}>
              {[
                { label: "Read access", ok: true },
                { label: "Draft actions for your approval", ok: true },
                { label: "Act outside the household without approval", ok: false },
              ].map((s) => (
                <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Sym name={s.ok ? "checkmark" : "xmark"} size={14} color={s.ok ? colors.sage : colors.coral} />
                  <T kind="sub" color={colors.textSecondary} style={{ flex: 1 }}>{s.label}</T>
                  <T kind="detail" color={s.ok ? colors.sage : colors.coral}>{s.ok ? "Allowed" : "Never"}</T>
                </View>
              ))}
            </Card>
          </View>

          <Well>
            <T kind="detail">
              Shared connections are visible to adult admins.{"\n"}You can revoke access anytime — every use is logged.
            </T>
          </Well>
        </ScrollView>
      </HSheet>
      {flash}
    </>
  );
}

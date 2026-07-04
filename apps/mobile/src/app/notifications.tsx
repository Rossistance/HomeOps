import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

type Notice = { id: string; channel: string; title: string; body: string; read: boolean; createdAt: number };

const channelIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
  in_app: "notifications-outline", dashboard: "tv-outline", email: "mail-outline", sms: "chatbubble-outline",
};

function ago(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The notifications inbox: the durable server-side record every in-app delivery
// (server/notify.mjs) lands in — the same collection the web reads. Tap = mark read.
export default function NotificationsScreen() {
  const { session } = useSession();
  const [items, setItems] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await api.notifications());
    setLoaded(true);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const markRead = async (n: Notice) => {
    if (n.read) return;
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x))); // optimistic
    const r = await api.markNotificationRead(n.id);
    if (!r.ok) void load(); // restore on failure
  };

  // Real delivery through the same channel router the agents use — no fake success.
  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await api.notify({ methodType: "In-App", title: "HomeOps test", body: "Test notification from your phone — delivery is working." });
    setTesting(false);
    setTestResult(r.delivered ? "Delivered — it's at the top of the list." : (r.message ?? r.error ?? "Delivery failed."));
    await load();
  };

  const unread = items.filter((n) => !n.read).length;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <H1>Notifications</H1>
        <Muted style={{ marginTop: 4 }}>
          {unread > 0 ? `${unread} unread · delivered by your helpers` : "Everything your helpers delivered to you."}
        </Muted>

        <View style={{ marginTop: 20 }}><Eyebrow>Inbox</Eyebrow></View>
        {!loaded ? (
          <Card style={{ marginTop: 8 }}><Muted>Loading…</Muted></Card>
        ) : items.length === 0 ? (
          <Card style={{ marginTop: 8 }}>
            <Body style={{ fontWeight: "600" }}>Nothing yet</Body>
            <Muted style={{ marginTop: 4, fontSize: 13 }}>
              In-app deliveries from agents and approvals land here. Send a test below to see the real path work.
            </Muted>
          </Card>
        ) : (
          <Card style={{ marginTop: 8, padding: 0 }}>
            {items.map((n, i) => (
              <Pressable
                key={n.id}
                onPress={() => void markRead(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n.title}${n.read ? "" : ", unread"}`}
                style={[st.row, i > 0 && st.divider]}>
                <View style={[st.dot, { backgroundColor: n.read ? "transparent" : Hearth.ember500 }]} />
                <Ionicons name={channelIcon[n.channel] ?? "notifications-outline"} size={18} color={n.read ? Hearth.ink400 : Hearth.ember600} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Body style={{ fontWeight: n.read ? "500" : "700" }}>{n.title}</Body>
                  {n.body ? <Muted style={{ fontSize: 12 }}>{n.body}</Muted> : null}
                  <Muted style={{ fontSize: 11, marginTop: 2 }}>{ago(n.createdAt)}{n.read ? "" : " · tap to mark read"}</Muted>
                </View>
              </Pressable>
            ))}
          </Card>
        )}

        <View style={{ marginTop: 20 }}><Eyebrow>Delivery check</Eyebrow></View>
        <Card style={{ marginTop: 8 }}>
          <Muted style={{ fontSize: 13 }}>
            Sends a real in-app notification through the same channel router agents use.
          </Muted>
          <View style={{ marginTop: 10 }}>
            <Button title={testing ? "Sending…" : "Send test notification"} onPress={() => void sendTest()} disabled={testing} loading={testing} />
          </View>
          {testResult ? <Muted style={{ marginTop: 8, fontSize: 12 }}>{testResult}</Muted> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: Hearth.border },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6, marginRight: 8 },
});

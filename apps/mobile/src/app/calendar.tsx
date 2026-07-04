import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type EventRec, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Calendar (list view) — the mobile home for the three-layer calendar. Canonical
// HomeOps events are the household's own; "linked"/"public" events come from
// subscriptions (ICS/Google) and are read-only, mirrored from the server as-is.
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

function layerBadge(e: EventRec) {
  if (e.layer === "linked") return <Badge label="Synced" color={Hearth.sky500} bg={Hearth.skyBg} />;
  if (e.layer === "public") return <Badge label="Public" color={Hearth.ink500} bg={Hearth.surfaceSunken} />;
  return null;
}

export default function CalendarScreen() {
  const { session } = useSession();
  const canManage = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(session?.role ?? "");
  const [events, setEvents] = useState<EventRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Composer — plain inputs, prefilled to "today at the next full hour" (no native picker dep).
  const now = new Date();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const [time, setTime] = useState(`${pad(Math.min(now.getHours() + 1, 23))}:00`);
  const [location, setLocation] = useState("");

  const load = useCallback(async () => {
    const [ev, mem] = await Promise.all([api.events(), api.members()]);
    setEvents(ev);
    setMembers(mem);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const nameOf = (id: string | null) => (id ? members.find((m) => m.actorId === id)?.displayName ?? null : null);

  const upcoming = useMemo(() => [...events]
    .filter((e) => !e.startAt || new Date(e.startAt).getTime() >= Date.now() - 12 * 3600e3)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))), [events]);
  const byDay = useMemo(() => {
    const map: Record<string, EventRec[]> = {};
    for (const e of upcoming) { const k = e.startAt ? dayKey(e.startAt) : "undated"; (map[k] ??= []).push(e); }
    return map;
  }, [upcoming]);
  const days = Object.keys(byDay).filter((k) => k !== "undated").sort();
  const todayKey = new Date().toISOString().slice(0, 10);

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true); setNotice(null);
    // Parse "YYYY-MM-DD" + "HH:MM" as local time; a blank/invalid date makes an undated event.
    const stamp = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? new Date(`${date.trim()}T${/^\d{1,2}:\d{2}$/.test(time.trim()) ? time.trim().padStart(5, "0") : "09:00"}:00`) : null;
    const r = await api.createEvent({ title: title.trim(), startAt: stamp && !isNaN(+stamp) ? stamp.toISOString() : null, location: location.trim(), visibility: "household" });
    setBusy(false);
    if (r.event) {
      setTitle(""); setLocation(""); setComposerOpen(false);
      setNotice({ text: "Event added.", ok: true });
      await load();
    } else {
      setNotice({ text: r.error === "insufficient_role" ? "Adding events needs Limited Member or higher." : `Couldn't add: ${r.error ?? "unknown error"}`, ok: false });
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <View style={st.headRow}>
          <View style={{ flex: 1 }}><H1>Calendar</H1></View>
          {canManage && (
            <Pressable
              onPress={() => setComposerOpen((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={composerOpen ? "Close new event form" : "Add an event"}>
              <Ionicons name={composerOpen ? "close-circle-outline" : "add-circle-outline"} size={28} color={Hearth.ember500} />
            </Pressable>
          )}
        </View>
        <Muted style={{ marginTop: 4 }}>HomeOps events are yours to edit; synced feeds are read-only.</Muted>

        {notice ? (
          <View style={[st.notice, { backgroundColor: notice.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: notice.ok ? Hearth.sage500 : Hearth.coral500 }]}>
            <Body style={{ color: notice.ok ? Hearth.sage600 : Hearth.coral600, fontSize: 14 }}>{notice.text}</Body>
          </View>
        ) : null}

        {composerOpen && canManage && (
          <Card style={{ marginTop: 12, gap: 8 }}>
            <TextInput style={st.input} placeholder="Event title (e.g. Soccer practice)" placeholderTextColor={Hearth.ink400} value={title} onChangeText={setTitle} accessibilityLabel="Event title" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[st.input, { flex: 1.4 }]} placeholder="YYYY-MM-DD" placeholderTextColor={Hearth.ink400} value={date} onChangeText={setDate} autoCapitalize="none" accessibilityLabel="Event date" />
              <TextInput style={[st.input, { flex: 1 }]} placeholder="HH:MM" placeholderTextColor={Hearth.ink400} value={time} onChangeText={setTime} autoCapitalize="none" accessibilityLabel="Event time" />
            </View>
            <TextInput style={st.input} placeholder="Location (optional)" placeholderTextColor={Hearth.ink400} value={location} onChangeText={setLocation} accessibilityLabel="Event location" />
            <Button title="Add event" variant="ember" loading={busy} disabled={!title.trim()} onPress={() => void add()} />
          </Card>
        )}

        {days.length === 0 && !byDay["undated"] ? (
          <Card style={{ marginTop: 16 }}>
            <Muted>
              Nothing on the calendar yet. {canManage ? "Add an event with the + button, " : ""}subscribe to a school or team feed in Connections, or ask HomeOps to plan something.
            </Muted>
          </Card>
        ) : (
          <>
            {days.map((k) => (
              <View key={k} style={{ marginTop: 16 }}>
                <Eyebrow>
                  {new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}{k === todayKey ? "  ·  Today" : ""}
                </Eyebrow>
                {byDay[k].map((e) => (
                  <EventCard key={e.id} e={e} expanded={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} nameOf={nameOf} />
                ))}
              </View>
            ))}
            {byDay["undated"] && (
              <View style={{ marginTop: 16 }}>
                <Eyebrow>No date set</Eyebrow>
                {byDay["undated"].map((e) => (
                  <EventCard key={e.id} e={e} expanded={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} nameOf={nameOf} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function EventCard({ e, expanded, onToggle, nameOf }: { e: EventRec; expanded: boolean; onToggle: () => void; nameOf: (id: string | null) => string | null }) {
  const time = e.startAt && !isNaN(+new Date(e.startAt)) ? new Date(e.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day";
  const driver = nameOf(e.driverId);
  return (
    <Card style={{ marginTop: 8 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={`${e.title}, ${time}${expanded ? ", collapse details" : ", expand details"}`}>
        <View style={st.between}>
          <View style={{ flex: 1 }}>
            <View style={st.row}>
              <Body style={{ fontWeight: "600", flexShrink: 1 }}>{e.title}</Body>
              {layerBadge(e)}
            </View>
            <Muted style={{ fontSize: 12, marginTop: 2 }}>
              {time}{e.location ? ` · ${e.location}` : ""}{driver ? ` · Driver: ${driver}` : ""}
            </Muted>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={Hearth.ink400} />
        </View>
      </Pressable>

      {expanded && (
        <View style={{ marginTop: 10, gap: 8 }}>
          {e.layer !== "canonical" && (
            <Muted style={{ fontSize: 12 }}>Synced from an external calendar — read-only here. Edit it at the source or copy it on the web app.</Muted>
          )}
          <Detail label="Participants" value={e.participantIds.length ? e.participantIds.map((id) => nameOf(id) ?? id).join(", ") : "None"} />
          <Detail label="Driver" value={driver ?? "Unassigned"} />
          {e.whatToBring.length > 0 && (
            <Detail label="What to bring" value={e.whatToBring.map((w) => `${w.item}${w.memberId ? ` — ${nameOf(w.memberId) ?? ""}` : ""}`).join("\n")} />
          )}
          {e.checklist.length > 0 && (
            <Detail label="Checklist" value={e.checklist.map((c) => `${c.done ? "☑" : "☐"} ${c.text}`).join("\n")} />
          )}
          <Muted style={{ fontSize: 11 }}>{e.layer} layer · {e.category || "event"}</Muted>
        </View>
      )}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Eyebrow>{label}</Eyebrow>
      <Body style={{ fontSize: 14, marginTop: 2 }}>{value}</Body>
    </View>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  notice: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  input: {
    borderWidth: 1, borderColor: Hearth.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Hearth.ink900, backgroundColor: Hearth.white,
  },
});

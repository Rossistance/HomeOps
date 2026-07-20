// T-305 — WP-003 EV-NET-02 lineage probes rerun against LOCAL :8787.
// Notes round-trip, multi-day endAt, allDay flag round-trip. TG- records cleaned up.
const B = "http://127.0.0.1:8787", O = "http://localhost:5173";
const call = async (s, p, i = {}) => {
  const h = { Origin: O, "content-type": "application/json", ...(i.headers || {}) };
  if (s?.cookie) h.Cookie = s.cookie;
  if (s?.csrf && i.method && i.method !== "GET") h["x-homeops-csrf"] = s.csrf;
  const r = await fetch(B + "/api" + p, { ...i, headers: h });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d, sc: r.headers.get("set-cookie") };
};
const lr = await call(null, "/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", actorName: "Ross" }) });
const s = { cookie: (lr.sc || "").split(";")[0], csrf: lr.data?.session?.csrf };
console.log("== LOGIN ->", lr.status);

// P1: notes + multi-day round-trip (mobile-shaped body)
const c1 = await call(s, "/events", { method: "POST", body: JSON.stringify({
  title: "TG-T305 camp", startAt: "2026-07-25T21:00:00.000Z", endAt: "2026-07-27T14:00:00.000Z",
  notes: "TG-T305 pack sunscreen", location: "", driverId: null, whatToBring: [{ item: "towel", memberId: null }], visibility: "household",
}) });
console.log("== P1 create ->", c1.status, "notes=", JSON.stringify(c1.data?.event?.notes), "endAt=", c1.data?.event?.endAt);
const p1 = await call(s, `/events/${c1.data?.event?.id}`, { method: "PATCH", body: JSON.stringify({ title: "TG-T305 camp v2" }) });
console.log("== P1 patch preserves notes:", p1.data?.event?.notes === "TG-T305 pack sunscreen", "endAt intact:", p1.data?.event?.endAt === "2026-07-27T14:00:00.000Z");

// P2: allDay round-trip
const mid = new Date(2026, 6, 25).toISOString();
const c2 = await call(s, "/events", { method: "POST", body: JSON.stringify({ title: "TG-T305 allday", startAt: mid, allDay: true, notes: "", visibility: "household" }) });
console.log("== P2 allDay create ->", c2.status, "allDay=", c2.data?.event?.allDay);
const ls = await call(s, "/events");
const back = (ls.data?.events || []).find((e) => e.id === c2.data?.event?.id);
console.log("== P2 GET round-trip allDay=", back?.allDay, "startAt=", back?.startAt);

// CLEANUP
for (const id of [c1.data?.event?.id, c2.data?.event?.id]) {
  const d = await call(s, `/events/${id}`, { method: "DELETE" });
  console.log("== CLEANUP", id, "->", d.status);
}
const after = await call(s, "/events");
console.log("== INTEGRITY events after cleanup:", after.data?.events?.length, "TG-T305 residue:", (after.data?.events || []).filter((e) => e.title?.includes("TG-T305")).length);

// Maestro runScript helper for the calendar demo household (scripts/seed-calendar-demo.mjs).
// Runs inside Maestro's JavaScript engine: `http`, `json` and `output` are Maestro globals, and
// the env passed by the flow arrives as plain variables. It talks to the same local server the
// app does, as a member, with a bearer session (no cookie, no CSRF), so a flow can:
//   ACTION=prepare  find the share day's "Q3 roadmap review" and the calendar ids, and (with
//                   HIDE=true) put that event back to hidden so a flow starts from the seed
//                   state. → output.shareId, output.subs.{alexFamily,beannieWork,beanniePersonal,samSchool}
//   ACTION=view     read GET /api/events as VIEWER (an actor id) and summarise it for
//                   assertTrue. → output.view.{workTitles, blocksToday (on the share day), sees:{…}}
// API_URL defaults to http://127.0.0.1:8787, the simulator-local build's server.

var BASE = (typeof API_URL !== "undefined" && API_URL) ? API_URL : "http://127.0.0.1:8787";
var WORK_TITLES = ["Team standup", "Q3 roadmap review", "1:1 with Priya", "Vendor call with Acme", "Design critique", "Budget sync", "Hiring panel debrief"];

function signIn(actorId) {
  var r = http.post(BASE + "/api/session", {
    headers: { "Content-Type": "application/json", "x-homeops-bearer": "1" },
    body: JSON.stringify({ actorId: actorId }),
  });
  if (!r.ok) throw new Error("sign-in as " + actorId + " failed: " + r.status + " " + r.body);
  return json(r.body).token;
}
function get(token, path) {
  var r = http.get(BASE + path, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("GET " + path + " failed: " + r.status + " " + r.body);
  return json(r.body);
}
function post(token, path, body) {
  var r = http.post(BASE + path, {
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("POST " + path + " failed: " + r.status + " " + r.body);
  return json(r.body);
}
/* The "share day": the first day whose 9:30 "Q3 roadmap review" is still ahead. The seed puts
 * Work meetings on today (always) and every weekday after it, and a calendar list may leave out
 * what is already over, so a flow run in the evening works on tomorrow's meetings instead. */
function shareDayStart() {
  var now = new Date();
  for (var i = 0; i < 8; i++) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    var weekday = d.getDay() !== 0 && d.getDay() !== 6;
    var roadmap = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 30).getTime();
    if ((i === 0 || weekday) && roadmap > now.getTime()) return d.getTime();
  }
  throw new Error("no share day in the next week");
}
function onShareDay(iso) {
  var t = Date.parse(iso || "");
  var s = shareDayStart();
  return t >= s && t < s + 86400000;
}

var action = typeof ACTION !== "undefined" ? ACTION : "prepare";

if (action === "prepare") {
  var tok = signIn("m-beannie");
  var events = get(tok, "/api/events").events;
  var share = null;
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.block || e.title !== "Q3 roadmap review" || !onShareDay(e.startAt)) continue;
    share = e;
  }
  if (!share) throw new Error("No \"Q3 roadmap review\" on the share day — run scripts/seed-calendar-demo.mjs on a fresh data dir first.");
  if (typeof HIDE !== "undefined" && String(HIDE) === "true") {
    post(tok, "/api/events/sharing", { id: share.id, hidden: true });
  }
  var subs = get(tok, "/api/calendar/subscriptions").subscriptions;
  var byName = {};
  for (var j = 0; j < subs.length; j++) byName[subs[j].name] = subs[j].id;
  output.shareId = share.id;
  output.subs = {
    alexFamily: byName["Harper family"],
    beannieWork: byName["Beannie work"],
    beanniePersonal: byName["Beannie personal"],
    samSchool: byName["Sam school"],
  };
} else if (action === "view") {
  var vtok = signIn(VIEWER);
  var list = get(vtok, "/api/events").events;
  var titles = {};
  var blocksToday = 0;
  var workTitles = [];
  for (var k = 0; k < list.length; k++) {
    var ev = list[k];
    if (ev.block) {
      if (ev.title === "Beannie working" && onShareDay(ev.startAt)) blocksToday++;
      titles[ev.title] = true;
      continue;
    }
    titles[ev.title] = true;
    if (WORK_TITLES.indexOf(ev.title) >= 0 && workTitles.indexOf(ev.title) < 0) workTitles.push(ev.title);
  }
  output.view = {
    workTitles: workTitles.join(", "),
    workTitleCount: workTitles.length,
    blocksToday: blocksToday,
    sees: {
      beannieWorking: !!titles["Beannie working"],
      roadmap: !!titles["Q3 roadmap review"],
      pottery: !!titles["Beannie pottery class"],
      birthdayDinner: !!titles["Mom's birthday dinner"],
      gpopGolf: !!titles["Gpop golf with Frank"],
      gpopBusy: !!titles["Gpop busy"],
      alexDentist: !!titles["Alex dentist"],
      samStudy: !!titles["Sam chemistry study group"],
    },
  };
} else {
  throw new Error("demo-api.js: unknown ACTION " + action);
}

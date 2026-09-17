// One helper, one screen.
//
// "Overly complicated and cumbersome with what happens where, what gates approve what."
//
// The old detail screen had eleven sections, because a helper's behaviour was spread across
// seven records: an Agent that named it, a Skill that held its steps, Functions and tools it
// was permitted, a Playbook it might follow, an Automation and a Trigger that decided when,
// and an Evolution registry proposing changes to it. Every one of those had its own notion
// of permission, and the screen's job was to reconcile them on the reader's behalf. It could
// not, and neither could the reader.
//
// There is one record now, with four fields a person can change:
//
//   Name             what to call it
//   What it does     the instructions — THIS IS THE HELPER. Everything else is scheduling.
//   When it runs     manual / hourly / daily / weekly
//   Permission       ask · act · full, in the server's own three sentences
//
// and three things a person can do to it: run it now, pause it, delete it. Below that, what
// it has actually been saying and doing, as a thread.
//
// Two rules this screen keeps:
//
//   THE INSTRUCTIONS ARE NEVER HIDDEN. Not behind an edit sheet, not clamped to four lines,
//   not summarised into bullet points by something that guessed. They are the tallest control
//   on the screen and they are always editable, because they are the only thing that decides
//   what this helper will do.
//
//   REFUSALS ARE QUOTED, NOT TRANSLATED. The server distinguishes "you're not an adult",
//   "this isn't yours", "this belongs to the household", "the PIN is missing" and "the PIN is
//   wrong", and writes a sentence for each. Three of those are things the reader can act on.
//   Collapsing them into "you can't do that" is how a fixable refusal becomes a wall.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  api,
  type AssistantToolCall, type ConversationMessage, type HelperAutonomy,
  type HelperInput, type HelperRunRec, type HelperSchedule, type PublicHelper,
} from "@/lib/api";
import { useSession } from "@/lib/session";
import { canManageOwn } from "@/lib/roles";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Card, Well, Badge, Chip, ChipRow, SectionHeader, SkeletonCards, ErrorState, Notice,
  Rise, HScreen, PressableScale, Sym, SymTile, Button, MarkdownText, PinPrompt, useConfirmFlash,
} from "@/components/ui";
import { ActionBar, ACTION_BAR_HEIGHT } from "@/components/ui/action-bar";
import { helperLook, helperTint, describeSchedule, clockLabel, runClock, WEEKDAYS } from "@/lib/helper-meta";

/* The three sentences. They are the server's, word for word — the same strings it puts in
 * `autonomyText` — so the choice you make here reads identically to the state you read back
 * on the card. A paraphrase here would be a second, quieter policy. */
const AUTONOMY: { key: HelperAutonomy; sentence: string; icon: string }[] = [
  { key: "ask", sentence: "Asks before it does anything", icon: "hand.raised" },
  { key: "act", sentence: "Does everyday things on its own, asks before sending or spending", icon: "bolt" },
  { key: "full", sentence: "Does everything on its own, including sending and spending", icon: "bolt.fill" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = ["00", "15", "30", "45"];

function splitTime(t: string): { h: number; m: string } {
  const [hh, mm] = String(t ?? "").split(":");
  const h = Number(hh);
  return { h: Number.isFinite(h) && h >= 0 && h <= 23 ? h : 8, m: MINUTES.includes(mm) ? mm : "00" };
}
const joinTime = (h: number, m: string) => `${String(h).padStart(2, "0")}:${m}`;

/** Parse a schedule that arrived as a route param, without trusting a word of it. */
function parseSchedule(raw: string | undefined): HelperSchedule {
  try {
    const s = JSON.parse(String(raw ?? "")) as HelperSchedule;
    if (s?.kind === "hourly" || s?.kind === "manual") return { kind: s.kind };
    if (s?.kind === "daily" && typeof s.time === "string") return { kind: "daily", time: s.time };
    if (s?.kind === "weekly" && typeof s.time === "string") return { kind: "weekly", time: s.time, weekday: Number(s.weekday) || 0 };
  } catch { /* a malformed param is a manual helper, not a crash */ }
  return { kind: "manual" };
}

const sameSchedule = (a: HelperSchedule, b: HelperSchedule) => JSON.stringify(a) === JSON.stringify(b);

export default function HelperScreen() {
  const { colors, spacing, radii, type } = useTheme();
  const { session } = useSession();
  const params = useLocalSearchParams<{
    id: string; name?: string; purpose?: string; instructions?: string; autonomy?: string; schedule?: string; icon?: string;
  }>();
  const id = params.id;
  const isNew = id === "new";
  const { flash, show } = useConfirmFlash();
  const scroller = useRef<ScrollView>(null);

  const [loading, setLoading] = useState(!isNew);
  const [refreshing, setRefreshing] = useState(false);
  const [helper, setHelper] = useState<PublicHelper | null>(null);
  const [gone, setGone] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  /* ---- the form ---- */
  const [name, setName] = useState(params.name ?? "");
  const [purpose, setPurpose] = useState(params.purpose ?? "");
  const [instructions, setInstructions] = useState(params.instructions ?? "");
  const [schedule, setSchedule] = useState<HelperSchedule>(() => parseSchedule(params.schedule));
  const [autonomy, setAutonomy] = useState<HelperAutonomy>(
    params.autonomy === "act" || params.autonomy === "full" ? params.autonomy : "ask",
  );
  const [saving, setSaving] = useState(false);

  /* ---- running now ---- */
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; toolCalls?: AssistantToolCall[] } | null>(null);

  /* ---- the thread ---- */
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [lastRun, setLastRun] = useState<HelperRunRec | null>(null);

  const canWrite = canManageOwn(session?.role);

  const seed = useCallback((h: PublicHelper) => {
    setHelper(h);
    setName(h.name);
    setPurpose(h.purpose);
    setInstructions(h.instructions);
    setSchedule(h.schedule);
    setAutonomy(h.autonomy);
  }, []);

  const load = useCallback(async () => {
    if (isNew || !id) { setLoading(false); return; }
    const [h, hist] = await Promise.all([api.helper(id), api.helperHistory(id)]);
    if (!h) { setGone(true); setLoading(false); return; }
    seed(h);
    setHistory(hist.messages);
    setLastRun(hist.lastRun ?? h.lastRun);
    setLoading(false);
  }, [id, isNew, seed]);

  // Once, on mount. Refetching on every focus would throw away half-typed instructions the
  // moment a sheet closed over this screen — the editor is a document, not a dashboard.
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const dirty = isNew
    ? !!(name.trim() || instructions.trim())
    : !!helper && (
      name.trim() !== helper.name
      || purpose !== helper.purpose
      || instructions !== helper.instructions
      || autonomy !== helper.autonomy
      || !sameSchedule(schedule, helper.schedule)
    );
  const canSave = canWrite && dirty && !!name.trim() && !!instructions.trim() && !saving;

  /* ---- saving, and the one gate that is real ---------------------------------------
   *
   * `autonomy: "full"` is the send-and-spend grant, and the server asks for the household
   * PIN before it will take it. The PIN sheet only appears when the server asks: guessing
   * ahead of it would mean demanding a PIN in households that haven't set one, which teaches
   * people that PIN boxes are a formality. */
  const [pinOpen, setPinOpen] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);

  const body = useCallback((pin?: string): HelperInput & { instructions: string } => ({
    name: name.trim(),
    purpose: purpose.trim(),
    instructions,
    schedule,
    autonomy,
    ...(pin ? { pin } : {}),
  }), [autonomy, instructions, name, purpose, schedule]);

  const commit = useCallback(async (pin?: string) => {
    const payload = body(pin);
    return isNew ? api.createHelper(payload) : api.patchHelper(id, payload);
  }, [body, id, isNew]);

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true); setNotice(null);
    const r = await commit();
    setSaving(false);
    if (r.helper) {
      seed(r.helper);
      tapHaptic("success");
      if (isNew) {
        // Replace, so Back from the saved helper goes to the list rather than to the blank
        // form you just filled in.
        show("helper", () => router.replace(`/(agents)/${r.helper!.id}`));
        return;
      }
      show("helper");
      setNotice({ ok: true, text: "Saved." });
      return;
    }
    if (r.error === "pin_required" || r.error === "pin_invalid") {
      setPinErr(r.error === "pin_invalid" ? (r.message ?? "That PIN didn't match.") : null);
      setPinOpen(true);
      return;
    }
    setNotice({ ok: false, text: r.message ?? "Couldn't save that." });
  }, [canSave, commit, isNew, seed, show]);

  const submitPin = useCallback(async (pin: string) => {
    setPinBusy(true); setPinErr(null);
    const r = await commit(pin);
    setPinBusy(false);
    if (r.helper) {
      setPinOpen(false);
      seed(r.helper);
      tapHaptic("success");
      if (isNew) { show("helper", () => router.replace(`/(agents)/${r.helper!.id}`)); return; }
      show("helper");
      setNotice({ ok: true, text: "Saved." });
      return;
    }
    // Stays open on a bad PIN: dismissing the sheet someone is typing into, to tell them
    // what they typed was wrong, is the worst possible place to put that sentence.
    setPinErr(r.message ?? "Couldn't save that.");
  }, [commit, isNew, seed, show]);

  /* ---- run now ----------------------------------------------------------------------
   *
   * This is a foreground request that regularly takes half a minute: the helper is thinking,
   * calling tools and possibly waiting on an approval. A spinner on the button is not enough
   * information for thirty seconds of silence, so the card below says what is happening and
   * stays put until there is a real answer to replace it with. */
  const runNow = useCallback(async () => {
    if (!helper || running) return;
    setRunning(true); setResult(null); setNotice(null);
    const r = await api.runHelper(helper.id);
    setRunning(false);
    if (r.ok) {
      tapHaptic("success");
      setResult({ ok: true, text: r.answer?.trim() || "Done — nothing needed doing.", toolCalls: r.toolCalls });
      setLastRun(r.lastRun ?? null);
      // The turn is now in the thread server-side; pull it so the history below agrees.
      const [fresh, hist] = await Promise.all([api.helper(helper.id), api.helperHistory(helper.id)]);
      if (fresh) setHelper(fresh);
      setHistory(hist.messages);
      return;
    }
    tapHaptic("error");
    setResult({ ok: false, text: r.message ?? "It couldn't finish this time.", toolCalls: r.toolCalls });
    if (r.lastRun) setLastRun(r.lastRun);
  }, [helper, running]);

  const togglePause = useCallback(async () => {
    if (!helper) return;
    const next = helper.status === "Active" ? "Paused" : "Active";
    const before = helper;
    setHelper({ ...helper, status: next, enabled: next === "Active" });
    const r = await api.patchHelper(helper.id, { status: next });
    if (r.helper) { setHelper(r.helper); tapHaptic("select"); return; }
    setHelper(before);
    setNotice({ ok: false, text: r.message ?? "Couldn't change that." });
  }, [helper]);

  const confirmDelete = useCallback(() => {
    if (!helper) return;
    Alert.alert(
      `Delete ${helper.name}?`,
      "It stops running and its history goes with it. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: () => void (async () => {
            const r = await api.deleteHelper(helper.id);
            if (r.ok) { tapHaptic("warning"); router.back(); return; }
            setNotice({ ok: false, text: r.message ?? "Couldn't delete that." });
          })(),
        },
      ],
    );
  }, [helper]);

  /* A saved helper wears the look it wears on the list — reading its colour off the name
   * field would repaint the tile on every keystroke and disagree with the card you came from.
   * An unsaved one has nothing else to go on, so it follows what you type. */
  const look = useMemo(
    () => helperLook(colors, helper ?? { name, purpose, icon: params.icon }),
    [colors, helper, name, purpose, params.icon],
  );
  const scheduleLine = useMemo(() => {
    // A saved, unchanged schedule shows the SERVER's sentence — it is the authority. Only a
    // schedule that hasn't been saved yet gets described locally (see lib/helper-meta).
    if (helper && sameSchedule(schedule, helper.schedule)) return helper.scheduleText;
    return describeSchedule(schedule);
  }, [helper, schedule]);

  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;
  if (gone) {
    return (
      <HScreen refreshing={refreshing} onRefresh={onRefresh}>
        <ErrorState message="This helper no longer exists." onRetry={() => router.back()} />
      </HScreen>
    );
  }

  const tint = helper ? helperTint(colors, helper.status) : { fg: colors.textMuted, bg: colors.surfaceSunken };

  return (
    <>
      <HScreen refreshing={refreshing} onRefresh={onRefresh} bottomPad={ACTION_BAR_HEIGHT + 24} scrollRef={scroller} keyboardAware>
        {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

        {/* ---- who it is ---- */}
        <Rise index={0}>
          <Card style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <SymTile name={look.icon} color={look.fg} bg={look.bg} size={46} iconSize={22} />
              <View style={{ flex: 1, gap: 4 }}>
                <T kind="eyebrow">Name</T>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  editable={canWrite}
                  placeholder="What should we call it?"
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="Helper name"
                  style={{
                    backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
                    paddingHorizontal: 12, paddingVertical: 10, ...type.bodyMedium, color: colors.text,
                  }}
                />
              </View>
              {helper ? <Badge label={helper.status} fg={tint.fg} bg={tint.bg} /> : <Badge label="New" fg={colors.sky} bg={colors.skyBg} />}
            </View>

            <View style={{ gap: 4 }}>
              <T kind="eyebrow">One line for the card</T>
              <TextInput
                value={purpose}
                onChangeText={setPurpose}
                editable={canWrite}
                placeholder="e.g. Keeps an eye on the school calendar"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="What this helper is for, in one line"
                style={{
                  backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
                  paddingHorizontal: 12, paddingVertical: 10, ...type.body, color: colors.text,
                }}
              />
            </View>

            {/* Who else can see it. Read-only: where a helper lives is decided when it's made,
                and moving one between the household and a person changes who it acts FOR. */}
            {helper && helper.visibility !== "household" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Sym name={helper.visibility === "personal" ? "lock" : "person.2.fill"} size={12} color={colors.textFaint} />
                <T kind="caption" color={colors.textFaint}>
                  {helper.visibility === "personal" ? "Just you — nobody else in the household sees this one." : "Shared with your nest only."}
                </T>
              </View>
            ) : null}
          </Card>
        </Rise>

        {/* ---- WHAT IT DOES — the whole helper, in the open ---- */}
        <Rise index={1}>
          <Card style={{ gap: spacing.sm }}>
            <T kind="eyebrow">What it does</T>
            <T kind="detail">
              In your own words, as if you were asking a person. This is exactly what it follows
              every time it runs.
            </T>
            <TextInput
              value={instructions}
              onChangeText={setInstructions}
              editable={canWrite}
              multiline
              placeholder={"e.g. Every morning, check the family calendar for today and tomorrow.\nIf anything needs something brought — a form, kit, money — add it to the Tasks list and tell me what it's for."}
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="What this helper does"
              // The tallest control on the screen, on purpose. It is the helper.
              style={{
                backgroundColor: colors.surfaceSunken, borderRadius: radii.md, borderCurve: "continuous",
                paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
                minHeight: 240, textAlignVertical: "top",
                ...type.body, color: colors.text,
              }}
              // A bottom-most tall field lands under the pinned Save bar when focused; scroll
              // it up rather than trusting an inset that can't know the bar is there.
              onFocus={() => setTimeout(() => scroller.current?.scrollTo({ y: 240, animated: true }), 140)}
            />
          </Card>
        </Rise>

        {/* ---- WHEN IT RUNS ---- */}
        <Rise index={2}>
          <Card style={{ gap: spacing.md }}>
            <View style={{ gap: 4 }}>
              <T kind="eyebrow">When it runs</T>
              <T kind="detail">{scheduleLine}</T>
            </View>
            <ChipRow>
              <Chip label="Only when I ask" icon="hand.tap" selected={schedule.kind === "manual"}
                onPress={() => canWrite && setSchedule({ kind: "manual" })} />
              <Chip label="Every hour" icon="clock" selected={schedule.kind === "hourly"}
                onPress={() => canWrite && setSchedule({ kind: "hourly" })} />
              <Chip label="Every day" icon="sun.max" selected={schedule.kind === "daily"}
                onPress={() => canWrite && setSchedule({ kind: "daily", time: schedule.kind === "weekly" ? schedule.time : "08:00" })} />
              <Chip label="Every week" icon="calendar" selected={schedule.kind === "weekly"}
                onPress={() => canWrite && setSchedule({ kind: "weekly", weekday: 1, time: schedule.kind === "daily" ? schedule.time : "08:00" })} />
            </ChipRow>

            {schedule.kind === "weekly" ? (
              <View style={{ gap: 6 }}>
                <T kind="eyebrow">Which day</T>
                <ChipRow>
                  {WEEKDAYS.map((d, i) => (
                    <Chip key={d} label={d.slice(0, 3)} selected={schedule.weekday === i}
                      onPress={() => canWrite && setSchedule({ ...schedule, weekday: i })} />
                  ))}
                </ChipRow>
              </View>
            ) : null}

            {schedule.kind === "daily" || schedule.kind === "weekly" ? (
              <TimePicker
                value={schedule.time}
                editable={canWrite}
                onChange={(t) => setSchedule(schedule.kind === "weekly" ? { ...schedule, time: t } : { kind: "daily", time: t })}
              />
            ) : null}
          </Card>
        </Rise>

        {/* ---- PERMISSION ---- */}
        <Rise index={3}>
          <Card style={{ gap: spacing.sm }}>
            <T kind="eyebrow">Permission</T>
            {AUTONOMY.map((a) => {
              const selected = autonomy === a.key;
              return (
                <PressableScale
                  key={a.key}
                  onPress={() => { if (!canWrite) return; tapHaptic("select"); setAutonomy(a.key); }}
                  haptic={null}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={a.sentence}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: spacing.md,
                    padding: spacing.md, borderRadius: radii.md, borderCurve: "continuous",
                    backgroundColor: selected ? colors.emberBg : colors.surfaceSunken,
                    borderWidth: 1, borderColor: selected ? colors.ember : "transparent",
                  }}
                >
                  <Sym name={a.icon} size={17} color={selected ? colors.ember : colors.textMuted} />
                  {/* The SENTENCE is the label. "Act" means nothing on its own, which is why
                      the old three-way selector needed a paragraph of explanation beside it. */}
                  <T kind="sub" color={selected ? colors.text : colors.textSecondary} style={{ flex: 1 }}>{a.sentence}</T>
                  <Sym name={selected ? "checkmark.circle.fill" : "circle"} size={17} color={selected ? colors.ember : colors.textFaint} />
                </PressableScale>
              );
            })}
            {autonomy === "full" ? (
              <T kind="caption" color={colors.textFaint}>Allowing this asks for the household PIN.</T>
            ) : null}
            {/* Quiet, one line, and only when it's true: what this helper will ACTUALLY do is
                less than what its own setting says, because the household's stance is stricter. */}
            {helper?.autonomyDowngraded ? (
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                <Sym name="info.circle" size={12} color={colors.amber} style={{ marginTop: 2 }} />
                <T kind="caption" color={colors.amber} style={{ flex: 1 }}>
                  Your household&apos;s settings are stricter than this, so it still asks first. Change it in Settings → Household.
                </T>
              </View>
            ) : null}
          </Card>
        </Rise>

        {!canWrite ? (
          <T kind="caption" center color={colors.textFaint}>
            You can see what this helper does, but changing it needs an adult account.
          </T>
        ) : null}

        {/* ---- run / pause / delete ---- */}
        {helper ? (
          <Rise index={4}>
            <Card style={{ gap: spacing.sm }}>
              <Button
                title={running ? "Working…" : "Run now"}
                icon="play.fill"
                variant="ember"
                full
                loading={running}
                disabled={running || !canWrite}
                onPress={() => void runNow()}
              />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={helper.status === "Active" ? "Pause" : "Resume"}
                    icon={helper.status === "Active" ? "pause.fill" : "play.circle"}
                    variant="neutral"
                    full
                    disabled={!canWrite}
                    onPress={() => void togglePause()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Delete" icon="trash" variant="danger" full disabled={!canWrite} onPress={confirmDelete} />
                </View>
              </View>
              {/* Thirty seconds of nothing is indistinguishable from a broken button, so the
                  pending state is a real card that says what is happening — not a spinner. */}
              {running ? (
                <Well style={{ gap: 4 }}>
                  <T kind="subMedium" color={colors.ember}>Working on it…</T>
                  <T kind="caption" color={colors.textFaint}>
                    It&apos;s reading, thinking and doing. This can take up to a minute. Whatever it does
                    is written into its history below, so nothing is lost if you look away.
                  </T>
                </Well>
              ) : null}
              {result && !running ? (
                <View style={{ gap: spacing.sm }}>
                  <Card padded={false} style={{ padding: spacing.md, gap: 6 }}>
                    {result.ok
                      ? <MarkdownText text={result.text} />
                      : <T kind="sub" color={colors.coral} selectable>{result.text}</T>}
                  </Card>
                  {result.toolCalls?.length ? <ToolReceipts calls={result.toolCalls} /> : null}
                </View>
              ) : null}
              {!running && !result && lastRun ? (
                <T kind="caption" color={colors.textFaint}>
                  {lastRun.ok
                    ? `Last ran ${runClock(lastRun.at)} — ${lastRun.summary || "nothing needed doing"}.`
                    : `Last tried ${runClock(lastRun.at)} — ${lastRun.error || lastRun.summary || "it didn't finish"}.`}
                </T>
              ) : null}
            </Card>
          </Rise>
        ) : (
          <Rise index={4}>
            <Well>
              <T kind="detail">
                Nothing is saved yet. Read what it does above, change anything you&apos;d say differently, then save — it can be run straight away.
              </T>
            </Well>
          </Rise>
        )}

        {/* ---- the thread ---- */}
        {helper ? (
          <Rise index={5}>
            <SectionHeader title="What it's been doing" />
            {history.length === 0 ? (
              <Card><T kind="sub">Nothing yet. Run it, and what it says and does shows up here.</T></Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {history.map((m, i) => <ThreadMessage key={`${m.at}-${i}`} message={m} />)}
              </View>
            )}
          </Rise>
        ) : null}
      </HScreen>

      {/* The bar exists only while there is something to commit. It is opaque and pinned, so
          on an untouched helper a permanently-disabled "Save changes" sat over whatever had
          scrolled beneath it — and on a cloud simulator the first tap on Delete landed on the
          dead bar instead. A control that can't do anything must not be able to eat a tap. */}
      {canWrite && (isNew || dirty) ? (
        <ActionBar>
          <Button
            title={saving ? "Saving…" : isNew ? "Save helper" : "Save changes"}
            variant="ember"
            full
            loading={saving}
            disabled={!canSave}
            onPress={() => void save()}
          />
        </ActionBar>
      ) : null}

      <PinPrompt
        visible={pinOpen}
        title="Household PIN"
        warning="Allowing a helper to send and spend on its own is the strongest permission here. Enter the household PIN to confirm it's you."
        busy={pinBusy}
        error={pinErr}
        onCancel={() => { setPinOpen(false); setPinErr(null); }}
        onConfirm={(pin) => void submitPin(pin)}
      />
      {flash}
    </>
  );
}

/** Hour and minute, on the household's clock. Chips rather than a wheel: no new dependency,
 *  and the same control vocabulary as everything else on this screen. */
function TimePicker({ value, editable, onChange }: { value: string; editable: boolean; onChange: (t: string) => void }) {
  const { colors, spacing } = useTheme();
  const { h, m } = splitTime(value);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <T kind="eyebrow">At</T>
        <T kind="subMedium" color={colors.ember}>{clockLabel(joinTime(h, m))}</T>
        <T kind="caption" color={colors.textFaint}>· your household&apos;s time</T>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {HOURS.map((hour) => (
          <Chip
            key={hour}
            label={clockLabel(joinTime(hour, "00")).replace(":00", "")}
            selected={hour === h}
            onPress={() => editable && onChange(joinTime(hour, m))}
          />
        ))}
      </ScrollView>
      <ChipRow>
        {MINUTES.map((min) => (
          <Chip key={min} label={`:${min}`} selected={min === m} onPress={() => editable && onChange(joinTime(h, min))} />
        ))}
      </ChipRow>
    </View>
  );
}

/** What the helper actually called, as a quiet receipt. Never the answer itself. */
function ToolReceipts({ calls }: { calls: AssistantToolCall[] }) {
  const { colors } = useTheme();
  const tone = (s: AssistantToolCall["status"]) =>
    s === "failed" ? { fg: colors.coral, bg: colors.coralBg, icon: "xmark" }
      : s === "blocked" ? { fg: colors.textMuted, bg: colors.surfaceSunken, icon: "hand.raised" }
      : s === "awaiting_approval" ? { fg: colors.amber, bg: colors.amberBg, icon: "clock" }
      : { fg: colors.sage, bg: colors.sageBg, icon: "checkmark" };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {calls.map((c, i) => {
        const t = tone(c.status);
        return <Badge key={`${c.tool}-${i}`} label={c.summary || c.label || c.tool} icon={t.icon} fg={t.fg} bg={t.bg} />;
      })}
    </View>
  );
}

/** One turn in the helper's thread. Deliberately plainer than the Ask screen's chat: this is
 *  a record of what happened, not a conversation you're in the middle of. */
function ThreadMessage({ message }: { message: ConversationMessage }) {
  const { colors, spacing } = useTheme();
  const failed = message.kind === "error" || (message.kind === "run_result" && message.status === "failed");
  const when = message.at ? new Date(message.at) : null;
  const stamp = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  if (message.role === "user") {
    return (
      <View style={{ gap: 3 }}>
        {stamp ? <T kind="caption" color={colors.textFaint}>{stamp}</T> : null}
        <Well><T kind="sub" selectable>{message.text}</T></Well>
      </View>
    );
  }
  return (
    <View style={{ gap: 3 }}>
      {stamp ? <T kind="caption" color={colors.textFaint}>{stamp}</T> : null}
      <Card padded={false} style={{ padding: spacing.md, gap: 6 }}>
        {failed
          ? <T kind="sub" color={colors.coral} selectable>{message.text}</T>
          : <MarkdownText text={message.textWithoutRows ?? message.text} />}
        {message.toolCalls?.length ? <ToolReceipts calls={message.toolCalls} /> : null}
      </Card>
    </View>
  );
}

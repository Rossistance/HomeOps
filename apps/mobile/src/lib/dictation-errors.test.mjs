// Dictation on a phone call: iOS gives the call the microphone, and the app should say so
// instead of "Dictation stopped" (2026-09-24).
import test from "node:test";
import assert from "node:assert/strict";
import { dictationErrorMessage, endedWithoutHearing, CALL_HINT, QUICK_END_MS } from "./dictation-errors.ts";

test("a busy microphone names the phone call and what to do", () => {
  for (const code of ["audio-capture", "busy"]) {
    const m = dictationErrorMessage(code, "Failed to activate audio session");
    assert.equal(m, CALL_HINT);
    assert.match(m, /phone call/);
    assert.match(m, /try again when the call ends/i);
  }
});

test("an interruption names the call, Siri and alarms", () => {
  assert.match(dictationErrorMessage("interrupted"), /phone call, Siri or an alarm/);
});

test("thinking, or stopping it yourself, is not an error worth an alert", () => {
  assert.equal(dictationErrorMessage("no-speech"), null);
  assert.equal(dictationErrorMessage("aborted"), null);
});

test("permission, network and availability each say what to do", () => {
  assert.match(dictationErrorMessage("not-allowed"), /Settings/);
  assert.match(dictationErrorMessage("network"), /connection/);
  assert.match(dictationErrorMessage("service-not-allowed"), /Siri & Dictation/);
  assert.match(dictationErrorMessage("language-not-supported"), /Siri & Dictation/);
});

test("an unknown error keeps the recognizer's own words, or a plain fallback", () => {
  assert.equal(dictationErrorMessage("client", "Something odd"), "Something odd");
  assert.equal(dictationErrorMessage("unknown", "  "), "Try again in a moment.");
  assert.equal(dictationErrorMessage(undefined), "Try again in a moment.");
});

test("a start that ends at once, hearing nothing and with no error, is the other shape of a busy mic", () => {
  const base = { startedAt: 1000, heardSomething: false, userStopped: false, hadError: false };
  assert.equal(endedWithoutHearing({ ...base, endedAt: 1000 + QUICK_END_MS - 1 }), true);
  assert.equal(endedWithoutHearing({ ...base, endedAt: 1000 + QUICK_END_MS + 1 }), false, "a normal pause-and-stop is not flagged");
  assert.equal(endedWithoutHearing({ ...base, endedAt: 1200, heardSomething: true }), false);
  assert.equal(endedWithoutHearing({ ...base, endedAt: 1200, userStopped: true }), false, "the person tapped stop");
  assert.equal(endedWithoutHearing({ ...base, endedAt: 1200, hadError: true }), false, "the error already said why");
  assert.equal(endedWithoutHearing({ ...base, startedAt: null, endedAt: 1200 }), false);
});

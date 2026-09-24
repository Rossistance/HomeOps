// What to tell someone when dictation stops without hearing them.
//
// 2026-09-24: "the dictation has ceased working" turned out to be a phone call. iOS gives an
// active call the microphone, so no app can start speech recognition until it ends — and the
// app said only "Dictation stopped", or iOS's own wording, which reads like a broken feature.
// The common causes each get a sentence that says what is happening and what to do.
//
// The error codes are expo-speech-recognition's (ExpoSpeechRecognitionErrorCode). There is no
// public way for an app to ask "is a call active?", so the call is NAMED as the likely cause
// rather than asserted.

export const CALL_HINT = "Dictation can't use the microphone right now. If you're on a phone call, try again when the call ends.";

/** The alert text for a dictation error, or null when the error needs no alert. */
export function dictationErrorMessage(code: string | null | undefined, message?: string | null): string | null {
  switch (code) {
    // Someone tapped the mic and thought, or stopped it themselves — not a failure.
    case "no-speech":
    case "aborted":
      return null;
    // The microphone is taken: a call, FaceTime, another app recording.
    case "audio-capture":
    case "busy":
      return CALL_HINT;
    // Something took the microphone away mid-sentence (iOS names calls, Siri and alarms).
    case "interrupted":
      return "Dictation stopped because something else needed the microphone — a phone call, Siri or an alarm. Try again when it's finished.";
    case "not-allowed":
      return "Turn on Microphone and Speech Recognition for FamiliOS in iOS Settings, then try again.";
    case "network":
      return "Dictation needs a connection right now — check your signal and try again.";
    case "service-not-allowed":
    case "language-not-supported":
      return "Dictation isn't available on this iPhone right now. Check that Siri & Dictation is turned on in Settings.";
    default:
      return (message && String(message).trim()) || "Try again in a moment.";
  }
}

/** Dictation that ended almost at once, heard nothing, reported no error and was not stopped by
 *  the person is the other shape a busy microphone takes — worth the same hint. */
export const QUICK_END_MS = 1500;
export function endedWithoutHearing({ startedAt, endedAt, heardSomething, userStopped, hadError }: {
  startedAt: number | null; endedAt: number; heardSomething: boolean; userStopped: boolean; hadError: boolean;
}): boolean {
  if (startedAt == null || heardSomething || userStopped || hadError) return false;
  return endedAt - startedAt < QUICK_END_MS;
}

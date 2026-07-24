// The iOS app had NO crash reporting of any kind. A render error was a white screen on a
// device nobody watching the server could see, and an unhandled rejection was silent —
// so the only signal that anything broke was a person remembering to mention it.
//
// Reports go to the household's OWN server (/api/client-errors), which lands them in the
// same audit trail as everything else and surfaces them in Activity. No third-party
// vendor, no DSN to manage, no household data leaving the server it already trusts.
//
// Two rules shape this file:
//   1. The reporter must NOT depend on the machinery that may have crashed. It uses a
//      bare fetch rather than lib/api's request pipeline, and never throws — a reporter
//      that can fail is a reporter you can't trust the silence of.
//   2. It must never become the loudest thing in the app. Reports are de-duplicated and
//      capped per session, so a render loop can't spam the audit log into uselessness.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_URL } from "@/lib/api";

export interface CrashContext {
  fatal?: boolean;
  /** Where it happened, when we know — the route or component that failed. */
  screen?: string;
}

const MAX_PER_SESSION = 20;
let sent = 0;
const seen = new Set<string>();

/** Stable-enough identity for de-duping a repeating error without hashing the world. */
const fingerprint = (message: string, stack?: string) => `${message}::${(stack ?? "").slice(0, 200)}`;

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message || err.name || "Error", stack: err.stack };
  if (typeof err === "string") return { message: err };
  try { return { message: JSON.stringify(err).slice(0, 500) }; } catch { return { message: String(err) }; }
}

/** Best-effort, fire-and-forget. Never throws, never rejects, never blocks a render. */
export function reportCrash(err: unknown, ctx: CrashContext = {}): void {
  try {
    const { message, stack } = describe(err);
    const fp = fingerprint(message, stack);
    if (seen.has(fp) || sent >= MAX_PER_SESSION) return;
    seen.add(fp);
    sent += 1;

    // In development the console is the faster feedback loop, and shipping dev noise to
    // the family's audit trail would bury the reports that matter.
    if (__DEV__) { console.error("[crash]", message, stack); return; }

    void fetch(`${API_URL}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: `${Platform.OS} ${String(Platform.Version ?? "")}`.trim(),
        appVersion: Constants.expoConfig?.version ?? null,
        fatal: ctx.fatal === true,
        screen: ctx.screen ?? null,
        message,
        stack,
      }),
    }).catch(() => { /* offline, or the server is the thing that's down — never rethrow */ });
  } catch { /* reporting must not be able to crash the app it reports on */ }
}

/**
 * Install process-wide handlers. Call once, as early as possible.
 *
 * Chains the PREVIOUS handler rather than replacing it: React Native installs its own
 * (the red box in dev, the default crash path in release), and silently swallowing that
 * would trade one blind spot for another.
 */
export function installCrashReporting(): void {
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined; setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void };
    __familiosCrashInstalled?: boolean;
  };
  if (g.__familiosCrashInstalled) return; // idempotent: Fast Refresh re-runs module bodies
  g.__familiosCrashInstalled = true;

  const prior = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    reportCrash(error, { fatal: !!isFatal });
    prior?.(error, isFatal);
  });
}

// HomeOps AI — push notifications (Expo). Shared by the run engine (so a run that
// parks for approval notifies the household even with NO browser open) and by the
// HTTP layer (API-created approvals). Fire-and-forget; never throws.
import { getPushTokens } from "./store.mjs";

export async function pushApprovalNotification(approval) {
  try {
    const tokens = getPushTokens();
    if (!tokens.length) return { ok: false, reason: "no_tokens" };
    const body = `${approval.toolId ?? "Action"}${approval.preview ? " — " + String(approval.preview).slice(0, 80) : ""}`;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title: "Approval needed", body, data: { type: "approval", id: approval.id }, sound: "default", badge: 1 }))),
    });
    return { ok: true, sent: tokens.length };
  } catch {
    return { ok: false, reason: "send_failed" };
  }
}

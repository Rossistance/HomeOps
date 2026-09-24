// Where a tapped push should take the app. The server puts { type, id } on every push it
// sends; until now nothing on the phone read it, so a tap opened whatever screen was last
// up. One table, tested, used by the response listener and the cold-start check.
export type PushData = { type?: string; id?: string; messageId?: string } | null | undefined;

export function routeForNotification(data: PushData): { pathname: string; params?: Record<string, string> } | null {
  const type = data?.type;
  const id = data?.id;
  switch (type) {
    case "thread": return id ? { pathname: "/messages/[id]", params: { id } } : { pathname: "/inbox", params: { seg: "messages" } };
    // A block id (someone else's hidden time, ADR-005) never opens as an event: the calendar.
    case "event": return id && !id.startsWith("blk_") ? { pathname: "/event-form", params: { id } } : { pathname: "/calendar" };
    case "task": return id ? { pathname: "/tasks", params: { id } } : { pathname: "/tasks" };
    case "approval": return { pathname: "/inbox", params: { seg: "approvals" } };
    case "help_request": return { pathname: "/help" };
    default: return null;
  }
}

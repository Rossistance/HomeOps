// Graceful catch-all for stray deep links (e.g. homeops://oauth-callback opened
// outside an auth session) — bounce straight to Home instead of an error page.
import { Redirect } from "expo-router";

export default function NotFound() {
  return <Redirect href="/" />;
}

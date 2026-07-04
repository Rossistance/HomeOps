# Testing HomeOps on your iPhone

The mobile app talks to the **HomeOps backend running on your PC**. On a phone, `localhost`
means the phone itself — so the app must use your PC's **LAN IP**. This is handled for you now:
`npm run dev-client` auto-writes the right address before Metro starts. There are only two
one-time setup steps.

## One-time setup (do these once)

1. **Open the firewall** so your phone can reach Metro + the backend. In an **Administrator**
   PowerShell, from the repo root:
   ```powershell
   powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\allow-firewall.ps1
   ```
   (Opens inbound TCP 8081 + 8787 on Private networks.)

2. **Install the dev client on the phone** (only when native code changes; otherwise reuse the
   existing build):
   ```bash
   cd apps/mobile
   eas build -p ios --profile development   # installs via TestFlight / internal distribution
   ```

## Every time you want to test

From the repo root, in **two terminals**:

```bash
# Terminal 1 — backend + web (backend must be running for the phone to reach it)
npm run dev

# Terminal 2 — Metro for the dev client (auto-sets the LAN IP for you)
cd apps/mobile
npm run dev-client
```

Then open the **HomeOps** dev client on your iPhone (same Wi-Fi) and pick this Metro server /
scan the QR. The app's Home screen shows a green "Runtime online" dot when it reached the backend;
if it's offline it prints the exact URL it tried so you can see the mismatch.

## If the phone still can't connect

- **Same Wi-Fi?** Phone and PC must be on the same network (not a Guest SSID that isolates clients).
- **Wrong IP?** `npm run dev-client` prints `EXPO_PUBLIC_API_URL = http://<ip>:8787`. Confirm `<ip>`
  matches your PC (`ipconfig`). To force one: `HOMEOPS_LAN_IP=192.168.x.y npm run dev-client`.
- **Firewall** — re-run step 1 (admin). Corporate/AV firewalls may need the rule added manually.
- **Tunnel fallback** (different networks / locked-down Wi-Fi): `npm run dev-client:tunnel` routes
  *Metro* over a tunnel. The **backend** is still LAN-only — to reach it off-LAN, expose port 8787
  with a tunnel (e.g. `ngrok http 8787`) and start Metro with
  `HOMEOPS_MOBILE_API_URL=https://<your-ngrok-host> npm run dev-client`.

## Notes

- `EXPO_PUBLIC_API_URL` is the **only** env var the app reads. It's written to `.env.local`
  automatically; `.env` holds the localhost default (fine for the web build / iOS Simulator).
- Backend secrets (Google OAuth, etc.) live in the **repo-root** server `.env`, never in `apps/mobile`.
- Changing the API URL requires restarting Metro (`EXPO_PUBLIC_*` is inlined at bundle time) — the
  `predev-client` hook handles this by running before `expo start`.

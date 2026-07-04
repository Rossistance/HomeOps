# HomeOps — Mobile (Expo, iOS-first)

The native mobile client. It talks to the **existing HomeOps backend** (`server/`,
`/api`) using a **bearer token** (native can't use the web's same-origin cookie).
It's built on the server-authoritative surfaces — Approvals, Connections, Activity,
and the stateless Assistant — so it only ever shows real data.

## Prerequisites
- The HomeOps backend running: from `homeops-ai/`, run `npm run dev` (web :5173 + backend :8787).
- Node + the Expo CLI (`npx expo`).

## Point the app at your backend
A phone can't reach your PC's `localhost`. Set the API base to your machine's LAN IP
(find it with `ipconfig`) — create `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:8787
```

Native requests send no Origin and authenticate by bearer token, so they don't need
the backend's CORS allowlist. (For Expo **web**, add `http://localhost:8081` to
`HOMEOPS_ALLOWED_ORIGINS`.)

## Run it
```bash
cd apps/mobile
npx expo start          # scan the QR with Expo Go or a dev client
npx expo start --web    # quick layout sanity check in a browser
```

## iOS build (no Mac required — EAS cloud build)
```bash
npm i -g eas-cli
eas login
eas build -p ios --profile development   # dev client for your device
```
App Store submission needs an Apple Developer account.

## Sign in
On launch you pick a role + name → creates a real server session (token in
expo-secure-store). Elevated roles ask for the owner PIN if one is set.

## What's here (mobile Phase A)
- **Home** — runtime health, "needs your approval" count, recent server audit.
- **Ask** — assistant: ask → grounded answer or a real plan preview.
- **Approvals** — list + Approve/Deny through the server-enforced gate.
- **Connections** — honest connector/provider states.

## Next phases
- B: on-device plan **execution** (mobile run loop), Activity tab, approval push.
- C: on-device OAuth (`homeops://`), Files/Settings, EAS internal build → TestFlight.
- Deferred for build robustness: custom fonts (Fraunces/Inter) + NativeWind.

## Verification note
Verified on Windows via `tsc --noEmit` + `expo export` (Metro iOS bundle). Running on a
real iOS device/simulator is the next step (needs your device or a Mac). No secrets are
kept in plain storage — only the session token, in expo-secure-store.

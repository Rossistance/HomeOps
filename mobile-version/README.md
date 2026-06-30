# HomeOps AI — Mobile PWA Deployment

This folder contains everything you need to deploy HomeOps AI as an installable
Progressive Web App (PWA) that you can host online and share with your household.

---

## What's in this folder

| File | Purpose |
|---|---|
| `netlify.toml` | Copy to repo root → deploy frontend on Netlify (free tier) |
| `vercel.json` | Copy to repo root → deploy frontend on Vercel (free tier) |
| `render.yaml` | Copy to repo root → deploy backend on Render.com (free tier) |
| `setup-icons.mjs` | Run once to generate proper PNG icons (optional, improves iOS) |

---

## Architecture for hosting

```
Your phone / browser
      │  HTTPS
      ▼
Netlify / Vercel (frontend — static React build)
      │  HTTPS /api/*  →  proxy or direct
      ▼
Render / Railway / Fly.io (backend — Node.js on port 8787)
      │
      ├─ Google OAuth (Gmail, Calendar, Drive)
      ├─ AI providers (OpenAI, Anthropic, Gemini, Ollama…)
      └─ Secrets vault (AES-256-GCM, stays on backend)
```

---

## Step-by-step deployment

### 1 — Deploy the backend (Render.com)

1. Push your repo to GitHub.
2. Go to [render.com](https://render.com) → **New → Web Service** → connect your repo.
3. Set **Start Command**: `node server/index.mjs`
4. Add environment variables in the Render dashboard (**never commit real secrets**):

   | Variable | Value |
   |---|---|
   | `PORT` | `8787` |
   | `HOMEOPS_PUBLIC_URL` | `https://your-backend.onrender.com` |
   | `HOMEOPS_ALLOWED_ORIGINS` | `https://your-frontend.netlify.app` |
   | `HOMEOPS_OAUTH_GOOGLE_CLIENT_ID` | from Google Cloud Console |
   | `HOMEOPS_OAUTH_GOOGLE_CLIENT_SECRET` | from Google Cloud Console |

5. Note your backend URL (e.g. `https://homeops-backend.onrender.com`).

### 2 — Configure Google OAuth for the hosted domain

In Google Cloud Console → APIs & Services → Credentials → your OAuth client:

- Add **Authorized redirect URI**: `https://your-backend.onrender.com/api/oauth/callback`
- Keep `http://localhost:8787/api/oauth/callback` for local dev.

### 3 — Deploy the frontend (Netlify)

1. Copy `mobile-version/netlify.toml` to the **repo root**.
2. Edit the `HOMEOPS_BACKEND` value to your Render backend URL.
3. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**.
4. Build command: `npm run build` · Publish directory: `dist`
5. Deploy. You'll get a URL like `https://homeops-app.netlify.app`.

   > **Vercel alternative**: copy `mobile-version/vercel.json` to the repo root,
   > update `HOMEOPS_BACKEND`, then `vercel deploy` or connect via the Vercel dashboard.

### 4 — Share the link

Send `https://homeops-app.netlify.app` to your household. On each device:

- **Android (Chrome)**: tap the three-dot menu → **Add to Home screen** → Install
- **iPhone/iPad (Safari)**: tap Share → **Add to Home Screen**
- **Desktop (Chrome/Edge)**: click the install icon in the address bar

The app will launch full-screen, work offline for cached screens, and look like a native app.

---

## Optional: proper PNG icons (better iOS compatibility)

SVG icons (included by default) work on Android and iOS 16.4+. For older iOS:

```bash
npm install --save-dev sharp
node mobile-version/setup-icons.mjs
```

Then follow the instructions printed by the script to swap `.svg` → `.png` in `vite.config.ts`.

---

## Local dev → still works the same

Running `npm run dev` locally is unchanged — the PWA service worker only activates in
production builds (`npm run build`). The dev server stays fast with no service worker interference.

---

## Environment variables reference

| Variable | Dev default | Production |
|---|---|---|
| `HOMEOPS_BACKEND` | `http://localhost:8787` | Your Render backend URL |
| `HOMEOPS_PUBLIC_URL` | `http://localhost:8787` | Same as backend URL |
| `HOMEOPS_ALLOWED_ORIGINS` | `http://localhost:5173` | Your Netlify/Vercel URL |
| `HOMEOPS_OAUTH_GOOGLE_CLIENT_ID` | from `.env` | Set in hosting dashboard |
| `HOMEOPS_OAUTH_GOOGLE_CLIENT_SECRET` | from `.env` | Set in hosting dashboard |
| `BROWSER_RUNTIME_URL` | (blank) | Optional — Playwright service URL |

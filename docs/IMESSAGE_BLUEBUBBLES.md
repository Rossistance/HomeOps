# iMessage for the whole family — the BlueBubbles bridge

FamiliOS texts families, and families text it back, over **one iMessage number** that a
BlueBubbles Server on a cloud Mac carries for **every household** on the deployment. This
replaced the Twilio SMS gateway on 2026-09-17.

## How a text finds its family

Nothing in the transport tells two families apart — the same Apple ID receives everything.
So identity is decided by the **sender**:

1. BlueBubbles posts the new message to `POST /api/webhooks/bluebubbles`.
2. `server/sms.mjs` asks every household (tenant) whether it has a **verified, opted-in
   `Phone/Text` contact method** matching the sender's handle (last-ten-digit match, so
   "(555) 010-8899" and "+15550108899" are the same person).
3. Exactly one household → the message runs through the household's assistant **as that
   member, inside that tenant** (their role gates the tool catalog exactly like a signed-in
   session); the exchange is saved to their "Text messages" conversation; the answer goes
   back over the bridge into the same chat.
4. Two households know the number → the sender is told the app can't tell which family they
   mean, and nothing is guessed. None → nothing is sent back (an unknown number never learns
   whether it is registered).
5. `STOP` / `START` / `HELP` are honoured before any model sees the message, in every
   household that knows the number.

**Adding a family is adding a household. Adding a person is adding a verified phone
method** (Settings → Contacts, verification code delivered over the same bridge). There is
no routing table to maintain; the contact-method registry is the routing table.

The chat GUID the Mac reports is remembered on the person's contact method
(`imessageChatGuid`) so later replies and helper deliverables (briefings, task lists) land
in the thread they already have with the household number.

## Outbound

Everything that texts goes through the one connector tool `sms.send` (id kept for the
engine, notify, sandbox twin and activity copy): `server/connectors.mjs` → `sendText()` in
`server/bluebubbles.mjs` → `POST /api/v1/message/text` on the Mac, with
`POST /api/v1/chat/new` as the first-contact fallback. Sends stay approval-gated exactly as
before.

## Setting up the Mac

1. A cloud Mac (HostMyApple or any Apple-hardware host) signed in to iMessage with the
   household's shared Apple ID. BlueBubbles Server runs **headless** (no Electron window)
   to fit a 4 GB machine.
2. In BlueBubbles Server, set a **server password** — that is the API credential
   (BlueBubbles reads it from `?password=`; FamiliOS also sends it as a bearer header so a
   proxy can enforce it).
3. Expose the server to Render through a tunnel (Cloudflare Tunnel or Tailscale) and note
   the URL.
4. Register the webhook in BlueBubbles Server for **New Messages**:
   `POST https://<your-render-host>/api/webhooks/bluebubbles?secret=<webhook secret>`
   BlueBubbles does not sign webhooks; this secret is the whole gate, and production
   refuses deliveries without one.
5. Configure the deployment (Render → Environment) or Connections → iMessage:

   | Variable | Meaning |
   |---|---|
   | `BLUEBUBBLES_URL` | the tunnel URL of the Mac, e.g. `https://imessage.example.com` |
   | `BLUEBUBBLES_PASSWORD` | the BlueBubbles server password |
   | `BLUEBUBBLES_WEBHOOK_SECRET` | the secret in the registered webhook URL |
   | `BLUEBUBBLES_SEND_METHOD` | `private-api` (default) or `apple-script` |

6. Connections → iMessage → **Run health check** pings the Mac with the password.

## Tests

`server/test/bluebubbles.test.mjs` (the wire, against a fake Mac), `sms-gateway`,
`sms-inbound-idempotency`, `sms-keywords`, `sms-tenant-resolution`, `notify-contact-delivery`,
`contact-verification`, `provider-setup`.

# Product Intent Register — run-20260723-143314

| ID | Claim | Type | Confidence | Evidence IDs | Notes |
|---|---|---|---|---|---|
| PI-101 | FamiliOS is a family operating system: approval-gated AI helpers do household admin (inbox, calendar, meals, bills, documents, devices, messaging) | goal | confirmed | EV-119, prior PI-001 | Carried forward and re-confirmed this run |
| PI-102 | The product's success sentence is: user asks in plain English → work happens → "done, as you requested" — and it visibly is | promise | confirmed | EV-101/102/103 (user states it directly), EV-119 | The single measure the owner judges everything by |
| PI-103 | Risky actions pause for human sign-off; nothing leaves the household without consent | promise | confirmed | EV-103 (contact-method allowlist UI), EV-106 | Architecture genuinely enforces this — a strength |
| PI-104 | One user-facing entry ("Helper Agents") should package automations, tools, skills, and functions together | goal | confirmed | EV-102, prior mission goal statement | WP-005 shipped the surface; ISS-108 undermines it |
| PI-105 | Helpers are meant to be self-configuring — the app infers capabilities rather than making users author handlers | workflow | strongly-inferred | EV-102 ("the app should be doing this by itself", "I'm not supposed to have to do this") | Directly contradicted by ISS-117 |
| PI-106 | Templates advertise multi-agent workflows staffed by named specialist agents | promise | confirmed | EV-108 (template data), EV-102 (user reads the list aloud) | Contradicted by ISS-103 — the agents are never created |
| PI-107 | Web and iOS are both first-class surfaces onto one household | goal | strongly-inferred | EV-102/103 (user constantly compares), docs/platform-parity-matrix.md | Contradicted by ISS-118 |
| PI-108 | Memory is a durable family brain that improves recall over time | goal | confirmed | prior WP-007, EV-103 | Undermined by ISS-113 duplicate/misclassified facts |
| PI-109 | Status language must be literally true (no mock success) | promise | confirmed | prior PI-010, WP-002 delivers-flag work | Re-violated by ISS-110 and ISS-120 — the class recurs at new layers |
| PI-110 | CONTRADICTION: creation is presented as activation ("Active") while nothing validates runnability | contradiction | confirmed | EV-107, EV-109, EV-117 | The root architectural contradiction this audit surfaces |
| PI-111 | CONTRADICTION: the owner was told his data was cleaned; only a local copy was | contradiction | confirmed | EV-121, EV-122 | Reporting failure by the prior mission, not just a technical one |
| PI-112 | Unattended, scheduled helpers should deliver without supervision | goal | strongly-inferred | EV-103 (7am briefing triggers), prior JRN-5 | Blocked today by ISS-102/ISS-110 |

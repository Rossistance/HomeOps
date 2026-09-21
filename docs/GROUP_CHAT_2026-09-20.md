# Famili in the family's group chat — what was decided, and what it costs

**Shipped 2026-09-20.** Spec: [specs/2026-09-20-milestone-spec.md](specs/2026-09-20-milestone-spec.md).

> **Superseded in part, 2026-09-21.** The routing and tool-scope sections below describe
> one lane; there are now three, and the addressed lane has the full agent and full tool
> catalog. See [GROUP_CHAT_LANES_2026-09-21.md](GROUP_CHAT_LANES_2026-09-21.md). The
> consent design in this document is unchanged and still governs.

Families coordinate where they already talk. The in-app Messages surface that
shipped two days ago is good, and it asks a family to move. This does the
opposite: Famili sits in the iMessage group chat they already have, and mostly
says nothing.

Most of the work is in the "mostly".

## The bit that shaped everything else

A family group chat contains people who are not in the household and who never
agreed to any of this. A grandparent, a neighbour, a kid's friend's parent.

And the bridge is **one Apple ID for every household on the deployment**
(`IMESSAGE_BLUEBUBBLES.md`). This is a shared bot number sitting in someone's
private thread.

So:

**The durable transcript holds messages from household MEMBERS only.** A
non-member's words reach the in-memory classifier window, give it the context it
needs, and are never written to the database. They do not survive a restart. The
classifier is slightly less well grounded afterwards, and that is the trade.

**What persists about a non-member is a count and a pseudonymous hash** — scrypt
under a per-chat salt, used only to avoid counting the same person twice. The
word is *pseudonymous* and it is used deliberately: a ten-digit number is a
small space, and anyone holding this database holds the salt beside it. It
resists a casual read of a backup. It is not anonymisation and is not described
as such, in the code or in the app.

**Famili introduces itself once, before the bind counts.** A bind whose
announcement did not send is not a bind; the chat stays pending. The
announcement names the member who connected it and never the household, because
telling every non-member that a particular household exists and who connected it
is the disclosure the rest of this design spends its time avoiding. This is a
deliberate, bounded exception to the silence rule: that rule protects people who
never chose FamiliOS, and an announcement is how they get to choose.

**Binding takes an authenticated adult. Revoking requires nothing at all.**
Anyone in the thread, member or not, verified or not, can say "Famili stop". The
chat is revoked and the transcript is deleted immediately rather than ageing
out. The asymmetry favours the outsider on purpose.

## Out of the box, Famili cannot speak

Speaking into a chat is `sms.send`, which is high-stakes on three separate
counts (high risk, delivers, action Send). Per-tool auto-allow cannot clear it.
The only things that can are grants an Owner or Adult Admin makes deliberately:
the helper's own unattended dial, `settings.autonomy = "Trusted"`, or a per-tool
risk override.

So the consent story is not a new mechanism. It is the dials the household
already has, and the chat record remembers **which** one authorised it, so the
audit can say.

A household can flip Trusted without ever opening the helper, which is why the
bind screen says in one line that Famili can already speak here when it can.

## The floor is code, not data

`isToolStepAllowed` treats an **empty** allow-list as **permissive** — deny-only,
and its own doc comment says so. That makes an allow-list on a helper record a
preference rather than a boundary: a UI edit, or a PATCH whose `allowedToolIds`
arrives as a string, empties it, and the failure direction is full privilege.

On the one surface where the assistant speaks unprompted, that is not
acceptable. So:

1. `GROUP_TOOL_IDS` is a frozen constant in `group-chat.mjs`, checked at the call
   site before the helper record is consulted. Widening it is a code review.
2. `deniedToolIds` is populated by name rather than by omission, because the deny
   check runs first and unconditionally.
3. An emptied allow-list makes the listener **inert**, not permissive. Inert is
   visible and recoverable.

**The model never names a tool id.** It returns a kind from a fixed enum and the
server does the mapping. The native `famili.*` tools are outside the allow-list
entirely, and every `homeops.*` tool is forced into a model's menu regardless of
any allow-list. A model handed a menu it will then be refused from writes "I
added that" about things it did not add, which is the machinery-narrating
failure the seven-concepts collapse was written about. The cleanest fix is to
hand it no menu.

## Shadow mode is the default

The classifier runs, writes its verdict down, and proposes nothing until a
household turns proposals on.

**Silence is recorded too.** A negative-bias prompt fails asymmetrically: a
false positive is loud and embarrassing, a false negative produces no artifact,
no log line and no complaint, and the family simply never discovers the feature
works. Every verdict is a row, so precision is measurable rather than felt.

The decision log holds a digest over **member-visible text only**, plus a count
of non-member messages. That bounds what the precision number means, and the
bound is stated rather than left implied: a decision judged correct is one an
Owner would endorse *given the member messages the system kept*. It certifies
nothing about the non-member text the model saw and the system discarded. That
is the price of the retention rule, and it is worth paying.

## The ask that outlives the refusal

Someone raises in the chat that another member should book something. Famili
offers. The person it concerns says no.

Keep asking in the group and you have built a machine that embarrasses people in
front of their family. Forget it and a health task the family surfaced on
purpose quietly disappears.

So the ask leaves the thread and becomes a quiet record that, a day or two
later, checks the calendar, checks whether that person said anything since, and
if it still matters asks them **once, in private**.

Three rules hold it together:

**Transcript evidence may close a loop; it may never be reported as
completion.** "All set, I called them" is reason enough to stop asking and is
not reason to tell anyone it is done. Only a calendar record, a fact the system
owns, is ever reported to another person.

**The audit is asymmetric.** Event search here is a substring over title and
location; there is no full-text index. A permissive match silently drops a
health task, which is the failure the feature exists to prevent. A strict one
produces a redundant private nudge, which costs nothing. So closing quietly
demands an exact title match or two overlapping keywords plus the person
actually being on the event plus a parseable start date — never `withinRange`,
which returns true for both a null stamp and an unparseable one.

**Nothing reaches the group without the target saying so.** Not the nudge, not
the acceptance, not the confirmation. The person the task concerns decides
whether the person who raised it gets told, and silence is a no.

## Retention, and where the transcript goes

`settings.chatTranscriptDays` defaults to **0**: the transcript is ephemeral,
and a coordination loop's transcript audit honestly reports that it could not
check the thread rather than implying it did. A household that wants that audit
raises it, and is told that is what it buys.

Pruning drops whole day buckets from the chat record's own index and
point-deletes their rows. There are no secondary indexes in this database and no
`ORDER BY` anywhere; the only sub-linear read is a point read on
`(collection, id)`. Deciding "which rows are old" from the rows themselves would
mean a full-collection scan every minute forever.

**The transcript IS included in household exports and backups.** It is the
household's own members' messages, exactly like the in-app family messages that
already export, and `export.mjs` is include-list-free by design precisely so
that nothing quietly falls out of an export. The non-member problem is solved
upstream: their text never entered the database, so there is nothing to leave
out. This is said here because the alternative — an "exclude from export" flag —
would build the include-list that module argues against.

## What is still open

**One bridge number, many households.** Chat GUIDs are deployment-global, so two
households can in principle each hold a record for one thread. `bindChat`
refuses a cross-household bind outright, because the announcement would
otherwise disclose one household to the other's members. The product answer —
one bridge number per household, or something else — is not decided.

**The bare-payload group case.** `parseInboundWebhook` now returns
`isGroup: null` when a delivery carries no chat context, and that path is
refused for free text while still honouring STOP/START/HELP. Whether BlueBubbles
ever actually emits a group message in that layout is unverified; capturing a
real payload from the deployed bridge would settle it. The fix is right either
way, because the old code answered a message it could not classify.

**Attachments.** `sendAttachment` matches the documented
`/api/v1/message/attachment` shape. The exact multipart field names vary across
BlueBubbles releases and have not been confirmed against the deployed bridge.
The visual confirmation degrades silently, so an untested guess here costs a
picture and never a confirmation.

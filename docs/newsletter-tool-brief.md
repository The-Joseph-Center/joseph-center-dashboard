# The Joseph Center Newsletter Tool — what it is and what it enforces

This is a briefing for an assistant helping write the monthly newsletter outside the
tool. It is taken from the tool's source, so it is what the tool actually does, not a
description of what it is meant to do.

Nothing here is a style opinion. Where a thing is settled copy, it is reproduced exactly,
because the tool inserts it verbatim and any variation is a defect.

---

## 1. What the tool generates vs. what a human writes

Only **two** sections are written fresh each month:

| Section | Who writes it | Notes |
|---|---|---|
| 1 — Guest story | Written (with the tool's help, from the Coffee Chat transcript) | 3–4 paragraphs |
| 2 — Program spotlight | Written by hand | Must end on the standard closing line, below |
| 3 — Impact & videos | Assembled | Header is generated; stats come from program directors; video titles must match YouTube exactly |
| 4 — The ask | **Generated, fixed copy** | Three versions, reproduced in full below. Never rewritten |
| Closing — Partners | **Generated, fixed copy** | Only the partner list changes |

The subject lines, signatures and Section 4 blocks are templates in code rather than
generated text. The source comment is explicit about why: *"a model asked to rewrite
settled copy will vary it, and the variation is the bug."*

---

## 2. The bridge line

Section 1 must end on this line exactly, with the month filled in:

> This is what we mean when we say hope has an address. And this **{Month}**, we're inviting you to help us strengthen the bridge from crisis to stability across the Western Slope of Colorado.

The tool checks for the phrase "hope has an address" and appends the line if it is
missing. It also warns when the month named in it is not the current month — leaving
last month's in is the common error.

**Positioning rule, enforced automatically:** The Joseph Center *is* the bridge. Donors
**sustain** or **strengthen** it. Any phrasing like "help us build a bridge" is flagged
as a must-fix.

---

## 3. Section 1 — the instructions the tool works from

Verbatim requirements given to the model:

- Three or four paragraphs.
- One or two direct quotations where the transcript gives you good ones. Quote exactly; do not tidy someone's grammar into something they did not say.
- Name which program or programs served them.
- First names only, for everyone.
- Dignity first: no pity, no rescue language, no sensationalism. Their agency stays in the sentence. A transcript often contains the worst thing that ever happened to someone — including it in clinical detail is not honesty, it is exposure.
- End on the bridge line, unchanged.

**The transcript is the only source.** No statistic, date, program detail, outcome or
quotation that is not in it. Anything unsettled is raised as a question for the writer
rather than guessed at.

**Two frames, and they are not interchangeable:**

- **Guest frame** — before / support / transformation. Lead with the most emotionally resonant angle, not chronology. Focus on circumstances ("life happened"), never on personal shortcomings.
- **Calling frame** — for a board member or community partner. **No** before/support/transformation arc: they were never in crisis, and writing them as though they were is both wrong and undignified. Instead: how they found The Joseph Center, what they witnessed, why they stayed.

**Writer's notes and corrections outrank the model's reading of the transcript**, but are
never quotable as anyone's speech, and only the transcript can be quoted.

---

## 4. Section 2 — program spotlight

Written by hand. The tool checks for the standard closing line, which reads:

> Every person who **[action]** is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.

If the spotlight is The Golden Girls Project, the **first** mention must be the full
official name, "The Golden Girls Project", before any shortened form.

---

## 5. Section 3 — impact and videos

Header is generated as: **{This month} Impact & {Previous month} Videos**

- Stats come from the program directors and are **never** estimated. Blank, "TBD", "XX" or "0" are all flagged.
- **Labels are editable, and they print as written.** A new month starts with the three the
  document fixes — meals served, individuals welcomed through our doors, families served —
  and the other two are named by the month they describe: August's were "Women moved into
  permanent housing through the Golden Girls Project" and "People served through IFS across
  14 counties". The tool used to seed "Program spotlight stat" and "IFS financial stability",
  print them in the email, and then block the send over them with no way to rename them.
- Stat labels carry a unit noun — "people served through IFS", not "financial stability".
- Five figures is the usual month; fewer than four is a should-fix.
- Fixed intro line above the list: *"Every month, Mona sits down with guests, volunteers, and community members to share real stories of transformation."*
- Then the label **"{Previous month}'s episodes:"**.
- Videos are *last* month's Coffee Chats, usually four or five.
- Video titles must match YouTube exactly. Never fabricate or estimate a title. The email wraps each one in quotation marks itself, once — a title that is already a quotation is not wrapped again.
- Shorts are labelled "Watch Short:" rather than "Watch:", from YouTube's own durations.
- The section ends with an **"Apply here →"** button to `josephcentergj.com/media/apply`. The old `forms.gle` link is retired and any use of it is a must-fix.

---

## 6. Section 4 — the ask, three versions, verbatim

All three are inserted as-is. `{Guest}` is the month's guest or partner name, filled in
automatically; `{Month}` is the current month. Donate link: `josephcentergj.com/donate`.

### Community friend
Subject: *{Month} at The Joseph Center* · Signed: *The Joseph Center Team*

> ## Become a Stability Partner
>
> The Joseph Center is the bridge between crisis and stability. Every month, our Bridge to Stability campaign keeps that bridge standing for people across the Western Slope of Colorado.
>
> **Your monthly partnership strengthens the bridge.**
>
> A recurring gift is what lets us plan — to keep beds open, meals cooked and doors unlocked without waiting to see what arrives. Predictable support is what turns a good month into a program someone can rely on.
>
> The Joseph Center is 100% community and foundation funded.
>
> [Become a Monthly Stability Partner →]
>
> Prefer to give once? A one-time gift goes to work the day it arrives.
>
> [Give One Time →]

### Donor / repeat donor
Subject: *Because of you: {Month} at The Joseph Center* · Signed: *Mona Highline, Founder & CEO*

> ## You Already Answered the Call
>
> You have already given to The Joseph Center, and {Guest}'s story this {Month} is part of what that made possible.
>
> Would you consider making it monthly? A recurring gift is the difference between hoping the support is there and knowing it is. It lets us plan months ahead instead of weeks.
>
> - $15/month
> - $25/month
> - $50/month
> - $100/month
>
> [Become a Monthly Stability Partner →]
>
> Prefer to give once again this month? That matters too.
>
> [Give One Time →]
>
> Would you like to receive a personal letter from Mona? Share your mailing address and she'll be in touch. [Add your address →]

### Recurring donor
Subject: *Your impact this {Month} at The Joseph Center* · Signed: *Mona Highline, Founder & CEO*

> ## You Make This Possible — Every Single Month
>
> {Guest}'s story this {Month} happened because people like you give every month, without being asked twice.
>
> Recurring support is what lets The Joseph Center plan — to hold a bed open, to keep the kitchen running, to say yes when someone walks in on a Tuesday with nowhere else to go.
>
> **You built that.**
>
> We don't take that for granted.
>
> If you would like to hear more about what your partnership is doing across the Western Slope, we would be glad to tell you.
>
> Would you like to receive a personal letter from Mona? Share your mailing address and she'll be in touch. [Add your address →]
>
> Have a question or just want to share something? Reply to this email and someone from our team will get back to you. We're always happy to hear from our partners.

The reply invitation is **recurring-donor only**, and commits "someone from our team"
rather than Mona personally. That wording is deliberate.

---

## 7. Closing section — fixed copy

Only the partner list changes.

> ## Building Community Support Together
>
> None of this works without the foundations and businesses who stand alongside us.
>
> **This Quarter's Foundation Partners:**
>
> - *(the quarter's partners, confirmed with Mona or Shawna)*
>
> Want to see your business or foundation featured as a community partner? [Contact us →]
>
> Can't donate right now? Volunteering is just as valuable. We're especially looking for a photographer to capture life at The Joseph Center — around 50–75 images monthly. We'll credit your work. [Learn more about volunteering →]
>
> The Joseph Center is a bridge. Whether you give, volunteer, or simply share our story, you're helping strengthen the pathway from crisis to stability for families across the Western Slope.
>
> Thank you for being part of this community.

---

## 8. The checks the tool runs before sending

These come from the "Common Errors Caught in Review" table in the process document.
Every one is a plain string test, so they are consistent and free.

**Must-fix:**

| Check | Rule |
|---|---|
| "Transitional housing" | Use **"temporary housing"** |
| "Clients" in an IFS newsletter | IFS uses **"the people we serve"** |
| "Community-funded" | Must read **"100% community and foundation funded"** in full |
| "Build a bridge" | The Joseph Center **is** the bridge — donors sustain it |
| Harness or Colorado Gives links | Retired. All giving goes to josephcentergj.com/donate |
| "Golden Girls" before the full name | First mention is "The Golden Girls Project" |
| Any full name | **First names only, everywhere, for everyone.** A capitalised run that carries on into "Church", "Foundation", "County" and the like is read as an organisation; anything else goes in **Names that are not people** |
| No guest named | All three Section 4 versions reference them |
| Missing or placeholder stats | Never estimated |
| Missing videos or titles | Never fabricated |
| Reused AWeber tag | A subscriber can only enter an automation once |
| AWeber tag with no year | Or the same tag comes round again next year and re-triggers |
| A first name followed by a surname | Matched against the guest, the staff roster and the transcript. Organisation names, this month's partners, the program name and anything in **Names that are not people** are blanked first |
| A name on the withhold list | The writer's own list — minors, anyone who did not consent |
| A phone number or email in Sections 1–2 | Only JC's own published numbers belong in the newsletter |
| "Homeless people", "the homeless", "being homeless" | Say "people experiencing homelessness". Direct quotations are exempt |
| `[X]`, TBD, XX, "once they're finalized", "we'll share" | In Sections 1–3, and in the preview text |
| A stat label that is a slot name | "Program spotlight stat" is scaffolding, not a measurement. Rename it in This Month in Numbers |
| A figure with a number but no label | Name what was counted, or take the row out |
| No figures at all in This Month in Numbers | Read them off the sheet, or add them by hand |
| A figure in Section 2 that is in neither the stats nor your notes | Every number in the spotlight comes from the program directors |
| A `forms.gle` link | The Coffee Chat guest form is josephcentergj.com/media/apply |
| No Coffee Chat episode link | Section 1's "Watch their full story" button is built from it |
| No preview text, or over 140 characters | Required before a month can go out |
| "What we provide" with no bullet list under it | A run of dashes in one paragraph renders as a single line |

**Should-fix:** missing bridge line; wrong month in the bridge line; no foundation
partners; Section 2 missing its standard closing line; no Section 1 headline, or one with
a colon or over ten words; a first sentence that introduces the story instead of starting
it; fewer than four paragraphs, or one that runs to a wall of text; month-tied wording
outside the bridge line; "charity", "the less fortunate", "handout", "hand up" (JC says
"a hand forward"); a Section 2 header without the "{Hook}: {Program}" pattern; a missing
per-program closing CTA; doubled quotation marks in a video title; a stat label with no
unit noun; fewer than four figures in This Month in Numbers; and, in a calling-frame month, the donor and recurring-donor Section 4s still
crediting the reader for the story.

**Raised, never removed:** mentions of a death, custody or foster placement, an arrest or
a medical condition. Fine if it is the guest's own and they told it on air; not fine for
anyone who was not in the room. These appear in the "transcript did not settle" panel.

**Preview text:** one evocative sentence reflecting the guest story — not a summary, not
the subject line again.

---

## 9. What this brief does not contain

- **Sent newsletters.** They live in the dashboard's database, which is not readable from here. Copy one out of the Newsletter tool and paste it in if you want a tone and length baseline.
- **Tests.** `npm test` in `dashboard/` runs the review, the renderer and the prompts against two fixtures: October as it went out, and October corrected. Every fault found in the September → October comparison has a test.
- **The full brand reference.** `docs/jc-brand-reference.md` (342 lines) is the source of truth for terminology, dignity-first framing and positioning. The tool embeds it verbatim in its prompts. Attach that file rather than working from a summary of it.

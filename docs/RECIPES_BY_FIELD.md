# Recipes by professional field

> A menu of agent / skill / recipe contributions organized by profession.
> Built for the people whose workflows AI tooling can change but who don't
> ship JavaScript pull requests.

If you're a teacher, accountant, novelist, real estate agent, nurse, or anyone
else with a real-world job that involves moving information around, this doc is
for you. Each section names contribution ideas that fit what you already do — no
JS required.

---

## How to read this document

Each field has:

- **Why an agent helps you** — the workflow problem you'll recognize
- **Recipe ideas** — concrete contributions, ordered roughly easy → ambitious
- **Safety / privacy notes** — where a domain has unique sensitivities, called out

Recipes are usually one of these shapes (no coding required for any of them):

- **A `skills/` entry** — a reusable agent recipe: system prompt, suggested tools,
  an example conversation, instructions for the user. We'll help you turn your
  draft into the right file format if you've never made a PR.
- **A prompt library** — a curated `.md` file of system prompts for variations
  ("opinionated essay editor", "gentle essay editor", "essay editor for ESL writers").
- **A workflow case study** — a public blog-style write-up: "I'm a [profession],
  here's how I use OnBuzz daily." Real workflows, real screenshots, real opinions.
- **A video walkthrough** — 3–10 minute screen recording showing the agent in action.
- **A "tools wishlist"** — what tool would help your field that doesn't exist yet?
  File it as a feature request and we'll route it to a developer.

If any of this sounds intimidating, **the [contribution-idea issue
template](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml)
is the front door**. Tell us what you want to build and we'll meet you where you are.

---

## EDUCATION & LEARNING

### K–12 teachers

**Why an agent helps you:** lesson planning, differentiated instruction, parent
communication, grading rubrics, IEP accommodations. The unglamorous work that
eats your evenings.

**Recipe ideas:**
- *Lesson plan generator* — input: standard, grade level, time block. Output: a
  full plan with hook, mini-lesson, guided practice, independent practice, exit ticket.
- *Differentiated worksheet maker* — same skill, three versions: scaffolded, on-level, extension.
- *Parent email drafter* — turn your bullet-point notes into a warm, professional email home.
- *IEP accommodation matcher* — given a lesson and a student's IEP, suggest specific accommodations.
- *Grading rubric translator* — convert your rubric into kid-friendly language.

**Safety:** never feed real student names, grades, or PII to a cloud model
without district approval. The Ollama-backed local-only configuration is the
right setup for most classrooms.

### Higher education faculty

**Why an agent helps you:** syllabus design, lecture prep, citation work, grading
support, student email triage.

**Recipe ideas:**
- *Syllabus draft from learning outcomes* — outcomes in, syllabus skeleton out.
- *Reading-list curator* — given a topic + reading level + page budget, propose a sequence.
- *Office-hours triage* — student inbox in, prioritized response queue out, with draft replies.
- *Conference paper outliner* — research notes in, paper structure out.

### Tutors / homework support

**Recipe ideas:**
- *Socratic tutor* — never gives the answer; asks questions until the student gets there.
  Subject-specific variants (math tutor, writing tutor, ESL tutor).
- *Concept-to-analogy generator* — explain X using something the student already knows.
- *Wrong-answer diagnoser* — student wrote 27 × 14 = 286, what was their misconception?

**Safety:** see the K–12 note. For tutors paid privately, get written
permission from parents before any student work goes to a cloud provider.

### Curriculum designers

- *Backward-design template agent* — start with summative assessment, work backward.
- *Standards-alignment auditor* — input a unit plan, get a list of standards covered and gaps.
- *Vertical-articulation checker* — does grade 3 prepare students for what grade 4 needs?

### Test prep coaches

- *Question generator* — given a concept, generate 10 questions in [SAT / ACT / GRE / etc.] format.
- *Distractor analysis* — for a multiple-choice question, why might a student pick each wrong answer?

### Language teachers

- *Comprehensible-input dialogue writer* — generate a dialogue at CEFR level X using vocab list Y.
- *Grammar-correction tutor* — gentle, in-language correction with explanation.
- *Cultural-context explainer* — turn a phrase into a 3-paragraph cultural note.

### Special education

- *Sensory-friendly material rewriter* — strip a worksheet of overstimulating elements.
- *Visual schedule builder* — text routine in, picture-card script out (description for the artist).
- *AAC sentence starter library* — context in, communication-board options out.

### Corporate / adult learning

- *Microlearning generator* — long doc in, 5-minute daily lessons out for a 4-week sequence.
- *Just-in-time job-aid maker* — create the one-page reference for the task.

---

## HEALTHCARE & WELLNESS

> **Privacy is non-negotiable here.** Most of these recipes assume Ollama (local
> model) so no patient information leaves the machine. Even with Ollama, never
> include real PHI in shared prompts or skills you publish — use synthetic data
> in any public artifact.

### Clinicians (MD, DO, NP, PA)

- *SOAP note structurer* — your shorthand in, structured note out (still requires your review).
- *Differential diagnosis brainstormer* — symptoms + history in, ranked differential out
  with reasoning. **Always positioned as a brainstorming aid, never a diagnosis.**
- *Patient-handout simplifier* — clinical instruction in, 6th-grade-reading-level handout out.
- *Discharge-summary first-draft* — chart bullets in, discharge summary out for your edit.

**Disclaimer template** required in every healthcare-clinical skill: *"This tool
is a drafting aid for licensed clinicians. It does not provide medical advice,
diagnose, or treat any condition. The licensed clinician is responsible for all
clinical decisions."* Skills that don't include this won't be merged.

### Nurses

- *Shift-change handoff drafter* — bullets in, SBAR-format handoff out.
- *Patient-education explainer* — condition in, plain-language explanation matched to literacy level out.

### Therapists, counselors, psychologists

- *Session-note structurer* — your bullet recap in, structured note out (DAP / SOAP / progress).
- *Treatment-plan first-draft* — assessment notes in, draft treatment plan out for clinician review.
- *Bibliotherapy curator* — client situation in, suggested books / readings / podcasts out.

**Critical:** do not build an "AI therapist" front-end. The recipes above are
clinician-side admin tools. Patient-facing therapeutic content is out of scope
for this project.

### Medical billing & coding

- *ICD-10 / CPT lookup helper* — clinical scenario in, candidate codes + reasoning out.
- *Denial-appeal letter drafter* — denial reason + chart facts in, appeal letter out.
- *Documentation-gap auditor* — note in, missing-elements-for-billing list out.

### Public health workers

- *Community-health-bulletin drafter* — outbreak data in, neighborhood-newsletter draft out.
- *Survey-response coder* — open-ended responses in, themed coding out (review the AI's work).

### Pharmacists

- *Patient-counseling-points generator* — drug + indication in, counseling outline out.
- *Drug-interaction explainer* — reframe pharmacology jargon for the patient.

### Veterinarians

- *Owner-discharge-instructions drafter* — case summary in, owner-friendly aftercare out.
- *Differential brainstormer* — same as clinical, scoped to species and breed.

### Medical writers / educators

- *Continuing-education module outliner* — topic in, learning-objectives + slide outline out.
- *Plain-language abstract writer* — journal abstract in, layperson summary out.

### Fitness & nutrition coaches

- *Program-design first-draft* — client goals + history + constraints in, 8-week template out.
- *Macro-recalibration agent* — current macros + adherence + result in, suggested adjustments out.
- *Client-check-in summarizer* — last week's logs in, themed summary + suggested questions out.

---

## ACCOUNTING & FINANCE

> **Privacy:** the bookkeeper / CPA / financial advisor recipes work best with
> Ollama. Real client books should never go to a cloud LLM without explicit,
> written client consent and a review of the provider's data-handling terms.

### Bookkeepers

- *Transaction categorizer* — bank export CSV in, categorized output with confidence scores.
- *Reconciliation-discrepancy explainer* — bank balance vs. book balance, find the gap.
- *Client-monthly-package drafter* — figures in, narrative monthly summary out.

### CPAs / tax preparers

- *Tax-research summarizer* — IRS publication or court case in, plain-language summary out.
- *Client-question pre-screener* — client question in, "I think this is about [X]" + needed-info checklist out.
- *Engagement-letter customizer* — situation in, draft tailored letter out for review.

### Financial advisors

- *Suitability-rationale drafter* — recommendation + client profile in, written rationale out.
- *Client-quarterly-letter writer* — market summary + portfolio notes in, personalized letter out.

**Compliance note:** investment advice is regulated. Skills here must be
positioned as advisor admin tools, not robo-advisor front-ends. Include a
disclaimer that the advisor's judgment, not the agent's output, is the
recommendation.

### Auditors

- *Workpaper-narrative writer* — test results in, workpaper memo out.
- *Risk-register builder* — process description in, risk + control mapping out.

### Personal finance hobbyists

- *Budget-from-bank-export* — CSV in, budget category report out. **Local-only via Ollama** is the recommended config.
- *Subscription auditor* — find recurring charges, flag forgotten ones.
- *Tax-loss-harvesting brainstormer* — current positions in, candidate sales out (with disclaimer).

### Small business owners doing their own books

- *Receipt-narrative organizer* — photos / OCR'd receipts in, expense-by-category report out.
- *Cash-flow-forecast first-draft* — last 12 months in, 6-month projection out.

---

## CONTENT CREATION

### YouTubers

- *Title + thumbnail copy A/B generator* — video premise in, 5 title variations + thumbnail copy.
- *Description + chapter writer* — transcript in, SEO-friendly description with chapters.
- *Comment-moderation triage agent* — comments in, flagged hate-speech / spam / spotlight out.
- *Series-arc planner* — channel niche in, 12-video arc with progression out.

### Podcasters

- *Show-notes generator* — transcript in, links + timestamps + key quotes out.
- *Guest-research dossier* — guest name + topic in, talking-points + their public takes + suggested questions.
- *Episode-pitch writer* — for guest outreach.
- *Trailer scriptwriter* — turn an episode into a 60-second teaser.

### Streamers

- *Segment planner* — what to do in stream A / B / C blocks.
- *Chat-moderation policy translator* — your rules in, mod-team-readable + viewer-FAQ out.

### Social media managers

- *Content-calendar generator* — month in, 30-day plan with caption drafts.
- *Brand-voice consistency auditor* — paste a draft, get notes on whether it sounds like you.
- *Cross-platform reformatter* — long-form post in, Twitter thread + IG carousel + LinkedIn version out.

### Newsletter writers (Substack, beehiiv, etc.)

- *Issue-from-bookmarks drafter* — week's saved links in, themed issue out.
- *Subject-line A/B generator*.
- *Reader-email triage + reply-draft agent*.

### Bloggers

- *SEO-aware outliner* — keyword in, outline matched to search intent out.
- *Post-to-tweetstorm distiller*.
- *Editorial-calendar planner from a topic list*.

---

## BOOKS & LONG-FORM WRITING

### Novelists

- *Character-bible builder* — scattered notes in, structured bible (appearance, voice, backstory, motivations, relationships) out.
- *Worldbuilding consistency checker* — feed it your world doc, ask "does this scene contradict anything?"
- *Scene-tension diagnoser* — paste a scene, ask "where's the conflict, where's the stakes?"
- *Beat-sheet generator* — premise in, Save-the-Cat structure out for your edit.
- *POV-consistency auditor* — paste chapter, get notes on slips out of viewpoint.

### Non-fiction authors

- *Source-tracking research agent* — a question in, sources + key quotes + citations out.
- *Argument-coherence auditor* — chapter in, "your thesis says X, but here you say Y" notes.
- *Reader-question pre-empter* — given a chapter, what objections will smart readers raise?

### Screenwriters & playwrights

- *Logline polisher*.
- *Beat-sheet to scene-list converter*.
- *Dialogue-distinctness auditor* — do all your characters sound the same?
- *Pitch document drafter* — script in, one-page pitch out.

### Memoirists

- *Timeline-from-fragments organizer*.
- *Sensitivity reader prompt template* — for the author's first internal pass.

### Editors (developmental, line, copy)

- *Line-edit suggestion agent* — paste paragraph, get rewrites with reasoning.
- *Pacing-graph generator* — paste chapter, get a "tension over pages" assessment.

### Self-publishers

- *Back-cover copy A/B generator*.
- *Amazon keyword brainstorm tool*.
- *Launch-email sequence drafter* — for your mailing list.

---

## MUSIC, LYRICS & AUDIO

> Caveat: OnBuzz today is a text platform. Music recipes here are text-side
> aids — analysis, lyrics, theory writing — not audio generation or DAW
> integration. (That'd be a great future capstone.)

### Lyricists

- *Rhyme + near-rhyme generator* — word in, near-rhymes ordered by stress pattern.
- *Theme-development agent* — line in, three directions to take it.
- *Hook-density analyzer* — paste lyrics, identify candidate hooks.

### Composers (text-side analysis)

- *Chord-progression theory explainer* — given a progression, explain function and emotional effect.
- *Form analyzer* — given a song's structure, identify the form and outliers.

### Producers / engineers

- *Session-notes structurer* — voice memo in, structured prep doc out.
- *Reference-track briefing agent* — list of references in, "what they have in common" descriptive language for the artist.

### Music educators

- *Method-book exercise generator* — concept + level in, 5 progressive exercises out.
- *Repertoire-suggestion agent* — student level + interests in, ranked piece list with reasoning out.

---

## OFFICE & OPERATIONS

### Executive assistants

- *Calendar-conflict resolver* — describe the conflict, get options + suggested message to each party.
- *Inbox-triage agent* — categorize, prioritize, draft replies for the boss's review.
- *Meeting-prep dossier* — meeting topic + attendees in, briefing doc out.
- *Travel-itinerary builder* — constraints in, multi-leg plan with backup options.

### HR / People Ops

- *Job-description drafter* — role bullets in, polished JD out, with "what's missing?" check.
- *Interview-rubric builder* — JD in, structured rubric with calibrated questions out.
- *Policy-from-incident drafter* — describe the issue, get a policy proposal.
- *Onboarding-checklist generator* — role in, week 1 / month 1 / quarter 1 plan out.

### Project managers

- *Status-report drafter* — daily standup notes in, weekly report out.
- *Stakeholder-update tone-shifter* — engineering update in, executive-friendly version.
- *Risk-register prompt* — project description in, risks + mitigations out.

### Office managers

- *Vendor-RFP comparator* — quotes in, side-by-side analysis out.
- *Expense-policy explainer*.
- *Office-event planner* — constraints in, vendor list + checklist out.

### Operations / SOP writers

- *SOP-from-screen-recording transcriber* — transcript of you doing the task in, formal SOP out.
- *Runbook tester* — paste runbook, get "where would a new hire get stuck?" notes.

---

## REAL ESTATE

### Residential agents

- *Listing-description writer* — property facts + photos descriptions in, listing copy in your voice out.
- *Comparative market analysis narrative* — comp data in, plain-language CMA narrative for the seller.
- *Buyer-needs questionnaire interpreter* — questionnaire answers in, prioritized "what they actually want" summary.
- *Open-house follow-up generator* — sign-in sheet notes in, personalized follow-up emails out.
- *Neighborhood-pitch writer* — buyer profile + neighborhood in, "why this neighborhood for them" out.

### Commercial brokers

- *Deal-memo drafter* — terms in, IC-ready memo out for review.
- *Tenant / landlord rep brief writer*.

### Property managers

- *Tenant-communication tone-shifter* — your bullet response in, professional + empathetic version.
- *Maintenance-request triage agent* — tickets in, prioritized + categorized out.
- *Move-in / move-out walk-through report* — voice memo in, written report.

### Real estate investors

- *Deal-analyzer narrative* — pro-forma in, plain-language summary + concerns + questions to ask.
- *Market-report summarizer* — public reports in, "what changed for us this month".

---

## SALES & MARKETING

### SDRs / Account Executives

- *Cold-email A/B generator* — prospect + value-prop in, 3 voice variations.
- *Discovery-call prep dossier*.
- *Follow-up sequence drafter*.
- *Lost-deal-debrief synthesizer* — call notes in, themed reasons-we-lost out.

### Marketers / copywriters

- *Brand-voice document author* — paste 3 examples, get "your voice in 12 rules" out for team use.
- *Landing-page A/B copy generator*.
- *Customer-quote-to-case-study converter*.

### SEO writers

- *Keyword-cluster expander*.
- *Search-intent classifier* — keyword in, intent + content type recommendation out.
- *Internal-linking suggester* — paste post + sitemap, get suggestions.

### Customer success

- *QBR deck outliner from account notes*.
- *Renewal-risk-flagger* — usage data + tickets in, ranked risk list out.
- *Help-doc-from-ticket-pattern writer*.

---

## LEGAL & PARALEGAL

> **Critical disclaimer required.** Skills in this section must include a
> prominent disclaimer that the agent does not provide legal advice, an
> attorney's review is required for any output to be used, and the user (not
> the agent) is responsible for legal decisions. Recipes that style themselves
> as "legal advice" agents won't be merged.

### Paralegals

- *Document-discovery-keyword brainstormer* — case description in, keyword list out.
- *Deposition-prep summary* — exhibits in, attorney-ready summary.
- *Cite-check helper* — paragraph in, list of citations to verify out.

### Court reporters / legal transcribers

- *Speaker-disambiguation aid* — transcript in, "speaker 1 / 2 / 3" pattern detection out.

### Mediators

- *Issue-tree from intake notes* — both sides' views in, structured issues + interests + positions.

### Legal researchers

- *Case-summary first-pass* — case in, structured headnotes out. Always reviewed by an attorney.
- *Statute-evolution tracker* — same statute over time, find changes.

---

## TRADES & SMALL BUSINESS

### Electricians, plumbers, contractors

- *Estimate writer* — job description in, structured estimate with line items out.
- *Customer-explanation translator* — your tech notes in, plain-language explanation for the customer.
- *Permit-narrative generator* — work scope in, permit-application narrative out.

### Restaurant owners

- *Menu-description writer* — ingredients in, evocative + accurate descriptions out.
- *Specials-rotation planner* — inventory + season in, weekly specials brainstorm out.
- *Review-response drafter* — review in, gracious + brand-consistent reply.

### Photographers (text side)

- *Client-onboarding-questionnaire interpreter*.
- *Shot-list builder* — event type + venue + client priorities in, shot list out.
- *Image-description writer for accessibility / SEO*.

### Personal trainers / coaches

- See [Fitness & nutrition coaches](#fitness--nutrition-coaches) above.

---

## NONPROFIT & PUBLIC SECTOR

### Grant writers

- *Grant-deconstructor* — RFP in, structured "what they want, in their words" + criteria + scoring rubric out.
- *Theory-of-change articulator* — program description in, ToC narrative + logic model out.
- *Impact-narrative drafter* — program metrics + anecdote in, donor-ready narrative.

### Donor communications

- *Personalized-thank-you generator at scale* (with human review).
- *Year-end-appeal A/B drafter*.

### Policy analysts

- *Public-comment analyzer* — comments in, themed coding + sentiment out.
- *Brief synthesizer* — multiple sources in, decision-maker-ready brief.

### Social workers (admin side)

- *Case-note structurer* (local-only via Ollama, never cloud).
- *Resource-referral matcher* — client situation in, candidate community resources + eligibility checklist.

---

## RESEARCH & ACADEMIA

### Lab researchers

- *Method-section drafter* — protocol notes in, paper-section draft out.
- *Figure-caption writer*.
- *Lab-meeting prep summarizer*.

### Grant writers (academic)

- See [Grant writers](#grant-writers) under nonprofit. Same patterns apply.

### Conference organizers

- *Call-for-papers drafter*.
- *Submission-triage helper* — abstracts in, themed clusters + flagged "this doesn't fit" out.
- *Acceptance / rejection email personalizer*.

### Translators / interpreters

- *Style-consistency auditor* across a long translation.
- *Terminology-glossary maintainer*.
- *Cultural-localization explainer* — translation in, "here's what was lost / what was localized" notes for the client.

### Genealogists / historians

- *Census-record narrative generator* — raw record in, family-context narrative out.
- *Source-discrepancy reconciler*.
- *Timeline-from-letters builder*.

---

## CREATIVE & EVENT FIELDS

### Visual artists (text-side support)

- *Concept-brainstorm dialogue partner* — describe a piece, push back with "what if".
- *Artist-statement drafter*.
- *Grant-application narrative writer for visual artists*.

### Game masters / TTRPG

- *NPC generator with consistent voice* — short bio + manner of speaking + secret.
- *Encounter balancer* (uses the system's published rules).
- *Plot-thread tracker* across sessions.
- *Lore-bible maintainer*.

### Event planners (weddings, corporate, conferences)

- *Run-of-show generator* — event vision + constraints in, minute-by-minute timeline out.
- *Vendor-RFP comparator*.
- *Guest-management-email kit drafter*.

### Travel agents / tour operators

- *Itinerary builder with constraints* — pace, mobility, dietary, budget all respected.
- *Pre-trip-briefing email kit*.
- *Visa / requirement summary* (always with a "verify with the consulate" disclaimer).

### Religious leaders (sermon prep, pastoral notes)

- *Sermon-research compiler* — text + theme in, sources + outlines + illustrations out.
- *Pastoral-care preparation prompt* — never patient-facing; always preparation for the human conversation.

---

# Don't see your field?

This list is meant to grow. If your profession isn't here and you can describe a
workflow that would benefit from an agent, file a [contribution
idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml)
with the `track:domain` label and a one-paragraph "what I do every day". We'll
help you scope a recipe that fits.

This document is itself a contribution surface — adding a new field, adding
recipes to an existing field, or even just sharing how a recipe worked in your
real practice are all merge-worthy PRs.

---

# A word on responsible use

Many of these fields involve people's health, livelihoods, money, or rights.

Skills published in this repository are **drafting and ideation aids**. The
licensed professional (clinician, attorney, accountant, advisor, teacher) is
always the one accountable for the output. We hold this line for two reasons:

1. **Liability** — agent output is not a substitute for credentialed judgment, and the world is worse if we let it be.
2. **Quality** — agents drift, hallucinate, and inherit biases. The professional's review is what catches them.

If a skill PR positions itself as a replacement for human professional judgment,
we won't merge it. If it positions itself as a workflow tool that the
professional uses while remaining accountable, we welcome it.

---

**Welcome.** The most valuable contributions to OnBuzz Community over the next
year will probably come from people whose first PR isn't code at all.

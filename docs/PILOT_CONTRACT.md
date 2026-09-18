# Tongue bounded test contract — 2026-09-18

## Verdict

Do not fund a broad language-app expansion yet. Keep the existing app, repair its useful core, and run a small outcome test. Code establishes implementation; it does not establish demand or learning. No customer/payments dataset was provided. “No evidence available” is not “no customers exist.”

| Direction | Case for it | Strongest objection | Decision |
|---|---|---|---|
| Broad 12-language tutor | Existing implementation and content | Generic coaching/review are already available; quality and acquisition unproven | Maintain, no breadth investment |
| Focused French travel reading/retrieval program | Existing food/travel material; concrete unfamiliar-task evaluation; little provider cost | Episodic need, low willingness to pay, free substitutes | Bounded test candidate |
| Teacher-assigned practice/evidence tool | A teacher could select material and assess transfer | Different buyer, sales cycle, privacy and workflow needs; no buyer evidence | Interview hypothesis only; do not build |
| Park new development | Avoids further cost without demand | Could discard a useful narrow outcome | Park expansion if test fails; keep existing services intact |

Learning thesis: for adult English-speaking French beginners, short reference study plus active recall and spaced return practice improves unassisted meaning retrieval and comprehension on unfamiliar food/travel notices relative to equal-time rereading. This does not predict speaking fluency or pronunciation.

Business thesis: learners with an upcoming trip will accept a small paid follow-on program after observing a useful result; a repeatable travel-learning distribution channel can recruit them cheaply enough. Neither part is validated.

Three invalidating assumptions: (1) improvement transfers beyond the cards; (2) learners return without intensive founder coaching; (3) enough pay to cover acquisition and support. Most likely one-year failure: a pleasant free reference tool with weak paid differentiation and expensive tutor usage.

## Competitive evidence, checked 2026-09-18

- [Duolingo conversation practice](https://blog.duolingo.com/video-call/) describes simulated conversational practice. Established course/habit experience; switching requires a concrete benefit. Subscription packaging varies; not independently price-verified here.
- [Speak custom lessons](https://help.speak.com/en/articles/11565779-what-are-made-for-you-custom-lessons) already target goals and mistakes. Personalization alone is not a differentiator; current checkout price not verified.
- [Anki](https://docs.ankiweb.net/background.html) implements active recall and spacing. Low software cost, but deck selection/setup remains learner work. A Tongue advantage would have to be measurable convenience or transfer, not ownership of the mechanism.
- [Preply French conversation tutors](https://preply.com/en/online/tutors-conversational-french) offers human instruction with tutor-specific rates (page reports an average of $24/hour). Human judgment/accountability versus scheduling and recurring cost; listings are not an effectiveness study.
- [ChatGPT plans](https://chatgpt.com/pricing/) include free access with limited voice. Learners already using general assistants face little incremental switching cost; Tongue must add a reliable learning sequence and outcome evidence.
- [Babbel's notice](https://support.babbel.com/hc/en-gb/articles/360055107431-How-do-I-cancel-a-Babbel-Live-class) says private-learner Live classes ended after June 2025. Do not describe that discontinued service as a current option.

Books, self-study courses and immersion also compete: low recurring software cost or real-world interaction, but require independent sequencing, feedback or access to speakers. Their comparative effort/outcomes have not been measured for the proposed audience. These sources establish available alternatives, not Tongue superiority.

## Finite experiment

**Status: prepared, not recruited or run.** No external contact or spending authorized/performed.

- Participants: 12 adults, English-speaking French beginners, planning travel within six months; exclude those scoring over 8/12 on the initial food-word test. US adult pilot only as a scope choice, not a legal-compliance claim. Obtain voluntary consent; no children or sensitive speech recordings.
- Material: the unchanged 12 words in `seed/content/fr/vocab.json`, Food & Drink category. Prototype: Learn → Food & Drink → Add all to Flashcards → Review. Existing free reference content remains free; any paid offer is for a disclosed guided program and human evaluation, not access to those cards.
- Comparison: randomize 6 to Tongue recall/review and 6 to the same printed word list, equal 8-minute sessions on days 0, 2 and 5. Track actual time and outside study. Day 12 delayed test has no hints/cards/dictionary. Assessor blinded to assignment.
- Measures: baseline and day-12 unaided meaning recall of 12 shuffled words; six unfamiliar short notices from the task sheet; completion of independently initiated return sessions; support minutes. Accept valid equivalent meanings. Native/proficient French reviewer must validate the task sheet and rubric before recruitment.
- Learning pass: at least 5/6 intervention participants finish; intervention median delayed recall gain at least 3/12 and at least 2 points above control median gain; median transfer at least 4/6. Fail if adequate completion but either learning threshold is missed. Fewer than 5 per arm finishing, review defects or protocol deviations → inconclusive, never “passed.” These are investment gates chosen in advance, not statistical proof.
- Business offer after testing: “Four weeks of guided French travel-reading practice and two human progress checks, $19 once; no automatic renewal and no fluency guarantee.” Draft only. Offer to all 12; control participants receive the same finished program if they purchase. Payment handling and delivery must be ready before collecting money. At least 4 actual paid purchases and 3/4 buyers completing a second-week unaided task justify a second cohort, not a market claim. Verbal enthusiasm/signups are not payment. If payment infrastructure cannot be validated, record commitments separately and call the commercial result inconclusive.
- Cap: 14 days for learning test; follow-on return check extends observation to 28 days. Maximum 20 operator hours and proposed $300 human-review/support budget; spending still needs authorization. No paid acquisition in cohort one.
- Stop: no recruitment after 20 qualified, permission-based invitations or within 14 days → park acquisition hypothesis. Failed learning → revise mechanism once, not add features. Failed paid conversion/return → park subscription expansion. Passing → one preregistered replication with a larger independent cohort and a realistic Anki/human-teaching alternative.

First channel hypothesis: founder's existing travel/language contacts or permission-based community recruitment, with full denominators and operator time recorded. It may not repeat; cohort two must come through a separate channel. No assumed partnerships, virality or cheap ads.

## Draft offer and operating instructions

“Practise recognizing useful French food words, then test yourself on new menu snippets. This small research pilot compares two study methods. It does not promise fluency. You can stop at any time. Your participation and results will not be published as a testimonial without separate permission.”

Support script: save work in one private browser profile; do not use shared accounts; report missing content; do not send passwords, payment details or sensitive documents. Keep participant contact/consent records outside the public repo. Use random participant IDs; the blank measurement template contains no results. Proposed pilot retention: delete identifiable research notes after 30 days unless separately consented; legal/privacy review and an operational deletion process are prerequisites, not completed work.

## Economics: assumptions, not forecasts

Current server uses Sonnet 4.5. [Listed rates](https://claude.com/pricing) on the check date: $3/M input and $15/M output tokens. At an assumed 2,000 input + 400 output tokens, a message costs $0.012. 150/month costs $1.80; 1,500 costs $18; the 300/day allowance at 30 days costs $108 even at that small assumed message size. At 6,000 input + 2,000 output the same maximum is $432. No observed token mix was available; context growth/retries can increase cost. Existing $9 pricing cannot support heavy usage on these assumptions.

Illustrative monthly economics at $9 per paying learner:

| Assumption | Conservative | Base | Strong |
|---|---:|---:|---:|
| Payers | 100 | 1,000 | 10,000 |
| AI messages/payer | 300 | 150 | 80 |
| AI cost/payer | $3.60 | $1.80 | $0.96 |
| Hosting/storage/payer | $0.60 | $0.30 | $0.20 |
| Content review/payer | $1.00 | $0.50 | $0.30 |
| Support/payer | $3.00 | $1.00 | $0.50 |
| Refund allowance/payer | $0.45 | $0.18 | $0.09 |
| Assumed payment fee/payer | $0.57 | $0.57 | $0.57 |
| Contribution/payer before acquisition/fixed costs | -$0.22 | $4.65 | $6.38 |
| Monthly churn / CAC | 20% / $50 | 8% / $25 | 4% / $15 |

Fee is an assumed 3% + $0.30, not a provider quote. At base assumptions, simplistic contribution lifetime is $4.65 / 0.08 ≈ $58 before fixed costs; $25 CAC leaves little room for errors. Browser speech has no metered server audio cost in this model; hosted speech would require a separate measured minutes-based allowance. Content review, speech evaluation, accessibility, legal work and support cannot be priced as zero. The proposed $19 human-assisted program also needs a time log before being called profitable.

Expansion only after evidence: adjacent travel tasks can reuse delivery/review; new languages need human content/evaluation work; employer workflows require a new sales and outcome hypothesis. No demonstrated network effect or proprietary moat. General AI can reproduce drills; lawful outcome evidence, trusted distribution and reliable operations may become advantages but do not exist merely because history is stored.

At $108 annual revenue per learner, $100M revenue requires about 926,000 average paying learners. That arithmetic is not a valuation or an attainable forecast. There is no evidence here supporting a $1B enterprise value; revenue, profit, funding and founder proceeds are different quantities. Model changes require measured quality/cost checks and spending limits before rollout. Do not add infrastructure to imply scale.

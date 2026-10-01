# Build plan

Built with Devin cloud sessions in 2 hours. Each session is small, names the files and the pattern to copy, and ends with `npm run check`. Sessions that don't depend on each other run in parallel.

## Setup (before the clock)
1. Push this kit to the repo.
2. GitHub > Settings > Applications > Devin.ai > Configure: give it access to the repo.
3. Devin > Settings > Environment > Blueprints: find the repo, Sync, Build snapshot. Wait for "Success".
4. Devin settings: "Open PRs as" = Devin. Devin Review trigger = "On PR creation". Turn on "Pre-approve testing". Data Controls: opt out of training.
5. Open a GitHub issue "Disputes queue" with the S5 request below. Note its number.
6. Smoke test in Ask mode: "Read AGENTS.md and docs/SPEC.md. In 5 bullets, what would you build first? Don't write code."

## Sessions
```
0:00  S1 Platform ──────────► merge ~0:45
0:45     S2 Refunds ────────► merge ~1:20
0:45     S3 Pages, guardrails, README ► merge ~1:20
1:20        S4 KYC ─────────► merge ~1:55
1:20        S5 Disputes ────► merge ~1:55
```
If S1 runs past 0:55, drop S5.

**Running one:** app.devin.ai > new session > this repo > Agent mode > paste the prompt. Merge with "Squash and merge" once CI and Devin Review are done. Ask for changes in a PR comment. Merge S4 before S5, then tell S5 to rebase onto main. Restart any session that passes ~45 minutes or starts looping.

## Log
| Session | Start | PR | Merged | Usage | Notes |
|---|---|---|---|---|---|
| S1 | | | | | |
| S2 | | | | | |
| S3 | | | | | |
| S4 | | | | | |
| S5 | | | | | |

## Prompts

**S1 Platform**
```
Build the Platform section of docs/SPEC.md, except the /approvals and /audit pages. Include /login
and the header. Follow the setup notes. Add tests: audit rows can't be updated or deleted; a requester
can't decide their own approval (in code and via the DB constraint); defineAction refuses a user
without the permission and audits the denial; invalid input is rejected.
Done when npm run check passes. Open a PR.
```

**S2 Refunds**
```
Build the Refunds tool in docs/SPEC.md. Every other tool will copy it, so keep it simple.
Done when npm run check passes. Then run the app and record this: Ana requests a $250 refund and
can't approve it, Rio can't approve his own $300 request, Ben approves Ana's and it executes.
Open a PR.
```

**S3 Pages, guardrails, README**
```
Build the /approvals and /audit pages and tests/guardrails.test.ts from docs/SPEC.md. Then write
README.md per the README section of the spec. Don't touch src/tools/.
Done when npm run check passes. Open a PR.
```

**S4 KYC**
```
@skills:new-tool KYC review queue, as described in docs/SPEC.md.
```

**S5 Disputes** (the ops request, same text as the GitHub issue)
```
@skills:new-tool Disputes queue. Card networks send us chargebacks. A disputes analyst reviews
each one, adds evidence notes, and either submits a response or accepts the loss. Fields: charge
id, customer, amount, reason (fraud, not_received, duplicate, other), response deadline, status
(needs_response, submitted, accepted, won, lost). Accepting a loss over $500 needs a finance
approver. Show days left until the deadline and sort by it.

Put "Closes #ISSUE_NUMBER" in the PR description.
```

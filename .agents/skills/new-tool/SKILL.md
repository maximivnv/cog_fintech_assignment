---
name: new-tool
description: Build a new internal tool on the platform from a short request. Use for new review queues, admin panels, ops dashboards or approval workflows.
argument-hint: "<what the tool should do>"
triggers: ["user"]
---

Build this tool: $ARGUMENTS

1. **Spec first.** Before writing code, post a short spec: the record and its fields (mark PII), statuses and transitions, permissions and which roles get them (reuse existing roles), which actions need a second approver and above what threshold, and your assumptions. Only ask a question if a threshold or approver is unclear and it changes the design.
2. **Copy refunds.** Mirror `src/tools/refunds/` and `src/app/tools/refunds/` file for file. Register the tool in `src/tools/index.ts` and add fake seed data.
3. **Test.** In `src/tools/<slug>/<slug>.test.ts`, cover every status change including illegal ones, that a requester can't approve their own request even with both roles, and that PII is masked and reveal is audited (if the tool has PII).
4. **Check and ship.** `npm run check` until green. Run the app, walk the main flow as the seeded users, record it, and open the PR.

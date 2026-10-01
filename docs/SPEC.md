# Spec

## Why
The company runs 3 internal apps on Power Apps and plans 10+ more. Most share one shape: a queue, a review, a decision, sometimes a second approver, and an audit trail. The platform makes that shape cheap, so each new tool is a small folder Devin can build from a short request.

Rules for all code are in `AGENTS.md`.

## Platform (`src/platform/`)

**Database.** `node:sqlite`. File at `data/app.db` (`DB_PATH` overrides it; tests use `:memory:`). On first open: run platform migrations, then each tool's, then seed if empty. `tx(fn)` wraps a transaction.

**Login.** Mock SSO. `/login` lists the seeded users; picking one sets a `uid` cookie. `getCurrentUser()` reads it. Label the page "Mock login. Production uses the company's SSO."

| id | name | roles |
|---|---|---|
| u_ana | Ana | support_agent |
| u_ben | Ben | finance_approver |
| u_rio | Rio | support_agent, finance_approver |
| u_cara | Cara | kyc_analyst |
| u_dev | Dev | kyc_analyst, kyc_lead |
| u_eve | Eve | auditor |

Rio and Dev hold both roles on purpose. They show that separation of duties is per request, not per role.

**Permissions.** Each tool's manifest maps permissions to roles. `can(user, permission)`.

**Audit log.** `audit_log(id, ts, actor_id, tool, action, entity_id, detail_json, outcome)`, where outcome is `ok`, `denied` or `failed`. SQLite triggers abort any UPDATE or DELETE on it.

**Actions.**
```ts
defineAction({ tool, name, permission, input, handler }) // input is a zod schema
// returns (user, rawInput) => Promise<result>
```
Checks the permission, validates input, runs the handler in a transaction, and writes the audit row itself. Denied and failed calls are audited too, outside the rolled-back transaction. `ctx.audit({ entityId, before, after })` adds detail. Every action goes into `actionRegistry` so tests can find it.

**Approvals.** `approvals(id, tool, kind, entity_id, summary, permission, requested_by, status, decided_by, reason)` with `CHECK (decided_by <> requested_by)`.
- `ctx.requestApproval({ kind, entityId, summary })` creates a pending approval.
- `decideApproval(user, id, "approve" | "reject", reason)` checks the approval is pending, the user has its permission, and the user isn't the requester. Then it runs the tool's `onApprove` or `onReject` in the same transaction. Audited.
- Each tool exports its approval kinds from `actions.ts`: `{ refund: { permission, onApprove, onReject } }`.

**Payments (mock).** A seeded `charges` table. `refund(chargeId, amountCents)` records a refund and returns an id. Stands in for the processor API.

**UI.** Tailwind, system fonts, no component library. A few shared pieces: table, status badge, money, masked value, reason form. Header: tool nav from the registry (filtered by permission), current user, switch user.

**Platform pages.**
- `/approvals`: approvals I can decide (never my own), and my requests.
- `/audit`: the audit log, filterable by tool. Auditor only.

## Tools
A tool is `src/tools/<slug>/` with `manifest.ts` (slug, name, permissions → roles, thresholds), `migrations.ts`, `queries.ts`, `actions.ts` and `<slug>.test.ts`, plus pages in `src/app/tools/<slug>/`. Register it in `src/tools/index.ts`.

### Refunds (the reference tool)
- Permissions: `refunds:view` (support_agent, finance_approver, auditor), `refunds:request` (support_agent), `refunds:approve` (finance_approver).
- Request: pick a charge, enter an amount and reason. Can't exceed what's left on the charge, counting pending requests.
- Up to $100 executes immediately. $100.01 to $5,000 needs approval. Over $5,000 is refused ("escalate to finance").
- Status: `pending_approval → executed | rejected`.
- Pages: list with a status filter, new request, detail with approve/reject and the refund's audit trail.
- Tests: tier routing, over-refund refused, requester can't approve their own request (including Rio).
- Seed: a few pending, one executed, one rejected.

### KYC review queue (built with the skill)
- Permissions: `kyc:view` (kyc_analyst, kyc_lead, auditor), `kyc:decide` (kyc_analyst, kyc_lead), `kyc:approve_high_risk` (kyc_lead), `kyc:reveal_pii` (kyc_analyst, kyc_lead).
- Case: applicant name, date of birth, country, document number, risk score (0-100), watchlist hit, status, assignee. Seed about 12, mixed risk.
- An analyst claims a case, then approves or rejects it with a reason. Only the assignee decides.
- High risk (score ≥ 70 or a watchlist hit): approval needs a kyc_lead, who can't be the analyst who recommended it.
- Date of birth and document number are masked. Revealing them needs `kyc:reveal_pii` and a reason.
- Queue sorted by risk, highest first.

### Not building
- Feature-flag admin. Buy it: Unleash and similar products ship approvals and audit for flags.
- Real SSO, Postgres, hosting, notifications.

## Guardrail tests (`tests/guardrails.test.ts`)
They find tools and actions through the registries, so they also cover tools that don't exist yet.
- Every action refuses a user with no roles and writes a `denied` audit row.
- UPDATE and DELETE on `audit_log` throw.
- No file in `src/tools/` imports another tool or `node:sqlite`.

## Setup notes
- `create-next-app` won't run in a non-empty folder. Scaffold into `/tmp/app` with `npx create-next-app@latest /tmp/app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`, then copy it in, skipping `.git` and `README.md`.
- Remove `next/font/google` from the layout.
- Add `@types/node@22` (for `node:sqlite` types), `zod` and `vitest`. Map `@` to `./src` in `vitest.config.ts`.
- Scripts: `dev`, `build`, `typecheck` (`tsc --noEmit`), `lint`, `test` (`vitest run`), `check` (typecheck + lint + test), `reset` (`rm -f data/app.db`).
- Next 16: `cookies()` and page `params` are async.
- Gitignore `data/`.
- `node:sqlite` prints an ExperimentalWarning. Ignore it.

## README
What it is, how to run it, a 2-minute click-through with the seeded users, a small architecture diagram, how to add a tool, and what's mocked or out of scope.

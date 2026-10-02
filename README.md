# Internal Tool Factory

A small platform for building internal admin tools for a fintech ops team. Every tool gets the same shape for free: a queue, a review, a decision, an optional second approver, and an append-only audit trail. A new tool is one folder under `src/tools/` plus its pages; the platform handles login, permissions, approvals and audit.

The product spec is in [`docs/SPEC.md`](docs/SPEC.md); the rules every PR must follow are in [`AGENTS.md`](AGENTS.md).

## Run it

Requires Node 22 (for `node:sqlite`).

```sh
npm install
npm run dev        # http://localhost:3000, pick a user at /login
npm run check      # typecheck + lint + tests; must pass before every PR
npm run reset      # delete data/app.db; it re-seeds on the next start
```

The database is a SQLite file at `data/app.db` (override with `DB_PATH`; tests use `:memory:`). On first open it runs the platform migrations, then each tool's, then seeds. `node:sqlite` prints an `ExperimentalWarning`; ignore it.

## Two-minute click-through

Login is a mock SSO: `/login` lists the seeded users and sets a `uid` cookie. Production would use the company's SSO.

| User | Roles | Try this |
|---|---|---|
| Ana | support_agent | Request a refund. Under $100 executes immediately; $100.01 to $5,000 goes to approval. |
| Ben | finance_approver | Open **Approvals**. Ana's request is in *To decide*. Approve or reject it with a reason. |
| Rio | support_agent, finance_approver | Request a refund that needs approval, then open **Approvals**: your own request is only under *My requests*. Separation of duties is per request, not per role. |
| Cara | kyc_analyst | Claim a KYC case and decide it. High-risk cases need a lead. |
| Dev | kyc_analyst, kyc_lead | Approve a high-risk case Cara recommended. Try to approve one you recommended yourself: refused. |
| Eve | auditor | Open **Audit log**. Filter by tool. Every action, denial and failure is there, including the refused self-approvals. |

Steps:

1. Log in as **Ana**, open Refunds, request a $250 refund with a reason. Status: `pending_approval`.
2. Switch user to **Ben** (header, *Switch user*), open **Approvals**, approve it with a reason. The refund executes.
3. Switch to **Rio**, request another refund over $100, then open **Approvals**. It is in *My requests*, not *To decide*.
4. Switch to **Eve**, open **Audit log**, filter by Refunds. Expand a row's detail to see the input and before/after state.

Tools that are not merged yet simply don't appear in the header; the platform pages work regardless.

## Architecture

```
  Browser
    │  server components + server actions
    ▼
  src/app/                       pages only. Read via platform queries, write via actions.
    ├─ login/        approvals/  audit/
    └─ tools/<slug>/             one folder of pages per tool
    │
    ▼
  src/platform/                  the shared core
    ├─ auth        mock SSO: uid cookie → User {id, name, roles}
    ├─ registry    tool manifests, permissions → roles, can(user, permission)
    ├─ actions     defineAction(): permission check → zod validate → tx → audit row
    ├─ approvals   requestApproval(), decideApproval(): pending → approved | rejected
    ├─ audit       append-only audit_log (UPDATE/DELETE blocked by triggers)
    ├─ payments    mock processor: charges table, refund()
    ├─ db          node:sqlite, migrations, seed, tx()
    └─ ui          table, status badge, money, masked value, reason form, header
    │
    ▼
  src/tools/<slug>/              manifest, migrations, queries, actions, tests
    ↑ imports only from @/platform; never another tool, never node:sqlite
```

How a write flows:

```
page form ─► server action ─► defineAction handler ─► tx ─► audit row (ok)
                                   │ no permission ─► audit row (denied), throw
                                   │ bad input      ─► audit row (failed), throw
                                   └ handler throws ─► rollback, audit row (failed), throw

handler calls ctx.requestApproval() ─► approvals row (pending)
approver on /approvals ─► decideApproval ─► tool's onApprove/onReject in the same tx ─► audit row
                             │ requester == decider ─► refused (code and CHECK constraint)
```

Platform pages:

- `/approvals`: pending approvals you hold the permission for and did not request, plus your own requests and their outcomes.
- `/audit`: the audit log, newest first, filterable by tool. Auditor role only.

## Adding a tool

Use the `new-tool` skill (`.agents/skills/new-tool/SKILL.md`) or copy `src/tools/refunds/` by hand. A tool is:

```
src/tools/<slug>/
  manifest.ts     slug, name, permissions → roles, thresholds (integer cents)
  migrations.ts   CREATE TABLE statements, run once after the platform's
  queries.ts      read-only helpers for pages
  actions.ts      defineAction(...) calls and the approval kinds { kind: { permission, onApprove, onReject } }
  <slug>.test.ts  status transitions, illegal transitions, self-approval refused, PII masked
src/app/tools/<slug>/   list, new, detail pages
```

Then register it in `src/tools/index.ts` and add fake seed data. A tool PR touches only those folders; a platform change goes in its own PR.

The guardrail tests in `tests/guardrails.test.ts` pick up new tools automatically through the registries: every action must refuse a user with no roles and audit the denial, every action's permission must appear in a manifest, every tool folder must be registered, and no file under `src/tools/` or `src/app/tools/` may import another tool or `node:sqlite`.

Rules (from `AGENTS.md`): writes only inside `defineAction` or approval handlers; permissions checked on the server; money movement and compliance decisions above a threshold go through `requestApproval`, and the requester can't decide; audit rows are never updated or deleted; PII is masked by default and revealing it is an audited action; money is integer cents.

## Mocked or out of scope

- **Login** is a mock SSO (pick a user, get a cookie). No passwords, no sessions table.
- **Payments** are a mock: a seeded `charges` table and `refund()` that records rows. No real processor.
- **Database** is a local SQLite file. No Postgres, no hosting, no backups.
- **No notifications**: approvers find work on `/approvals`.
- **Not building a feature-flag admin**: products like Unleash already ship approvals and audit for flags.
- Seed data is fake.

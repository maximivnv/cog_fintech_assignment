# Internal Tool Factory

A small platform for building internal admin tools for a fintech ops team. Every tool gets the same shape for free: a queue, a review, a decision, an optional second approver, and an append-only audit trail. A new tool is one folder under `src/tools/` plus its pages; the platform handles login, permissions, approvals and audit.

The product spec is in [`docs/SPEC.md`](docs/SPEC.md); the rules every PR must follow are in [`AGENTS.md`](AGENTS.md).

## Run it

Requires Node 22 (for `node:sqlite`).

```sh
npm install
npm run reset      # optional: delete data/app.db for a fresh seed
npm run dev        # http://localhost:3000 redirects to /login; pick a user
npm run check      # typecheck + lint + tests; must pass before every PR
```

The database is a SQLite file at `data/app.db` (override with `DB_PATH`; tests use `:memory:`). Audit queries return at most 200 rows by default; override with `AUDIT_LIMIT`, given as plain digits (e.g. `500`). Anything else, such as `0`, `1.5`, `1e3` or `50abc`, falls back to 200. On first open it runs the platform migrations, then each tool's, then seeds. `node:sqlite` prints an `ExperimentalWarning`; ignore it.

A fresh database has seeded refunds, KYC cases, disputes and pending approvals, but an empty audit log: audit rows are written by actions, so the log fills up as you click through.

## Five-minute click-through

Login is a mock SSO: `/login` lists the seeded users and sets a `uid` cookie. Production would use the company's SSO. Switch users with *Switch user* in the header.

| User | Roles | Try this |
|---|---|---|
| Ana | support_agent | Request a refund. Up to $100 executes immediately; $100.01 to $5,000 goes to approval; over $5,000 is refused. Work a dispute: add evidence notes, submit the response, or accept the loss (over $500 needs finance). |
| Ben | finance_approver | Open **Approvals**. Ana's refund and loss acceptance are in *To decide*. Approve or reject with a reason. |
| Rio | support_agent, finance_approver | Request a refund that needs approval, then open **Approvals**: your own request is only under *My requests*. Separation of duties is per request, not per role. |
| Cara | kyc_analyst | Claim a KYC case and decide it. Approving a high-risk case (score ≥ 70 or a watchlist hit) only records a recommendation and asks a lead. |
| Dev | kyc_analyst, kyc_lead | Sign off Cara's recommendation. Recommend one yourself, then try to sign it off: refused. |
| Lee | kyc_lead | Sign off the high-risk case Dev recommended, which Dev cannot do himself. |
| Eve | auditor | Open **Audit log**. Filter by Refunds, KYC review or Disputes. Every action, denial and failure is there, including the refused self-approvals. |

Steps:

1. Log in as **Ana**, open **Refunds**, *New request*: pick a charge, enter $250 and a reason. Status: `pending approval`.
2. Switch to **Ben**, open **Approvals**, approve it with a reason. The refund executes; open it under Refunds to see the processor refund id and the audit trail.
3. Switch to **Rio**, request another refund over $100, then open **Approvals**. It is in *My requests*, not *To decide*.
4. Switch to **Ana**, open **Disputes**, open `dp_seed_1` ($7,500): *Add note*, then *Accept loss (needs finance)* with a reason. The dispute stays `needs response` with a *pending finance* badge until Ben decides it on **Approvals**.
5. Switch to **Cara**, open **KYC review**, claim `kyc_seed_08` (score 92, watchlist hit) and approve it with a reason. Status: `pending lead review`.
6. Switch to **Dev**, open **Approvals**, sign off Cara's case. Then claim `kyc_seed_06` (score 83) and approve it: it goes to `pending lead review`, and Dev's own **Approvals** page does not list it under *To decide*.
7. Switch to **Lee**, open **Approvals**, sign off Dev's case.
8. Switch to **Eve**, open **Audit log**, filter by each tool. Expand a row's *view* to see the input and before/after state.

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

## Known limitations

- **Mock login.** `/login` picks a seeded user and sets a `uid` cookie. No passwords, no sessions, no SSO.
- **SQLite file.** One local `data/app.db`, single process. No Postgres, no hosting, no backups.
- **Mocked payments.** `charges` and `payment_refunds` are seeded tables; `refund()` records a row. No real processor.
- **Audit query cap.** `/audit` shows the latest `AUDIT_LIMIT` rows (default 200) for the chosen filter; there is no paging or date range, so older rows are only reachable through the database.
- **Seeds are not retried after a crash.** Migrations and seeds run on first open; a migration is marked applied before its seed runs, so a crash during seeding leaves empty tables that are not re-seeded on the next start. Run `npm run reset` and start again.

## Out of scope

- **No notifications**: approvers find work on `/approvals`.
- **Not building a feature-flag admin**: products like Unleash already ship approvals and audit for flags.
- Seed data is fake.

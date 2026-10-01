# Internal Tool Factory

Internal tools for a fintech ops team. A shared platform in `src/platform/` handles login, permissions, approvals and audit. Each tool is a folder in `src/tools/`. What to build is in `docs/SPEC.md`.

## Stack
Next.js (App Router), TypeScript strict, Tailwind, zod, `node:sqlite`, Vitest. Don't add dependencies without saying why in the PR.

## Commands
- `npm run dev`: app at http://localhost:3000. Pick a user at /login.
- `npm run check`: typecheck, lint, tests. Must pass before every PR.
- `npm run reset`: delete the local DB. It re-seeds on next start.

## Rules
Tests enforce these. Reviewers treat a violation as a blocking bug.
1. Writes happen only inside `defineAction` handlers or approval handlers. Pages and components never touch the DB.
2. Permissions are checked on the server. Hiding a button is not access control.
3. Money movement and compliance decisions above a threshold go through `requestApproval`. Whoever requested an approval can't decide it.
4. Never update or delete audit rows.
5. PII (date of birth, document numbers) is masked by default. Revealing it is an action, so it's permission-checked and audited.
6. A tool imports only from `@/platform`. Never from another tool, never `node:sqlite`.
7. Money is integer cents. Seed data is fake.

## Adding a tool
Use the `new-tool` skill. Copy `src/tools/refunds/`.
A tool PR only touches its own folders, `src/tools/index.ts` and seed data. If it needs a platform change, say so in the PR description instead of making it.

## Pull requests
- `npm run check` passes.
- Fill in the PR template.
- For UI changes, run the app, walk the main flow as the seeded users, and attach a recording.

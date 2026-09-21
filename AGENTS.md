# WPStudBook

> Canonical project rules. `AGENTS_cht.md` is the Traditional Chinese reference version.
> If the two versions conflict, follow this file and report the inconsistency.
> Update both files in the same change.

## CodeLab Governance Bootstrap

CodeLab-Governance: optional

This project supports CodeLab-managed and standalone operation.

When `../../AGENTS.md` contains the exact standalone line `CodeLab-Workspace-Root: v1` and the required anchors are available, use CodeLab-managed mode. Before project work, read `../../AGENTS.md` and `../../governance_eng.md`. Claude Code / Cowork also reads `../../CLAUDE.md`. Read `../../governance_cht.md` only for a Chinese request, bilingual maintenance, or an inconsistency check.

Otherwise, do not search elsewhere for substitutes. Use standalone mode and project-local rules. Without user authorization, do not read or write outside the project directory. Report the mode and reason in interactive work and non-interactive output.

Change the marker to `CodeLab-Governance: required` when failed managed-mode verification must block project work.

## Repository

- Remote: `https://github.com/AxeenWang/WPStudBook.git`
- Default branch: `main`

## Project Rules

Requirements: `docs/specs/需求規格.md`. Technical design and rationale: `docs/specs/技術設計.md`.

### Stack

- Deliverable: one HTML file, `app/dist/WPStudBook.html`, used offline via `file://` in the latest Edge and Chrome on Windows. No CDN, network, local server, or extension at runtime.
- TypeScript (strict), Vue 3 with `<script setup>`, Pinia, Vue Router with hash history, Reka UI, TanStack Virtual.
- Vite with `vite-plugin-singlefile`. IndexedDB through Dexie.
- Tests: Vitest, `fake-indexeddb`, Vue Test Utils, Playwright (Edge and Chromium).
- Node 24 and npm. Commit `package-lock.json`.
- Keep TypeScript on 6.x: TypeScript 7 breaks `vue-tsc` 3 builds. Upgrade only after `vue-tsc` supports TypeScript 7.
- Use built-in browser APIs for CP932 decoding, gzip, and SHA-256. Add a dependency only when the technical design allows it.

### Repository Layout

```
docs/specs/        requirements, technical design, reference pages
docs/plans/        implementation plans
app/               npm project root
  src/core/        domain model and rules (pure functions)
  src/ce-import/   CE export decoding, parsing, and import flow
  src/storage/     Dexie database, backups, checkpoints
  src/ui/          Vue components, pages, Pinia stores
  tests/acceptance/  acceptance tests grouped by requirement scenario prefix
  tests/e2e/       Playwright tests against the built file
  tests/fixtures/  synthetic CE sample files
  tests/local/     tests that read .references/ and skip when it is absent
```

### Module Boundaries

- `src/core/` must not import Vue, Dexie, DOM APIs, or any other `src` module.
- `src/ce-import/` and `src/storage/` may import only `src/core/` among project modules.
- No module may import `src/ui/`.
- Enforce these rules with ESLint `no-restricted-imports`.

### Commands

Run from `app/`:

- `npm ci`: install from the lockfile.
- `npm run dev`: development server, for development only.
- `npm run build`: type-check and build `dist/WPStudBook.html`.
- `npm test`: unit and acceptance tests.
- `npm run test:e2e`: build, then run Playwright.
- `npm run lint`: ESLint and Prettier checks.
- `npm run typecheck`: `vue-tsc`.

### Conventions

- Put unit tests next to the source file as `*.test.ts`.
- Name each acceptance test starting with its scenario code from requirements chapter 15, for example `LINE-14`.
- Never commit real CE exports or user spreadsheets. Keep them in `.references/` and use synthetic fixtures in tests.
- Do not commit build or test output: `app/dist/`, `app/node_modules/`, Playwright reports.
- UI text is Traditional Chinese. Keep game field names, system names, and horse names in Japanese.
- When a rule changes, update `docs/specs/需求規格.md` in the same change. If pairing or pedigree rules change, also update `docs/specs/八系巡迴圖.html`.

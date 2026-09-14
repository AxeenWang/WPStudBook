# WPStudBook

> Canonical project rules. `AGENTS_cht.md` is the Traditional Chinese reference version and is not an instruction entry point. If the two conflict, follow this file and report the inconsistency. Read `AGENTS_cht.md` only for bilingual maintenance or an inconsistency check, and update both files in the same change.

## CodeLab Governance Bootstrap

CodeLab-Governance: optional

This project supports CodeLab-managed and standalone operation.

When `../../AGENTS.md` contains the exact standalone line `CodeLab-Workspace-Root: v1` and the required anchors are available, use CodeLab-managed mode. Before project work, read `../../AGENTS.md` and `../../governance_eng.md`. Claude Code / Cowork also reads `../../CLAUDE.md`. Read `../../governance_cht.md` only for a Chinese request, bilingual maintenance, or an inconsistency check.

Otherwise, do not search elsewhere for substitutes. Use standalone mode and project-local rules. Without user authorization, do not read or write outside the project directory. Report the mode and reason in interactive work and non-interactive output.

Change the marker to `CodeLab-Governance: required` when failed managed-mode verification must block project work.

## Project

- Repository: https://github.com/AxeenWang/WPStudBook
- Default branch: `main`
- Agent temp areas `.codex-tmp/` and `.claude-tmp/` are ignored by Git and must never be committed.

## Repository Layout

- The repository root holds only the project rules (`AGENTS.md`, `AGENTS_cht.md`, `CLAUDE.md`), `.gitignore`, `.github/` (GitHub requires it at the root), `docs/`, `.references/`, and the agent temp areas.
- All application code, tool configuration, dependencies, and build or test outputs live under `app/`. This includes `package.json`, the lockfile, tool configuration files, `src/`, `tests/`, `scripts/`, `node_modules/`, `dist/`, `test-results/`, and `playwright-report/`.
- Run npm, build, lint, and test commands from `app/`. Never run `npm install` or create tool configuration at the repository root.
- Do not add a new top-level file or directory without explicit user approval.
- Do not give a directory a name that repeats the meaning of its parent, such as `source/src` or `app/src/app`. Directory details and module layers are in `docs/設計決策.md` section 4.

## Reference Materials (`.references/`)

- `.references/` holds reference material that the user adds manually, such as game export samples, spreadsheets, and screenshots, for agents to consult.
- Its contents change without notice. The user may add or delete files at any time, so check that a file still exists before relying on it and do not treat earlier reads as current.
- Agents treat it as read-only. Do not add, edit, rename, or reorganize files there. Delete files only when the user explicitly asks.
- It is not a temp area. Put agent scratch content in the agent's own temp area.
- It is ignored by Git and must never be staged or committed. The repository is public, so do not copy raw contents into tracked files such as docs, tests, fixtures, or source without explicit user approval. Describing formats or findings in tracked docs is allowed.

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

Project-specific rules (stack, repository layout, commands, conventions) are not defined yet. Decide the repository layout explicitly at design time and record it here before adding application code.

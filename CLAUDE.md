@AGENTS.md

> `CLAUDE_cht.md` is the Traditional Chinese reference version of this file and is not an
> instruction entry point. If the two conflict, follow this file and report the inconsistency.
> Read `CLAUDE_cht.md` only for bilingual maintenance or an inconsistency check, and update both
> files in the same change.

## Claude Code

- `AGENTS.md` is the canonical rule source. This file contains only Claude Code-specific supplements. If anything conflicts, follow `AGENTS.md` and report it.
- Claude Code / Cowork uses `.claude-tmp/YYYY-MM-DD_<task-name>/` for temporary content. Never touch `.codex-tmp/`.

## Working Process

These are the user's standing instructions for how agent work runs on this project. They apply to
every session unless the user changes them in that session. They replace the heavier per-task
brief / implementer / reviewer loop used up to sub-plan 2-2, which cost far more than it returned.

They live here because they describe how Claude Code works, not what the product is. Move them to
`AGENTS.md` (and `AGENTS_cht.md` in the same change) if Codex / Work should follow the same process.

### Scope

- The product scope does not shrink. The requirements spec, every remaining stage, and all 211
  acceptance scenarios must be completed. An MVP is not a finishing line.
- A scenario that can only be confirmed against a real game export is marked `待真實樣本` in
  `docs/驗收追蹤.md` once it passes with synthetic data.

### Batches

- Do not write large implementation plans and do not paste intended source before writing it.
  `docs/實作計畫/` holds only the plans written for stages 0 to 2; new sub-plans do not get one.
- Group three to five related tasks into a batch. The main session implements, tests, and checks
  that batch itself. Use subagents only for genuinely parallel independent work, at most two at a
  time, and never a reviewer reviewing a reviewer.
- After each batch, report briefly (what was finished, which tests ran, the commit, the next batch)
  and carry on. Do not stop for approval between batches.

### Tests

- Run npm commands from `app/`.
- While developing, run only the tests related to the change.
- At the end of each batch run `npm run format`, `npm run lint`, `npm run typecheck`, and the unit
  and integration suites. Run the related end-to-end specs only when the batch touched the interface.
- Run the full suite (`npm run check`) once when a sub-plan finishes and once before opening a
  pull request.

### Review

- Review the whole sub-plan once when it finishes, not once per task.
- Handle Critical and Important findings before the sub-plan is finished. Collect Minor findings
  and handle them before the sub-plan's final commit.

### Documents

- Update `docs/` only when behaviour changes, an acceptance status changes, or the spec turns out
  to contradict itself. Keep the per-batch progress summary in the agent temp area, not in `docs/`.
- Fill the evidence column in `docs/驗收追蹤.md` with the test files, put the CI run URL in the
  pull request description, and add the CI evidence line to `docs/驗收追蹤.md` in the first commit
  of the next branch. Never plan a step that pushes to the same pull request after CI passes: the
  user merges as soon as CI is green, so that commit would arrive too late.

### When to stop and ask

- Stop only for a spec conflict that would change product behaviour, for missing real game data
  (something only the user knows about the game), or before a destructive operation.
- Push right after each commit without asking. Always ask before opening a pull request, merging,
  or deleting a branch.
- For every other design choice, take the option you would recommend, apply it, and record it in
  the pull request description or in `docs/設計決策.md` for later review. Do not stop to ask.

### Visual design

- By the user's decision on 2026-09-19, visual design is stage 5 sub-plan 5-3: after performance
  (5-2), so that virtualization settles the list and card structure first, and before
  accessibility (5-4), so that the contrast, focus, and forced-colours checks run once against the
  final styling.
- Until 5-3 starts, keep the existing basic styling, do not add visual design tasks, and say
  plainly that the interface is still basic styling when reporting on it.

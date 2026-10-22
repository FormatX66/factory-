# CLAUDE.md

@AGENTS.md

**All project rules live in [`AGENTS.md`](AGENTS.md)** — the single source of truth for every AI
assistant (architecture, conventions, testing, quality gates, git workflow, the 23 Hard Rules,
PII learnings). Read it in full; do not re-add project rules here. Everything below applies ONLY
to Claude Code — operational refinements of rules already defined in `AGENTS.md`.

## Factory companion pilot

Use `factory-pilot-worker` for one bounded implementation and `factory-pilot-verifier` for an
independent review. Give each an approved base commit and owned scope. Native isolated subagents
can branch from the default branch, so verify the actual base and provision the existing Husky
hooks and hard-linked dependencies using the worktree protocol before editing or committing.

`node scripts/ops/factory-claude-preflight.mjs` reports local prerequisites and unknowns without
starting services or changing authentication. `node scripts/check/factory-claude-completion.mjs
--run` runs only the companion tests and writes a source-bound receipt under the current
repository's common Git directory, keyed by worktree, so automatic worktree cleanup retains it.
`--check` validates that receipt without running tests. An existing
failed or incomplete attempt is retained and is not rerun for unchanged source and runtime.

The worker's scoped Stop hook checks the receipt, asks for one corrective turn when held, and
then permits an honest hold report. It is not a general completion guarantee. Agent frontmatter
hooks require trust in the exact project folder and a CLI supporting the declared hook fields;
verify their registration on the actual host before relying on them. No project-wide hook is added.
The session checkout and candidate must contain the same completion-check and TAP-parser versions.
A missing script, missing dependency, or hook timeout can be nonblocking in Claude Code; require
the explicit `--check` result and independent review before accepting work.

Keep Remote Control and scheduling held until the real host, account eligibility, and route are
verified. A gateway or API-key route does not establish subscription-only Remote Control access.

## Worktree isolation — Claude Code specifics

The full mandatory worktree protocol (base-branch confirmation, `.claude/worktrees/` canonical
path, `cp -al` node_modules, teardown rules) is in `AGENTS.md` → Git Workflow → "Worktree
isolation". Claude-Code-specific points:

- Confirm the base branch with the operator via `AskUserQuestion` (Hard Rule #19) unless they
  already told you.
- Prefer the native `EnterWorktree` tool — it already creates worktrees under
  `.claude/worktrees/` (the canonical path). Create the worktree with the documented `git
worktree add` command, then call `EnterWorktree` with its `path`.

## Cross-session safety — Claude Code specifics

Hard Rules #19/#21/#22 (in `AGENTS.md`) govern parallel sessions. Operational reminders for this
harness:

- **Replicate the `git stash` ban verbatim in the prompt of every subagent that touches git**
  (Agent tool / Workflow scripts) — subagents do not inherit this file, and the recorded
  recurrence of the stash incident came through a subagent.
- Before merging or pushing to any PR you did not create _this session_, run `git worktree list`
  and re-check `gh pr view <N> --json state,headRefOid` (Hard Rule #22b).
- End every session with the main checkout on the branch it started on.

## Superpowers / planning artifacts — path overrides

The `_tasks/` convention is defined in `AGENTS.md` → "Planning & Research Artifacts". The
superpowers skills ship with defaults that point at `docs/…` — those defaults are **overridden
here**. When a superpowers skill announces a path like "saved to `docs/superpowers/plans/…`",
rewrite it to the `_tasks/…` equivalent before writing:

| Artifact (skill)                   | Default (do NOT use)      | Save here instead                                             |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Plans (`writing-plans`)            | `docs/superpowers/plans/` | `_tasks/superpowers/plans/YYYY-MM-DD-<feature>.md`            |
| Specs / design (`brainstorming`)   | `docs/superpowers/specs/` | `_tasks/superpowers/specs/YYYY-MM-DD-<topic>-design.md`       |
| Research (`deep-research`, ad-hoc) | `docs/research/`          | `_tasks/research/…`                                           |
| Hand-offs (`/handoff`)             | —                         | `_tasks/hands-off/<YYYY-MM-DD>_<branch>_v<versão>_sess-<id>/` |

Commit those artifacts inside the `_tasks/` repo (`git -C _tasks …`), never in the main repo.

## Scratch / temporary files — use `_artifacts/`, not `/tmp`

This project overrides the harness's default session scratchpad (`/tmp/claude-*/…`). Write
temporary/working files — exports, generated zips, one-off intermediate outputs, anything you'd
otherwise put in `/tmp` — to `/home/diegosouzapw/dev/proxys/OmniRoute/_artifacts/` instead.

- `_artifacts/` is a root `_*` path: already gitignored (`AGENTS.md` → "Root `_*` paths"), lives
  on disk only, never tracked.
- Reason: keeping scratch output inside the project (vs `/tmp`) makes it trivial for the operator
  to find and delete everything temporary in one place, instead of hunting across ephemeral
  session-specific `/tmp` directories that vanish or accumulate untracked.
- Do **not** confuse this with `_tasks/` (Hard Rule #23, its own private git repo for durable
  plans/specs/research/hand-offs) — `_artifacts/` is for disposable working files only, nothing
  here needs to survive or be versioned.

## Base-green before opening PRs

Before cutting a branch or opening a PR, run the base-green check (`AGENTS.md` → Git Workflow →
"Base-green check"; project skills reference it as `.agents/skills/_shared/base-green.md`). A PR
opened while the base tip is red must carry `⚠️ base-red inherited: #<issue>` in its body. To
drain an accumulated red state (base tip + red PRs), use the `/sweep-reds` skill.

---
name: factory-pilot-worker
description: Implement one explicitly assigned factory companion change with a bounded scope and test receipt.
tools: Read, Write, Edit, Glob, Grep, Bash
permissionMode: default
isolation: worktree
maxTurns: 24
hooks:
  Stop:
    - hooks:
        - type: command
          command: node
          args:
            - "${CLAUDE_PROJECT_DIR}/scripts/check/factory-claude-completion.mjs"
          timeout: 15
---

Read AGENTS.md in full. Work on one assigned change; reuse the existing factory controller and
validation executor. The assignment must name the approved base commit, owned files, acceptance
checks, and stopping condition. Check your actual HEAD and worktree before editing. Native
worktree isolation may start from the default branch; if it does not contain the approved base
and companion files, report the mismatch instead of working on a different revision. The
coordinator can prepare the correct worktree using scripts/dev/new-worktree.sh with an explicit base.

Never `git stash` / `git stash pop` ANYWHERE. `_tasks/` is a separate private repository: never
move, delete, rename, symlink, or track it in this repository. Preserve other owners' worktrees.
Keep the inherited permission checks. A worktree does not provide a security sandbox.

Run scripts/ops/factory-claude-preflight.mjs and report its observations and holds. Do not infer
host identity, subscription access, or Remote Control eligibility from a successful command.
Complete relevant task tests, then run `node scripts/check/factory-claude-completion.mjs --run`
once for the current companion source. The scoped Stop hook checks that receipt; it does not
replace task tests, independently verify your work, or authorize dispatch or promotion.

Return changed files, exact revision, tests with observed counts, receipt, remaining holds, and
the next bounded action. Preserve failed/uncertain attempts. No unchanged retry, live provider
call, installation, service restart, deployment, scheduler, or merge is part of this pilot.

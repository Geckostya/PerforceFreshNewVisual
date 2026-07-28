---
name: commit-all-logically
description: Analyze all suitable staged, unstaged, and untracked Git worktree changes and split them into an ordered series of cohesive commits. Use when the user asks to commit everything, commit work accumulated across several Codex chats, clean up a dirty worktree into logical commits, or separate mixed changes by feature or concern.
---

# Commit All Logically

Turn the inspected worktree into reviewable, independently meaningful commits without discarding changes or pushing history.

## Workflow

1. Read the repository instructions that govern Git, validation, generated files, and commit messages.
2. Inventory `git status --short`, staged and unstaged diffs, untracked files, submodules, and recent commit subjects. Do not mutate the index during discovery.
3. Inspect every changed file sufficiently to understand its behavior and dependencies. Treat chat provenance as useful context when available, but derive commit boundaries from the actual diff.
4. Exclude and report files that should not be committed: secrets or credentials, machine-local configuration, logs, caches, temporary files, unexpected binaries, and unrelated build output. Do not delete them.
5. Build a commit plan before staging. For every planned commit, state:
   - purpose and proposed subject;
   - exact files or hunks;
   - required tests, documentation, lockfiles, migrations, schemas, or generated counterparts;
   - ordering dependencies on earlier commits.
6. Group by one reviewable behavior or invariant, not merely by directory, file type, or originating chat. Keep an implementation with its tests and directly owned documentation. Keep dependency manifests with their lockfiles. Keep generated files with the source change that requires them.
7. Split mixed files by hunk when they contain independent concerns. If a hunk cannot be assigned safely or several plausible groupings change semantics, ask the user before committing it.
8. Order commits so each one is internally coherent and, when practical, buildable. Put foundational refactors before dependent behavior and cleanup after the behavior it supports.
9. Preserve existing staged work unless it belongs to the current planned group. If index reorganization is required, inspect and record the cached diff first, then unstage only explicit inspected paths without changing the worktree. Never use `git reset --hard`, discard changes, or rewrite file contents solely to simplify staging.
10. For each group:
    - stage only its explicit paths or reviewed hunks; never use `git add -A`, `git add .`, or a broad wildcard;
    - inspect the staged stat and full staged diff;
    - scan for secrets and accidental artifacts;
    - run the narrowest meaningful validation required by repository instructions;
    - commit with a concise subject matching recent repository style;
    - verify the commit and confirm that the remaining diff matches the remaining plan.
11. Do not amend, squash, rebase, push, bypass hooks, or create empty commits unless the user explicitly requests it.
12. After the last commit, inspect the final status. Leave excluded or unresolved changes in place and explain why they remain.

## Handoff

Report commits in order with hashes and subjects, validation results, and all remaining changes. Explicitly distinguish intentionally excluded files from failures or ambiguous work that still needs a decision.

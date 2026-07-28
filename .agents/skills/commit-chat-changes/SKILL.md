---
name: commit-chat-changes
description: Create one or more Git commits containing only changes attributable to the current Codex chat while preserving pre-existing or unrelated worktree changes. Use when the user asks to commit this chat's work, the changes just made, the current task, or only the assistant's changes in a dirty repository.
---

# Commit Chat Changes

Commit only the work produced for the current conversation. Treat every other worktree or index change as user-owned.

## Workflow

1. Read the repository instructions that govern Git, validation, generated files, and commit messages.
2. Inspect `git status --short`, unstaged and staged diffs, untracked files, and recent commit subjects. Do not mutate the index yet.
3. Reconstruct the chat-owned change set from actions and patches recorded in the current conversation. Do not infer ownership from modification times, authorship metadata, or the fact that a file is currently dirty.
4. Classify every candidate file or hunk as:
   - chat-owned;
   - pre-existing or unrelated;
   - ambiguous.
5. Stop and ask the user about ambiguous hunks when committing them could capture unrelated work. A file may contain both chat-owned and foreign hunks.
6. Decide the commit boundary. Prefer one cohesive commit for the chat. Split only when the chat intentionally produced independent changes that can each be reviewed and reverted safely.
7. Run the narrowest relevant validation required by repository instructions. Do not rewrite unrelated code merely to make a broader pre-existing failure pass.
8. Stage exact paths only when the entire file is chat-owned. For mixed files, stage only reviewed chat-owned hunks. Never use `git add -A`, `git add .`, or a broad wildcard.
9. Before each commit, inspect `git diff --cached --stat` and the full `git diff --cached`. Verify that every staged line belongs to the planned commit and that no secrets, credentials, local configuration, logs, build outputs, or unrelated generated artifacts are included.
10. If the index already contains unrelated staged changes, do not let a normal `git commit` consume them. Preserve them and ask before reorganizing the index if they cannot be isolated safely.
11. Write a concise commit subject from the staged behavior change, following the repository's recent style. Add a body only when it explains non-obvious motivation or constraints.
12. Commit without amending, rebasing, pushing, or bypassing hooks unless the user explicitly requests it.
13. Verify the resulting commit with `git show --stat --oneline --decorate --no-renames HEAD` and inspect the remaining status. Confirm that unrelated changes remain untouched.

## Handoff

Report each commit hash and subject, the validation performed, and any remaining uncommitted or ambiguous changes. If nothing can be attributed to the current chat, do not create an empty commit.

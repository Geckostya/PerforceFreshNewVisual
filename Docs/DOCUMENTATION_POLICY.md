# Documentation and agent-context policy

This living contract owns how P4FNV documentation, `AGENTS.md`, and project skills are created and maintained. [`README.md`](README.md) indexes current contracts; `.agents/skills/develop-p4fnv/SKILL.md` routes a task to them.

## Loading and ownership

Use progressive disclosure:

1. `AGENTS.md` contains only guardrails required for every task.
2. `SKILL.md` defines the startup workflow and selects documents by task type.
3. `Docs/README.md` is the only index of living contracts.
4. Load only the owner for the changed behavior plus genuinely adjacent contracts.
5. Read research only when a current decision or verification problem needs it.

One normative fact has one owner:

| Information | Owner |
|---|---|
| global mandatory agent rules | `AGENTS.md` |
| task routing and development workflow | `SKILL.md` |
| living-contract index | `Docs/README.md` |
| cross-feature technical boundaries | `ARCHITECTURE.md` |
| one complex feature workflow | its topic contract |
| shared UI, accessibility, and visual QA | `UI_UX_SPECIFICATION.md` |
| builds, versions, and shipping commands | `TOOLCHAIN.md` |
| current readiness and priorities | `P4_FEATURE_CHECKLIST.md` and `checklists/` |
| reusable background reference or test matrix | `Docs/research/` |

Other documents may link to the owner and explain its relevance in one sentence. Repeat a rule only when it is a safety guardrail that must apply before the owner can be selected.

## Documentation during feature work

Treat documentation as part of the feature, not as an after-action diary.

Before implementation:

1. Read the owning contract and relevant checklist.
2. Do not create a task plan, progress log, audit report, phase document, or implementation snapshot in the repository. Use the task, issue, and Git history for temporary state.

While implementing, update documentation in the same change only when the feature changes at least one of these:

- a user-visible workflow or safety invariant;
- an architecture, IPC, data, or dependency boundary;
- a build, verification, release, localization, or native-agent procedure;
- feature readiness, a known gap, or the next priority.

Do not document implementation details that are clearer and more accurate in types, code, or tests. Replace superseded statements instead of appending a dated correction, completed phase, or changelog. Mark checklist work complete only when the stated Definition of Done has evidence; otherwise describe the remaining gap precisely.

Before handoff:

1. Compare the documentation diff with the final code and tests.
2. Update the single owner and, only when readiness changed, its checklist.
3. Remove temporary notes and facts made obsolete by the feature.
4. Check relative links, the `Docs/README.md` index, and document sizes.

Create a new living contract only when a cohesive workflow has independent invariants that would make its current owner hard to navigate. Add it to `Docs/README.md` and route to it conditionally from the skill. A new research file must support a current decision or reusable verification need; raw investigation logs, machine snapshots, copied upstream manuals, and superseded specifications do not belong in the working tree. Git history is the archive.

## Size and structure

- Keep the project skill at or below 120 lines and 1,200 words.
- Target at most 1,500 words for a living contract or research note. At 2,000 words, condense or split it before handoff unless the file is a cohesive legal or generated artifact.
- Keep indexes short; they route readers and do not summarize every linked document.
- Use headings in files longer than 100 lines. Add a table of contents only when headings alone do not make navigation obvious.
- Do not maintain exhaustive source-tree, command, model, or capability snapshots when `rg`, types, tests, or generated output provide fresher evidence.
- Split by ownership, not by an arbitrary line count. A set of tiny documents with overlapping rules is worse than one cohesive contract.

## Language and skills

- Keep project documentation, skills, `AGENTS.md`, code comments, and commit-facing prose in English.
- Preserve official Helix Core names, flags, identifiers, paths, and source titles.
- Skill frontmatter contains only `name` and a trigger-oriented `description`.
- Write skill bodies as concise executable routes. Detailed feature rules remain in their owning contracts.

## Acceptance criteria

- An ordinary task does not need every contract.
- Every current rule has one discoverable owner.
- No document exists only to preserve obsolete status or history.
- Feature status agrees with code and available verification.
- Every relative Markdown link resolves.
- Documents stay within the size policy or carry a justified exception.
- The project skill passes its structure validator.

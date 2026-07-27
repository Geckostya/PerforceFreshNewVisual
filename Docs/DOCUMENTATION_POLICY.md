# Documentation and agent-context policy

This living contract defines how to write project skills, `AGENTS.md`, and P4FNV documentation so an agent receives the necessary rules without loading the entire documentation set unconditionally.

## Loading principle

Use progressive disclosure:

1. `AGENTS.md` contains only short mandatory guardrails for every task.
2. `SKILL.md` defines the startup workflow and routes by task type.
3. `Docs/README.md` is the only index of living contracts.
4. The agent reads only documents relevant to the current change. Multiple contracts are needed only for a genuinely cross-cutting task.
5. Research, decision history, and extended catalogs are read only when their rationale is needed.

Do not require every living contract to be read before each project task. By default, `SKILL.md`, `Docs/README.md`, the relevant contract, and the code and tests of the changed area are sufficient.

## Information ownership

One normative fact has one owner:

| Information | Owner |
|---|---|
| global mandatory agent rules | `AGENTS.md` |
| document selection and the general workflow | `SKILL.md` |
| map of living contracts | `Docs/README.md` |
| technical boundaries shared by several features | `ARCHITECTURE.md` |
| end-to-end contract for one complex feature | a topic-specific document |
| shared UI/UX, accessibility, and visual QA | `UI_UX_SPECIFICATION.md` |
| builds, versions, and shipping commands | `TOOLCHAIN.md` |
| current feature status and priorities | `P4_FEATURE_CHECKLIST.md` |
| historical rationale and research | `Docs/research/` |

Other documents may link to the owner and briefly explain why it is relevant, but must not retell it in detail. Limited repetition is allowed only for a critical safety rule that must apply before a topic-specific document is selected.

## Language policy

- Communicate with the user in the language of their latest request unless they ask for another language.
- Keep project documentation, skills, `AGENTS.md`, commit-facing technical prose, and code comments in English.
- User-visible application strings remain externalized in complete English and Russian locale packs; localized fixtures and translation data are not code comments.
- Preserve official Helix Core command names, flags, identifiers, paths, and quoted source titles instead of translating them.

## Skill requirements

- Frontmatter contains only `name` and a precise, trigger-oriented `description`.
- Write the body as an executable route, not as a product encyclopedia.
- Keep only knowledge that cannot safely be inferred from code, `AGENTS.md`, or the selected contract.
- State the read condition for every reference. Do not use language such as "read everything at startup."
- Do not copy UI sizes, feature semantics, build commands, or MCP details into the skill when an owning document exists.
- Target a project skill size of at most 120 lines and 1,200 words. Exceeding it requires explicit justification or further splitting.

## Living-contract requirements

- Start each document with its area of responsibility and links to adjacent owners.
- Keep a shared invariant in a core document and a detailed single-feature workflow in a topic-specific document.
- Do not mix a mandatory contract, current status, and historical explanation. Status belongs in the checklist; history belongs in `research`.
- Do not manually maintain large snapshots of information that can be obtained more cheaply and accurately from code unless the snapshot defines a normative structure.
- When a document grows beyond 2,000 words or contains several independent domains, review whether it should be split. This is a review threshold, not an automatic requirement to fragment a cohesive contract.
- Use clear headings in documents longer than 100 lines. Add a separate table of contents only when selecting the relevant section would otherwise be difficult.

## Changing documentation

Before changing a skill, `AGENTS.md`, or living contracts:

1. Read this document and `Docs/README.md`.
2. Identify the owner of every new rule.
3. Update the owner and replace duplicates with links.
4. Verify that the new document did not become an unconditional dependency for unrelated tasks.
5. Check links, skill size, and the document list in `Docs/README.md`.
6. Preserve user changes in a dirty worktree; do not rewrite a modified document wholesale without need.

## Acceptance criteria

- A new ordinary task does not require loading every living contract.
- `SKILL.md` unambiguously identifies which document to read for each task class.
- Every new rule has one normative owner.
- Removing a duplicate does not remove the contract: a clear link or route remains in its place.
- A behavior change updates only the behavior's owner and, when necessary, the checklist.
- `SKILL.md` passes skill-structure validation, and every relative Markdown link resolves.

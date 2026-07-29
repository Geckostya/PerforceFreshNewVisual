# P4FNV UI/UX contract

This living contract owns shared layout, interaction, accessibility, visual language, and visual QA. Files/safe sync belong to [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md), changes/shelves to [`CHANGELIST_REQUIREMENTS.md`](CHANGELIST_REQUIREMENTS.md), and readiness to [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md).

## Interaction model

P4FNV presents intent and consequences, not CLI flags. A complex operation follows one path:

1. Select an object or exact scope.
2. Obtain a server-backed preview.
3. Show source, target, affected items, and risk.
4. Start with a button naming the outcome.
5. Move long-running progress/cancel to Operations Center.
6. Reread server state after the terminal result.

Do not invent a staging area, false Git commit graph, or universal Undo. Get Revision changes workspace content; `p4 undo` creates new opened work.

## Shell and resource screens

The persistent shell exposes server/user/workspace context, Go To, language, theme, Sign out, Close workspace, the main navigation, and non-overlapping Operations/CLI diagnostics. Theme defaults to the operating-system preference; explicit Light or Dark selection persists across launches. Close workspace returns to connection selection without revoking the ticket; Sign out does revoke it. The command palette provides navigation and Go To focus, not a hidden catalog of feature actions.

Resource screens share this structure:

```text
heading + whole-view actions
compact search/filter/sort/view toolbar
list or tree | persistent inspector
```

- Do not repeat the screen name in an eyebrow.
- Selection updates the inspector without pseudo-navigation or layout jumps.
- Put metadata, preview, and selected-object actions in the inspector; keep one main location for the primary action.
- Context menus accelerate visible workflows and never become their only access path.
- Loading, empty, error, permission, stale, and partial states keep the same layout.
- Long panes scroll internally. At minimum window size, stack panes or use a drawer without hiding the full path or primary action.

File history is contextual to a selected file in Files; it is not a standalone screen with manual depot-path entry. Labels remains reachable through Go To/command palette without a main-sidebar entry. Submitted changes has a main-sidebar entry and opens on the current user's changes across all streams. Do not expose full merge-down/copy-up Integration or full Resolve before an end-to-end backend workflow exists.

Every resource screen uses the same icon-only Refresh action in the heading. Its 32 px geometry and accessible localized name remain stable; the icon rotates while that screen refreshes, with motion disabled under `prefers-reduced-motion`, and no loading text replaces it.

### Streams

- Show a bounded parent/child tree with visibility controls and a fixed-node-size graph. Text identifies current stream and type; color only supplements it.
- Selection and visibility are separate. Group visibility actions apply to the selection; disabling a parent cascades, enabling changes only that parent, and mixed descendants produce an indeterminate state.
- Collapse changes tree presentation and range order, not selection or graph visibility. Visibility, collapse, and `Unactual` presentation persist per server/user/workspace without changing Helix Core.
- Moving a parent to `Unactual` includes descendants; ordinary restore affects only selected paths. Explicit descendant commands exist and stale paths are cleaned after a successful read.
- Child stream creation is available from the heading and selected-stream summary, with `Create child stream` as a graph/tree context-menu accelerator that preselects the parent. The three-step dialog collects basics and Paths, lets the user type view paths or select existing directories inside the current workspace, requires a server-backed stream-form review before creation, and creates only the stream specification without switching or syncing the workspace.
- Stream switching chooses independent local (`Shelve`/`Keep`) and content (`Download now`/`Keep as is`) strategies. Download uses safe sync, and a successful switch invalidates hidden Local Files state.

## Selection, keyboard, and drag-and-drop

Comparable lists use the same rules: click selects one, Ctrl/Cmd+click toggles, Shift+click selects a contiguous range, and a batch action covers the full selection. Refresh retains existing IDs and removes stale ones. Workspace selection may contain files and folders together.

Drag-and-drop distinguishes move from copy, ignores external or malformed payloads, and always has a button/context-menu equivalent. Feature-specific targets remain in the owning workflow contract.

Mandatory keyboard paths:

- `Ctrl/Cmd+K` command palette and `Ctrl/Cmd+L` Go To;
- `Ctrl/Cmd+1..5` Files, My Changes, Streams, Shelves, and Jobs;
- `ContextMenu` or `Shift+F10` for a focused row;
- `Escape` for a safely closable menu/dialog;
- predictable Tab/Shift+Tab order and focus restoration.

No action is drag-only, hover-only, or color-only.

## Dialogs, operations, and errors

- Use shared modal/action-dialog primitives, never browser `prompt` or `confirm`.
- Shared dialogs keep one non-scrolling heading and close action outside the bounded content scroller, trap focus while open, restore prior focus on close, and use the same body spacing and footer treatment. Explanatory copy belongs in the body rather than crowding the heading.
- Titles and buttons name the result (`Delete shelf`, `Revert 8 files`), show scope and consequences, and default destructive/overwrite choices to Cancel or Skip.
- While a mutation runs, block duplicate submission and unsafe Escape closing. Explain disabled controls nearby or through accessible help.
- Operations Center is the sole progress/cancel/retry surface for one long operation. A feature may show a compact transient status, but not a second operation controller.
- Cancelling disables the action immediately; persistent `Cancelled` appears only after the backend publishes the terminal event and the feature refreshes.
- Show kind, scope, status, processed count, current path, and bounded diagnostics. Partial/unknown outcomes expose succeeded/failed/skipped counts, compensation state, read-back state, and a safe screen-specific recovery action. Do not invent totals, percentage, or ETA.
- Render a progress bar only when the backend provides a real total. With no measurable total, show the current phase/count/path beside the spinner instead of adding an indeterminate bar that repeats the same activity signal.
- Cancel is not rollback. Retry only an idempotent read or a newly confirmed mutation; never retry an unknown result automatically.
- Announce start, cancel request, and terminal outcome through one polite `aria-live` region. Progress ticks are not announced.
- Errors state what did not happen, why, and the safe next action. Warnings/errors remain in the bounded CLI log until viewed or cleared.

My Changes and Streams keep their last successful resource snapshot readable when Refresh fails. Their mutation controls reference one accessible stale-state explanation and remain disabled until a controlled Refresh succeeds; selection and local presentation cleanup continue only from authoritative IDs.

Files-specific progress, writable conflicts, and retry scope are in [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md).

## Diff and content preview

- Text diff supports unified/split modes, line numbers, hunk navigation, and visible whitespace modes.
- Show size limits and truncation; do not decode binary content as text.
- Revision and shelf preview is read-only and does not alter have/workspace state.
- Export writes to a selected new destination without implicit overwrite.
- Folder/changelist comparisons summarize object changes rather than pretending to be one text diff.

## Visual system

Use the tokens in `src/index.css` and shared selectors in `src/app/app.css`; do not add a feature-local theme or scale. Import named `lucide-react` icons rather than copied paths, emoji, Unicode symbols, or icon fonts. Decorative icons are hidden from assistive technology; icon-only controls retain localized `aria-label` and `title`.

| Role | Size | Use |
|---|---|---|
| Caption | 12/16 px | metadata, timestamps, hints |
| Body | 14/20 px | rows, fields, actions |
| Subtitle | 16/22 px | inspector/dialog/section headings |
| Title | 20/28 px | screen headings |
| Display | 28/36 px | connection heading only |
| Control | 32/36 px | compact/default controls |
| Row | 44/52 px | one/two text lines |

- Readable text is at least 12 px; 10 px is limited to optional short badges.
- Use the 4 px spacing grid: 4, 8, 12, 16, 24, and 32 px. Adjacent targets are at least 32 px; the absolute accessibility floor is 24×24 CSS px.
- Files and folders in one tree share geometry and typography. Use shared selectable row/tree primitives rather than rebuilding ARIA, disclosure, indentation, and selection styles.
- Hierarchy comes from spacing, type, and borders. Semantic color supplements a label/icon and uses existing tokens.
- Truncate long paths only when the full value remains available in inspector, tooltip, or Copy.
- Motion is brief and disabled under `prefers-reduced-motion`; English and Russian use the same layout.
- Reuse the shared submitted-changelist history and safe Markdown description components instead of feature-local variants. Only HTTP(S) description links are actionable and open outside the WebView.

## Accessibility, scale, and completion

- Use semantic controls and list/tree/table roles with visible focus. Expose selection, expansion, busy, error, and terminal operation state to assistive technology.
- Keep queries scoped and bounded. Use pagination/incremental loading; add virtualization only after measurement and without breaking selection or accessibility.
- Show local loading feedback after 300 ms; move long work to Operations Center.
- Verify keyboard-only use, Windows Narrator for key flows, English/Russian, long content, minimum window size, and 100/125/200% scale.

A UI flow is complete only when UI → Rust → `p4` → refresh works, frequent and destructive actions have appropriate access and confirmation, empty/loading/error/partial states are covered, focus is restored, every string exists in complete English/Russian packs, and native visual QA passes for supported themes and scales.

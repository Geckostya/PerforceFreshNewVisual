# UI size and visual-consistency research

Date: July 22, 2026. This document records rationale; the mandatory current contract is in [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md).

## Original interface problem

An audit of `src/app/app.css` found a disconnected scale: user-facing text ranged from 8 to 25 px, while buttons had heights of 25, 28, 30, 32, 34, 36, and 38 px. In Files, a file row was 52 px high while a folder row in the same tree was 34 px. Inspector history used 10 px, Streams metadata and CLI log used 9 px, and some badges used 8 px. Conceptually identical elements therefore looked like components from different products, and important history was less readable than secondary controls.

## External references

- [Fluent 2 Typography](https://fluent2.microsoft.design/typography) defines a Windows ramp of 12/16 px for Caption, 14/20 px for Body, 20/28 px for Subtitle, and 28/36 px for Title. This guides semantic roles; it is not a reason to use every step simultaneously.
- [Microsoft Windows typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography) recommends Segoe UI Variable and emphasizes hierarchy and readability. P4FNV already uses the correct Windows font stack.
- [Windows content layout and spacing](https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics) groups the UI with stable 8, 12, and 16 effective-pixel intervals and recommends Body for primary list text, reserving Caption for tight secondary locations.
- [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) sets a 24×24 CSS px floor or requires sufficient spacing. P4FNV adopts a more predictable 32 px minimum for adjacent desktop controls.
- [WCAG 2.2 Resize Text](https://www.w3.org/TR/WCAG22/#resize-text) requires preserving content and function at 200% text enlargement; density therefore cannot rely on tiny fonts and fixed tight containers.

## Adopted decision

P4FNV uses a small semantic system adapted to a dense Windows desktop client:

1. Typography: Caption 12/16, Body 14/20, Subtitle 16/22, Title 20/28, Display 28/36 px.
2. Geometry: controls 32/36 px; list/tree rows 44 px for one line and 52 px for two lines.
3. Spacing: 4 px base with working steps of 4, 8, 12, 16, 24, and 32 px.
4. The same role means the same geometry. A file and folder in one tree differ through semantic affordances, not typography or density.
5. Reserve 10 px for short badges whose text duplicates a clearer status. All readable metadata starts at 12 px.

## Why no UI framework was added

The project already has shared selectors and one CSS entry point. Tokens remove inconsistencies without a dependency, component migration, or DOM change. This also preserves current localization, keyboard behavior, and the Tauri/WebView2 boundary.

## Verification criteria

- Files: folder/file rows read as one tree and have the same height and baseline.
- History: revision description reads as Body, metadata as Caption.
- Controls: adjacent buttons are at least 32 px; ordinary fields and primary actions are 36 px.
- Screens: English/Russian, 100/125/200%, minimum window; no clipping, lost actions, or whole-page horizontal scroll.
- CSS audit: new feature styles use tokens instead of new local scales.

export function nextPaneIndex(current: number, total: number, backwards = false): number {
  if (total <= 0) return -1;
  if (current < 0) return backwards ? total - 1 : 0;
  return (current + (backwards ? -1 : 1) + total) % total;
}

export function focusNextPane(backwards = false): boolean {
  if (document.querySelector("[aria-modal='true']")) return false;
  const panes = [...document.querySelectorAll<HTMLElement>("[data-focus-pane]:not([hidden])")]
    .filter((pane) => pane.getClientRects().length > 0);
  const current = panes.findIndex((pane) => pane.contains(document.activeElement));
  const next = nextPaneIndex(current, panes.length, backwards);
  if (next < 0) return false;
  const target = panes[next].querySelector<HTMLElement>("[data-pane-entry], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") || panes[next];
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

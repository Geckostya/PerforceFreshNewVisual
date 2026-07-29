import type { StreamIntegrationDirection, StreamPathRuleInput, StreamSummary } from "../../shared/models";

export interface StreamIntegrationCandidate {
  direction: StreamIntegrationDirection;
  sourceStream: string;
  targetStream: string;
}

export function streamIntegrationCandidates(streams: StreamSummary[], currentStream?: string): StreamIntegrationCandidate[] {
  if (!currentStream) return [];
  const current = streams.find((stream) => stream.path.toLowerCase() === currentStream.toLowerCase());
  if (!current) return [];
  const candidates: StreamIntegrationCandidate[] = [];
  if (current.parent) {
    candidates.push({ direction: "mergeDown", sourceStream: current.parent, targetStream: current.path });
  }
  for (const child of streams.filter((stream) => stream.parent?.toLowerCase() === current.path.toLowerCase())) {
    candidates.push({ direction: "copyUp", sourceStream: child.path, targetStream: current.path });
  }
  return candidates;
}

export function streamIntegrationCandidatesForSelection(
  candidates: StreamIntegrationCandidate[],
  selectedStream?: string,
): StreamIntegrationCandidate[] {
  if (!selectedStream) return [];
  const selected = selectedStream.toLowerCase();
  return candidates.filter((candidate) =>
    candidate.sourceStream.toLowerCase() === selected || candidate.targetStream.toLowerCase() === selected,
  );
}

export interface StreamTreeNode {
  stream: StreamSummary;
  children: StreamTreeNode[];
}

export interface StreamGraphNode {
  stream: StreamSummary;
  x: number;
  y: number;
}

export interface StreamGraphEdge {
  from: string;
  to: string;
}

export function isValidStreamName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name.trim());
}

export function childStreamPath(parent: string, name: string): string {
  const separator = parent.lastIndexOf("/");
  return separator > 1 && name.trim() ? `${parent.slice(0, separator)}/${name.trim()}` : "";
}

export function mergeSelectedStreamViewPaths(
  paths: StreamPathRuleInput[],
  selected: string[],
): StreamPathRuleInput[] {
  const base = paths.length === 1 && paths[0].kind === "share" && paths[0].viewPath.trim() === "..."
    ? []
    : paths;
  const existing = new Set(base.map((rule) => rule.viewPath.trim()));
  const additions = selected
    .filter((viewPath) => {
      if (existing.has(viewPath)) return false;
      existing.add(viewPath);
      return true;
    })
    .map((viewPath): StreamPathRuleInput => ({ kind: "share", viewPath }));
  return [...base, ...additions].slice(0, 100);
}

export function buildStreamForest(streams: StreamSummary[]): StreamTreeNode[] {
  const nodes = new Map(streams.map((stream) => [stream.path, { stream, children: [] as StreamTreeNode[] }]));
  const roots: StreamTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.stream.parent && nodes.get(node.stream.parent);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: StreamTreeNode[]) => {
    items.sort((left, right) => left.stream.path.localeCompare(right.stream.path));
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export function flattenStreamForest(nodes: StreamTreeNode[], collapsed = new Set<string>()): StreamSummary[] {
  return nodes.flatMap((node) => [
    node.stream,
    ...(collapsed.has(node.stream.path) ? [] : flattenStreamForest(node.children, collapsed)),
  ]);
}

export function streamSubtreePaths(streams: StreamSummary[], rootPath: string): string[] {
  const children = new Map<string, string[]>();
  for (const stream of streams) {
    if (!stream.parent) continue;
    children.set(stream.parent, [...(children.get(stream.parent) || []), stream.path]);
  }
  const paths: string[] = [];
  const visit = (path: string) => {
    if (paths.includes(path)) return;
    paths.push(path);
    (children.get(path) || []).forEach(visit);
  };
  visit(rootPath);
  return paths;
}

export function streamDescendantPaths(streams: StreamSummary[], rootPath: string): string[] {
  return streamSubtreePaths(streams, rootPath).slice(1);
}

export function updateStreamVisibility(
  streams: StreamSummary[],
  visible: Set<string>,
  rootPaths: string[],
  show: boolean,
): Set<string> {
  const next = new Set(visible);
  const affected = new Set(show
    ? rootPaths
    : rootPaths.flatMap((path) => streamSubtreePaths(streams, path)));
  affected.forEach((path) => show ? next.add(path) : next.delete(path));
  return next;
}

export function updateArchivedStreamPaths(
  streams: StreamSummary[],
  archivedPaths: string[],
  rootPaths: string[],
  archived: boolean,
): string[] {
  const next = new Set(archivedPaths);
  const affected = new Set(archived
    ? rootPaths.flatMap((path) => streamSubtreePaths(streams, path))
    : rootPaths);
  affected.forEach((path) => archived ? next.add(path) : next.delete(path));
  return [...next];
}

export function layoutStreamGraph(streams: StreamSummary[]): { nodes: StreamGraphNode[]; edges: StreamGraphEdge[]; width: number; height: number } {
  const byPath = new Map(streams.map((stream) => [stream.path, stream]));
  const depth = (stream: StreamSummary, seen = new Set<string>()): number => {
    if (!stream.parent || !byPath.has(stream.parent) || seen.has(stream.path)) return 0;
    seen.add(stream.path);
    return 1 + depth(byPath.get(stream.parent)!, seen);
  };
  const ordered = [...streams].sort((left, right) => depth(left) - depth(right) || left.path.localeCompare(right.path));
  const rows = new Map<number, number>();
  const nodes = ordered.map((stream) => {
    const column = depth(stream);
    const row = rows.get(column) || 0;
    rows.set(column, row + 1);
    return { stream, x: 24 + column * 230, y: 24 + row * 82 };
  });
  const paths = new Set(nodes.map((node) => node.stream.path));
  const edges = nodes.flatMap(({ stream }) => stream.parent && paths.has(stream.parent)
    ? [{ from: stream.parent, to: stream.path }]
    : []);
  return {
    nodes,
    edges,
    width: Math.max(520, ...nodes.map((node) => node.x + 210)),
    height: Math.max(320, ...nodes.map((node) => node.y + 64)),
  };
}

export function streamTypeClass(type: string): string {
  const normalized = type.toLowerCase();
  return ["mainline", "development", "release", "virtual", "task"].includes(normalized) ? normalized : "other";
}

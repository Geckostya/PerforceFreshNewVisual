import type { FileRevision } from "./models";

export const REVISION_GRAPH_NODE_LIMIT = 100;
export const REVISION_GRAPH_EDGE_LIMIT = 200;

export interface RevisionGraphEdge {
  source: string;
  target: string;
  how: string;
}

export interface RevisionGraphModel {
  edges: RevisionGraphEdge[];
  partial: boolean;
  omittedRecords: number;
}

/** Builds display edges exclusively from filelog integration records. */
export function buildRevisionGraph(revisions: FileRevision[], historyMayBePartial = false): RevisionGraphModel {
  const visibleRevisions = revisions.slice(0, REVISION_GRAPH_NODE_LIMIT);
  let omittedRecords = revisions.length - visibleRevisions.length;
  const edges: RevisionGraphEdge[] = [];
  for (const revision of visibleRevisions) {
    for (const integration of revision.integrationRecords) {
      if (!integration.filePath) {
        omittedRecords += 1;
        continue;
      }
      if (edges.length === REVISION_GRAPH_EDGE_LIMIT) {
        omittedRecords += 1;
        continue;
      }
      const range = [integration.startRevision, integration.endRevision].filter(Boolean).join("–");
      edges.push({
        source: `${integration.filePath}${range ? `#${range}` : ""}`,
        target: `#${revision.revision}`,
        how: integration.how || "unknown",
      });
    }
  }
  return { edges, partial: historyMayBePartial || omittedRecords > 0, omittedRecords };
}

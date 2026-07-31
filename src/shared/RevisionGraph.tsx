import { useMemo } from "react";
import { useLocale } from "./i18n";
import type { FileRevision } from "./models";
import { buildRevisionGraph } from "./revisionGraphModel";

export function RevisionGraph({ revisions, historyMayBePartial = false }: { revisions: FileRevision[]; historyMayBePartial?: boolean }) {
  const { t } = useLocale();
  const graph = useMemo(() => buildRevisionGraph(revisions, historyMayBePartial), [historyMayBePartial, revisions]);
  if (!graph.edges.length) return null;
  return <section className="revision-graph" aria-labelledby="revision-graph-title">
    <div className="column-heading"><strong id="revision-graph-title">{t("revisionGraphTitle")}</strong><span>{graph.edges.length}</span></div>
    <p className="revision-graph-source">{t("revisionGraphServerRecords")}</p>
    {graph.partial && <p className="revision-graph-partial" role="status">{t("revisionGraphPartial")}</p>}
    <ul className="revision-graph-edges" aria-label={t("revisionGraphEdges")}>
      {graph.edges.map((edge, index) => <li key={`${edge.source}:${edge.target}:${edge.how}:${index}`}>
        <span className="revision-graph-node" title={edge.source}>{edge.source}</span>
        <span className="revision-graph-arrow" aria-hidden="true">→</span>
        <span className="revision-graph-node">{edge.target}</span>
        <span className="revision-graph-how">{edge.how}</span>
      </li>)}
    </ul>
  </section>;
}

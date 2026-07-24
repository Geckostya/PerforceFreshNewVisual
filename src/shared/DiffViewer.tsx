import { useEffect, useMemo, useState } from "react";
import { useLocale } from "./i18n";

type RowKind = "add" | "remove" | "context" | "hunk" | "meta";
type DiffRow = { kind: RowKind; text: string; oldLine?: number; newLine?: number; hunk?: number };

function parseRows(text: string): { rows: DiffRow[]; hunks: number[] } {
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  const hunks: number[] = [];
  const rows = text.split("\n").map((line): DiffRow => {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      oldLine = Number(header[1]); newLine = Number(header[2]); hunk += 1; hunks.push(hunk);
      return { kind: "hunk", text: line, hunk };
    }
    if (hunk < 0) return { kind: line.startsWith("---") || line.startsWith("+++") ? "meta" : "context", text: line };
    if (line.startsWith("+") && !line.startsWith("+++")) { const row = { kind: "add" as const, text: line.slice(1), newLine, hunk }; newLine += 1; return row; }
    if (line.startsWith("-") && !line.startsWith("---")) { const row = { kind: "remove" as const, text: line.slice(1), oldLine, hunk }; oldLine += 1; return row; }
    const row = { kind: "context" as const, text: line.startsWith(" ") ? line.slice(1) : line, oldLine, newLine, hunk }; oldLine += 1; newLine += 1; return row;
  });
  return { rows, hunks };
}

export function DiffViewer({ text, truncated, binary }: { text: string; truncated?: boolean; binary?: boolean }) {
  const { t } = useLocale();
  const parsed = useMemo(() => parseRows(text), [text]);
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [activeHunk, setActiveHunk] = useState(0);
  useEffect(() => { setActiveHunk(0); }, [text]);
  function moveHunk(delta: number) {
    const next = Math.max(0, Math.min(parsed.hunks.length - 1, activeHunk + delta));
    setActiveHunk(next);
    requestAnimationFrame(() => document.getElementById(`diff-hunk-${next}`)?.scrollIntoView({ block: "nearest" }));
  }
  function exportDiff() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "p4fnv-diff.patch";
    link.click();
    URL.revokeObjectURL(url);
  }
  const controls = <div className="diff-viewer-controls"><button type="button" className={mode === "unified" ? "active" : ""} onClick={() => setMode("unified")}>{t("diffUnified")}</button><button type="button" className={mode === "split" ? "active" : ""} onClick={() => setMode("split")}>{t("diffSplit")}</button><span>{parsed.hunks.length ? `${activeHunk + 1} / ${parsed.hunks.length}` : t("diffNoHunks")}</span><button type="button" onClick={() => moveHunk(-1)} disabled={!parsed.hunks.length || activeHunk === 0}>{t("diffPreviousHunk")}</button><button type="button" onClick={() => moveHunk(1)} disabled={!parsed.hunks.length || activeHunk >= parsed.hunks.length - 1}>{t("diffNextHunk")}</button><button type="button" onClick={exportDiff} disabled={!text}>{t("diffExport")}</button></div>;
  const binaryDetected = Boolean(binary || text.includes("==== binary") || text.includes("\u0000"));
  return <div className="diff-viewer">{controls}{binaryDetected ? <div className="diff-binary" role="status"><strong>{t("diffBinaryTitle")}</strong><span>{t("diffBinaryBody")}</span></div> : <div className={`diff-code diff-${mode}`}>{mode === "unified" ? parsed.rows.map((row, index) => <div className={`diff-row diff-${row.kind}`} id={row.kind === "hunk" ? `diff-hunk-${row.hunk}` : undefined} key={`${index}-${row.text}`}><span className="diff-line-number">{row.oldLine ?? ""}</span><span className="diff-line-number">{row.newLine ?? ""}</span><code>{row.kind === "add" ? "+" : row.kind === "remove" ? "-" : row.kind === "context" ? " " : ""}{row.text}</code></div>) : parsed.rows.map((row, index) => <div className={`diff-split-row diff-${row.kind}`} id={row.kind === "hunk" ? `diff-hunk-${row.hunk}` : undefined} key={`${index}-${row.text}`}><code>{row.kind === "remove" || row.kind === "context" ? `${row.oldLine ?? ""} ${row.kind === "remove" ? "-" : " "} ${row.text}` : ""}</code><code>{row.kind === "add" || row.kind === "context" ? `${row.newLine ?? ""} ${row.kind === "add" ? "+" : " "} ${row.text}` : ""}</code></div>)}</div>}{truncated && <p className="diff-warning">{t("diffTruncated")}</p>}</div>;
}

export { parseRows };

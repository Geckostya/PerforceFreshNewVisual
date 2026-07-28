import { openUrl } from "@tauri-apps/plugin-opener";
import { useId, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "./i18n";

const allowedElements = [
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
];

export function externalMarkdownUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function markdownToPlainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ChangelistDescription({ value, fallback, compact = false, className = "" }: {
  value: string | undefined;
  fallback?: string;
  compact?: boolean;
  className?: string;
}) {
  const source = value?.trim() || fallback || "";

  function openLink(event: ReactMouseEvent<HTMLAnchorElement>, href: string | undefined) {
    event.preventDefault();
    event.stopPropagation();
    const url = externalMarkdownUrl(href);
    if (url) void openUrl(url);
  }

  return <div className={`changelist-markdown${compact ? " compact" : ""}${className ? ` ${className}` : ""}`} title={compact ? markdownToPlainText(source) : undefined}>
    <ReactMarkdown
      allowedElements={allowedElements}
      components={{
        a: ({ href, children, title }) => externalMarkdownUrl(href)
          ? <a href={href} title={title} onClick={(event) => openLink(event, href)} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{children}</a>
          : <span>{children}</span>,
      }}
      remarkPlugins={[remarkGfm]}
      skipHtml
      unwrapDisallowed
      urlTransform={(url) => externalMarkdownUrl(url) ? defaultUrlTransform(url) : undefined}
    >{source}</ReactMarkdown>
  </div>;
}

export function ChangelistDescriptionEditor({ value, onChange, autoFocus = false }: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  return <div className="field changelist-description-editor">
    <label className="field-label" htmlFor={id}>{t("descriptionLabel")}</label>
    <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} maxLength={10_000} autoFocus={autoFocus} />
    <div className="changelist-description-preview">
      <span className="field-label">{t("markdownPreview")}</span>
      <ChangelistDescription value={value} fallback={t("noDescription")} />
    </div>
    <small className="field-hint">{t("markdownHint")}</small>
  </div>;
}

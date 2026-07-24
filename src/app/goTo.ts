export type GoToTarget =
  | { kind: "depot"; value: string }
  | { kind: "workspace"; value: string }
  | { kind: "change"; value: string }
  | { kind: "job"; value: string }
  | { kind: "label"; value: string }
  | { kind: "unknown"; value: string };

export function classifyGoTo(input: string): GoToTarget {
  const value = input.trim();
  if (!value) return { kind: "unknown", value };
  if (value.startsWith("ws:")) return { kind: "workspace", value: value.slice(3).trim() || "//..." };
  if (value.startsWith("//")) return { kind: "depot", value };
  if (value.startsWith("job:")) return { kind: "job", value: value.slice(4).trim() };
  if (value.startsWith("label:")) return { kind: "label", value: value.slice(6).trim() };
  if (/^#?\d+$/.test(value)) return { kind: "change", value: value.replace(/^#/, "") };
  return { kind: "unknown", value };
}

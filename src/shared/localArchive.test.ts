import { describe, expect, it } from "vitest";
import { archiveStorageKey, decodeArchiveDrag, encodeArchiveDrag, partitionArchived, retainArchivedIds } from "./localArchive";

describe("presentation-only unactual state", () => {
  it("scopes state by feature and connection", () => {
    expect(archiveStorageKey("changes", "ssl:p4:1666", "alex", "main"))
      .not.toBe(archiveStorageKey("streams", "ssl:p4:1666", "alex", "main"));
  });

  it("removes stale ids and partitions without reordering", () => {
    expect(retainArchivedIds(["42", "99"], ["17", "42"])).toEqual(["42"]);
    expect(partitionArchived([{ id: "17" }, { id: "42" }], ["42"], (item) => item.id)).toEqual({
      current: [{ id: "17" }],
      archived: [{ id: "42" }],
    });
  });

  it("keeps local archive ids until the server snapshot is ready", () => {
    expect(retainArchivedIds(["42"], [], false)).toEqual(["42"]);
    expect(retainArchivedIds(["42"], [], true)).toEqual([]);
  });

  it("round-trips a validated archive drag payload", () => {
    const item = { kind: "streams" as const, ids: ["//main", "//dev", "//main"], archived: false };
    expect(decodeArchiveDrag(encodeArchiveDrag(item))).toEqual({ ...item, ids: ["//main", "//dev"] });
    expect(decodeArchiveDrag('{"kind":"files","ids":["42"],"archived":false}')).toBeUndefined();
    expect(decodeArchiveDrag("not json")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { DepotSummary } from "../../shared/models";
import { buildDepotRows, filterOverviewDepots, formatDepotDate } from "./DepotOverview";

const DEPOTS: DepotSummary[] = [
  { name: "Acme", path: "//Acme", depotType: "stream", description: "Product streams" },
  { name: "Shared", path: "//Shared", depotType: "local", description: "Shared libraries" },
];

describe("depot overview", () => {
  it("filters real depot metadata without changing the source list", () => {
    expect(filterOverviewDepots(DEPOTS, "stream", "").map((item) => item.name)).toEqual(["Acme"]);
    expect(filterOverviewDepots(DEPOTS, "classic", "shared").map((item) => item.name)).toEqual(["Shared"]);
    expect(DEPOTS).toHaveLength(2);
  });

  it("formats tagged epoch dates and preserves server-formatted values", () => {
    expect(formatDepotDate("0", "en-US")).toBe("Jan 1, 1970");
    expect(formatDepotDate("2026/07/27", "en-US")).toBe("2026/07/27");
    expect(formatDepotDate(undefined, "en-US")).toBeUndefined();
  });

  it("places immediate files beside folders in the expanded depot tree", () => {
    const rows = buildDepotRows([DEPOTS[0]], {
      "//Acme": {
        directories: ["//Acme/main"],
        files: [{ depotPath: "//Acme/readme.md", revision: "4", action: "edit" }],
      },
    }, new Set(["//Acme"]), "");

    expect(rows.map(({ kind, path }) => [kind, path])).toEqual([
      ["depot", "//Acme"],
      ["folder", "//Acme/main"],
      ["file", "//Acme/readme.md"],
    ]);
  });
});

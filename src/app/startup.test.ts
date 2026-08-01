import { describe, expect, it } from "vitest";
import type { AppSettings } from "../shared/models";
import { connectionToAutoOpen } from "./startup";

describe("connectionToAutoOpen", () => {
  it("uses the most recent complete workspace connection", () => {
    const settings: AppSettings = {
      language: "en",
      theme: "system",
    deleteAddedFilesOnRevert: false,
    favoriteConnections: [],
    workspaceScanConfigurations: [],
      recentConnections: [
        { port: "p4:1666", user: "alex" },
        { port: "p4:1666", user: "alex", client: "alex-main" },
      ],
    };

    expect(connectionToAutoOpen(settings)?.client).toBe("alex-main");
  });

  it("does not auto-open an incomplete saved profile", () => {
    const settings: AppSettings = {
      language: "en",
      theme: "system",
    deleteAddedFilesOnRevert: false,
    favoriteConnections: [],
    workspaceScanConfigurations: [],
      recentConnections: [{ port: "p4:1666", user: "alex", client: "  " }],
    };

    expect(connectionToAutoOpen(settings)).toBeUndefined();
  });
});

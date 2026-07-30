import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "./i18n";
import { confirmedMappingLocalPath, PathActions } from "./PathActions";
import type { ConnectionInput, WorkspaceMapping } from "./models";

const connection: ConnectionInput = {
  port: "perforce:1666",
  user: "alex",
  client: "alex-main",
};

function mapping(state: WorkspaceMapping["state"], localPath?: string): WorkspaceMapping {
  return {
    query: "//Acme/main/a.txt",
    state,
    depotPath: "//Acme/main/a.txt",
    localPath,
    diagnostics: [],
  };
}

describe("PathActions mapping identity", () => {
  it("uses a caller local path only when no server mapping context exists", () => {
    expect(confirmedMappingLocalPath(undefined, undefined, "C:\\work\\a.txt")).toBe("C:\\work\\a.txt");
    expect(confirmedMappingLocalPath(connection, undefined, "C:\\guessed\\a.txt")).toBeUndefined();
    expect(confirmedMappingLocalPath(connection, mapping("unmapped"), "C:\\guessed\\a.txt")).toBeUndefined();
    expect(confirmedMappingLocalPath(connection, mapping("excluded"), "C:\\guessed\\a.txt")).toBeUndefined();
    expect(confirmedMappingLocalPath(connection, mapping("mapped", "C:\\work\\a.txt"), "C:\\guessed\\a.txt")).toBe("C:\\work\\a.txt");
  });

  it("does not expose a caller local path while p4 where is still pending", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <PathActions
          depotPath="//Acme/main/a.txt"
          localPath="C:\\guessed\\a.txt"
          connection={connection}
        />
      </LocaleProvider>,
    );

    expect(html).toContain("Copy depot path");
    expect(html).not.toContain("C:\\guessed\\a.txt");
    expect(html).not.toContain("Copy local path");
  });
});

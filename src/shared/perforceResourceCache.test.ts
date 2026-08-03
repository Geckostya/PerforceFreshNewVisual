import { describe, expect, it, vi } from "vitest";
import { invalidatePerforceResources, perforceResourceKey, readPerforceResource } from "./perforceResourceCache";

const connection = { port: "1666", user: "ana", client: "ws" };

describe("Perforce resource cache", () => {
  it("shares an in-flight read, returns cached data immediately, and refreshes it in the background", async () => {
    const key = perforceResourceKey(connection, "pending");
    let resolve!: (value: string[]) => void;
    const load = vi.fn(() => new Promise<string[]>((done) => { resolve = done; }));
    const first = readPerforceResource(key, load, 0);
    const second = readPerforceResource(key, load, 0);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(["first"]);
    await expect(first).resolves.toEqual(["first"]);
    await expect(second).resolves.toEqual(["first"]);
    let refresh!: (value: string[]) => void;
    load.mockImplementationOnce(() => new Promise<string[]>((done) => { refresh = done; }));
    await expect(readPerforceResource(key, load, 15_001)).resolves.toEqual(["first"]);
    expect(load).toHaveBeenCalledTimes(2);
    refresh(["fresh"]);
    await Promise.resolve();
    await expect(readPerforceResource(key, load, 15_002)).resolves.toEqual(["fresh"]);
    load.mockResolvedValueOnce(["after-invalidation"]);
    invalidatePerforceResources(connection);
    await expect(readPerforceResource(key, load, 15_003)).resolves.toEqual(["after-invalidation"]);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

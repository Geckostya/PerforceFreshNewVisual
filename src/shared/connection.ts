import type { ConnectionInput, P4Info } from "./models";

export function connectionForServer(input: ConnectionInput, info: P4Info): ConnectionInput {
  if (input.charset || info.unicode?.trim().toLowerCase() !== "enabled") return input;
  return { ...input, charset: "utf8" };
}

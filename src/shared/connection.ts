import type { ConnectionInput, P4Info } from "./models";
import { capabilityIsSupported } from "./capabilities";

export function connectionForServer(input: ConnectionInput, info: P4Info): ConnectionInput {
  if (input.charset || !capabilityIsSupported(info.capabilities?.facts.unicodeServer)) return input;
  return { ...input, charset: "utf8" };
}

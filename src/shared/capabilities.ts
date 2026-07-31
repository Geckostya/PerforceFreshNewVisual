import type { CapabilityFact } from "./models";

export function capabilityGate(fact?: CapabilityFact): { allowed: boolean; reason?: string } {
  if (!fact || fact.state === "unknown") return { allowed: true, reason: fact?.reason };
  return { allowed: fact.state === "supported", reason: fact.reason };
}

export function capabilityIsSupported(fact?: CapabilityFact): boolean {
  return fact?.state === "supported";
}

export function capabilitySetGate(facts: Array<CapabilityFact | undefined>): boolean {
  return facts.every((fact) => capabilityGate(fact).allowed);
}

export interface ConnectionFields {
  port: string;
  user: string;
  client?: string;
}

export type ConnectionError = "portRequired" | "portInvalid" | "userRequired" | "workspaceRequired";
export type ConnectionErrors = Partial<Record<keyof ConnectionFields, ConnectionError>>;

import type { AppError, AuthStage, CapabilityFact, TrustChallenge } from "../../shared/models";
import type { TranslationKey } from "../../shared/i18n";

export interface AuthUiState {
  open: boolean;
  busy: boolean;
  stage?: AuthStage;
  response: string;
  error?: AppError;
}

export type AuthUiAction =
  | { type: "open" }
  | { type: "busy" }
  | { type: "stage"; stage: AuthStage }
  | { type: "response"; response: string }
  | { type: "error"; error: AppError }
  | { type: "cancel" };

export const initialAuthState: AuthUiState = { open: false, busy: false, response: "" };

export function authReducer(state: AuthUiState, action: AuthUiAction): AuthUiState {
  switch (action.type) {
    case "open": return { open: true, busy: true, response: "" };
    case "busy": return { ...state, busy: true, response: "", error: undefined };
    case "stage": return { ...state, open: true, busy: false, stage: action.stage, response: "", error: undefined };
    case "response": return { ...state, response: action.response };
    case "error": return { ...state, busy: false, response: "", error: action.error };
    case "cancel": return { ...initialAuthState, stage: { kind: "cancelled", methods: [], pollingAttempt: 0, maxPollingAttempts: state.stage?.maxPollingAttempts ?? 20 } };
  }
}

export function authShouldPoll(stage?: AuthStage): boolean {
  return Boolean(stage && ["external_browser", "waiting"].includes(stage.kind) && stage.pollingAttempt < stage.maxPollingAttempts);
}

export function capabilityGate(fact?: CapabilityFact): { allowed: boolean; reason?: string } {
  if (!fact || fact.state === "unknown") return { allowed: true, reason: fact?.reason };
  return { allowed: fact.state === "supported", reason: fact.reason };
}

export function trustDialogModel(challenge: TrustChallenge): { title: TranslationKey; warning: TranslationKey; fingerprint: string } {
  return {
    title: challenge.reason === "changed" ? "trustChangedTitle" : "trustNewTitle",
    warning: challenge.reason === "changed" ? "trustChangedWarning" : "trustNewWarning",
    fingerprint: challenge.presentedFingerprint,
  };
}

export function validateConnection(fields: ConnectionFields, requireWorkspace = false): ConnectionErrors {
  const errors: ConnectionErrors = {};

  if (!fields.port.trim()) {
    errors.port = "portRequired";
  } else if (!isValidPort(fields.port.trim())) {
    errors.port = "portInvalid";
  }

  if (!fields.user.trim()) {
    errors.user = "userRequired";
  }

  if (requireWorkspace && !fields.client?.trim()) {
    errors.client = "workspaceRequired";
  }

  return errors;
}

function isValidPort(value: string): boolean {
  const withoutProtocol = value.startsWith("ssl:") ? value.slice(4) : value;
  const separator = withoutProtocol.lastIndexOf(":");
  if (separator <= 0 || separator === withoutProtocol.length - 1) {
    return false;
  }

  const port = Number(withoutProtocol.slice(separator + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

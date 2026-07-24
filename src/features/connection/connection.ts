export interface ConnectionFields {
  port: string;
  user: string;
  client?: string;
}

export type ConnectionError = "portRequired" | "portInvalid" | "userRequired" | "workspaceRequired";
export type ConnectionErrors = Partial<Record<keyof ConnectionFields, ConnectionError>>;

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

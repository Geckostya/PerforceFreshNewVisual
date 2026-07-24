import type { AppSettings, ConnectionInput } from "../shared/models";

export function connectionToAutoOpen(settings: AppSettings): ConnectionInput | undefined {
  return settings.recentConnections.find((connection) =>
    Boolean(connection.port.trim() && connection.user.trim() && connection.client?.trim()),
  );
}

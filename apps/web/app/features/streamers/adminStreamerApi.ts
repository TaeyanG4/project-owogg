import {
  StreamerAdminActionRequestSchema,
  StreamerAdminActionResponseSchema,
  StreamerAdminWorkspaceDataSchema,
  StreamerAdminWorkspaceQuerySchema,
  type StreamerAdminActionRequest,
  type StreamerAdminWorkspaceQuery,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api/client";

export function fetchStreamerAdminWorkspaceApi(input: StreamerAdminWorkspaceQuery) {
  const query = StreamerAdminWorkspaceQuerySchema.parse(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return apiFetch(
    `/api/admin/streamers/workspace?${params.toString()}`,
    StreamerAdminWorkspaceDataSchema,
  );
}

export function applyStreamerAdminActionApi(input: StreamerAdminActionRequest) {
  return apiFetch("/api/admin/streamers/actions", StreamerAdminActionResponseSchema, {
    method: "POST",
    body: JSON.stringify(StreamerAdminActionRequestSchema.parse(input)),
  });
}

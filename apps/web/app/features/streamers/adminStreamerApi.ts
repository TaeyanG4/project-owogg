import {
  StreamerManualReviewActionRequestSchema,
  StreamerManualReviewActionResponseSchema,
  StreamerManualReviewQueueResponseSchema,
  type StreamerManualReviewActionRequest,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api/client";

export function fetchManualStreamerReviewsApi(limit = 20, offset = 0) {
  return apiFetch(
    `/api/admin/streamers/reviews?limit=${limit}&offset=${offset}`,
    StreamerManualReviewQueueResponseSchema,
  );
}

export function applyManualStreamerReviewApi(
  jobId: number,
  input: StreamerManualReviewActionRequest,
) {
  const parsed = StreamerManualReviewActionRequestSchema.parse(input);
  return apiFetch(
    `/api/admin/streamers/reviews/${jobId}/action`,
    StreamerManualReviewActionResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(parsed),
    },
  );
}

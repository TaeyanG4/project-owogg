import { ApiClientError } from "../../lib/api";

export type OfficialGameUploadStatus =
  "PENDING" | "UPLOADING" | "RETRY_WAIT" | "SUCCESS" | "FAILED";

export interface OfficialGameBatchUploadResult {
  readonly id: number;
  readonly fileName: string;
  readonly status: OfficialGameUploadStatus;
  readonly message: string;
  readonly slug?: string | undefined;
}

interface QueuedFile<TFile> {
  readonly id: number;
  readonly file: TFile;
}

export interface OfficialGameUploadQueueOptions<TFile extends { readonly name: string }> {
  readonly publish: (file: TFile) => Promise<{ readonly slug: string; readonly title: string }>;
  readonly onProgress?: ((results: readonly OfficialGameBatchUploadResult[]) => void) | undefined;
  readonly onRunningChange?: ((running: boolean) => void) | undefined;
  readonly onIdle?: ((results: readonly OfficialGameBatchUploadResult[]) => void) | undefined;
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  readonly maxRateLimitRetries?: number | undefined;
  readonly retryDelayMilliseconds?: ((error: unknown) => number | null) | undefined;
}

export interface OfficialGameUploadQueue<TFile extends { readonly name: string }> {
  /** Appends files even while another publication is running. One drain loop owns all writes. */
  enqueue(files: readonly TFile[]): readonly number[];
  isRunning(): boolean;
  results(): readonly OfficialGameBatchUploadResult[];
  waitForIdle(): Promise<readonly OfficialGameBatchUploadResult[]>;
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MAX_RETRY_AFTER_SECONDS = 5 * 60;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 2;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Only 429 is retried. Invalid ZIPs, B2 failures, auth failures, and contract errors remain
 * isolated terminal failures instead of being hidden behind a long generic retry loop. */
export function officialGameUploadRetryDelayMilliseconds(error: unknown): number | null {
  if (!(error instanceof ApiClientError) || error.status !== 429) return null;
  const reportedRetryAfter = error.retryAfterSeconds;
  const safeRetryAfter =
    typeof reportedRetryAfter === "number" &&
    Number.isFinite(reportedRetryAfter) &&
    reportedRetryAfter > 0
      ? reportedRetryAfter
      : DEFAULT_RETRY_AFTER_SECONDS;
  const retryAfterSeconds = Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(1, Math.ceil(safeRetryAfter)),
  );
  return retryAfterSeconds * 1_000;
}

export function createOfficialGameUploadQueue<TFile extends { readonly name: string }>(
  options: OfficialGameUploadQueueOptions<TFile>,
): OfficialGameUploadQueue<TFile> {
  const sleep = options.sleep ?? defaultSleep;
  const retryDelayMilliseconds =
    options.retryDelayMilliseconds ?? officialGameUploadRetryDelayMilliseconds;
  const maxRateLimitRetries = Math.max(
    0,
    Math.floor(options.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES),
  );
  const pending: QueuedFile<TFile>[] = [];
  const idleWaiters: Array<(results: readonly OfficialGameBatchUploadResult[]) => void> = [];
  let currentResults: OfficialGameBatchUploadResult[] = [];
  let nextId = 1;
  let running = false;

  const snapshot = () => currentResults.map((result) => ({ ...result }));
  const emit = () => options.onProgress?.(snapshot());
  const update = (id: number, result: Omit<OfficialGameBatchUploadResult, "id">) => {
    const index = currentResults.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    currentResults[index] = { id, ...result };
    emit();
  };

  const drain = async () => {
    if (running) return;
    running = true;
    options.onRunningChange?.(true);

    while (pending.length > 0) {
      const queued = pending.shift();
      if (!queued) continue;
      let rateLimitRetryCount = 0;

      update(queued.id, {
        fileName: queued.file.name,
        status: "UPLOADING",
        message: "D1/B2에 게시 중",
      });

      for (;;) {
        try {
          const published = await options.publish(queued.file);
          update(queued.id, {
            fileName: queued.file.name,
            status: "SUCCESS",
            message: `${published.title} (${published.slug}) 게시 완료`,
            slug: published.slug,
          });
          break;
        } catch (error) {
          const retryDelay = retryDelayMilliseconds(error);
          if (retryDelay !== null && rateLimitRetryCount < maxRateLimitRetries) {
            rateLimitRetryCount += 1;
            update(queued.id, {
              fileName: queued.file.name,
              status: "RETRY_WAIT",
              message: `요청 제한 해제까지 약 ${Math.ceil(retryDelay / 1_000)}초 대기 후 자동 재시도 (${rateLimitRetryCount}/${maxRateLimitRetries})`,
            });
            await sleep(retryDelay);
            update(queued.id, {
              fileName: queued.file.name,
              status: "UPLOADING",
              message: `자동 재시도 중 (${rateLimitRetryCount}/${maxRateLimitRetries})`,
            });
            continue;
          }

          update(queued.id, {
            fileName: queued.file.name,
            status: "FAILED",
            message: error instanceof Error ? error.message : "공식 게임을 게시하지 못했습니다.",
          });
          break;
        }
      }
    }

    running = false;
    options.onRunningChange?.(false);
    const completed = snapshot();
    options.onIdle?.(completed);
    idleWaiters.splice(0).forEach((resolve) => resolve(completed));
  };

  return {
    enqueue(files) {
      if (files.length === 0) return [];

      // A new idle submission starts a fresh visible session. Enqueues made while draining append
      // to the current result list and are consumed by that same loop.
      if (!running && pending.length === 0) currentResults = [];
      const ids = files.map((file) => {
        const id = nextId++;
        pending.push({ id, file });
        currentResults.push({
          id,
          fileName: file.name,
          status: "PENDING",
          message: "게시 대기 중",
        });
        return id;
      });
      emit();
      void drain();
      return ids;
    },
    isRunning() {
      return running;
    },
    results() {
      return snapshot();
    },
    waitForIdle() {
      if (!running && pending.length === 0) return Promise.resolve(snapshot());
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

/** Compatibility helper for callers/tests that already have one fixed selection. The underlying
 * queue provides the same serial isolation plus rate-limit-aware retry. */
export async function uploadOfficialGameBatch<TFile extends { readonly name: string }>(
  files: readonly TFile[],
  publish: (file: TFile) => Promise<{ readonly slug: string; readonly title: string }>,
  onProgress?: ((results: readonly OfficialGameBatchUploadResult[]) => void) | undefined,
  options?:
    | Pick<
        OfficialGameUploadQueueOptions<TFile>,
        "sleep" | "maxRateLimitRetries" | "retryDelayMilliseconds"
      >
    | undefined,
): Promise<readonly OfficialGameBatchUploadResult[]> {
  const queue = createOfficialGameUploadQueue({
    publish,
    ...(onProgress ? { onProgress } : {}),
    ...options,
  });
  queue.enqueue(files);
  return queue.waitForIdle();
}

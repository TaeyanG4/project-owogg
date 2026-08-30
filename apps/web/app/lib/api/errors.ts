export type ApiErrorKind = "NetworkError" | "HttpError" | "ContractError";

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number | undefined;
  readonly detail?: string | undefined;
  readonly code?: string | undefined;
  readonly data?: unknown | undefined;
  readonly retryAfterSeconds?: number | undefined;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options?: {
      status?: number;
      detail?: string;
      code?: string;
      data?: unknown;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.detail !== undefined) {
      this.detail = options.detail;
    }
    if (options?.code !== undefined) {
      this.code = options.code;
    }
    if (options?.data !== undefined) {
      this.data = options.data;
    }
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

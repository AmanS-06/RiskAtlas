export type ApiErrorKind =
  | 'network' // no response: server down, DNS, CORS, offline
  | 'timeout'
  | 'aborted' // cancelled by the client because a newer request replaced it
  | 'validation' // HTTP 422
  | 'leakage' // HTTP 422 for a label column sent as an input
  | 'unavailable' // HTTP 503: models not loaded or trained against a different features.yaml
  | 'server' // HTTP 5xx or any other unexpected status
  | 'bad_response'; // 2xx but not the documented shape

export interface ApiErrorDetail {
  field: string | null;
  message: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly details: ApiErrorDetail[];

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number | null; code?: string | null; details?: ApiErrorDetail[] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.details = opts.details ?? [];
  }

  /** Worth retrying on the next edit without telling the user to fix anything. */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server' || this.kind === 'unavailable';
  }
}

export const isAbort = (e: unknown): boolean => e instanceof ApiError && e.kind === 'aborted';

/** Short heading for an error banner. The message carries the server's wording. */
export function errorTitle(e: ApiError): string {
  switch (e.kind) {
    case 'network':
      return 'Cannot reach the model server';
    case 'timeout':
      return 'The model server took too long to answer';
    case 'validation':
      return 'Some inputs were rejected';
    case 'leakage':
      return 'A label column was sent as an input';
    case 'unavailable':
      return 'Models are not available';
    case 'bad_response':
      return 'Unexpected reply from the server';
    case 'aborted':
      return 'Request cancelled';
    default:
      return 'The model server reported an error';
  }
}

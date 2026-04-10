/**
 * Retry and circuit breaker utilities inspired by omo project patterns
 * Provides resilient network calls with exponential backoff
 */

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatuses?: number[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

export class RetryableError extends Error {
  constructor(
    message: string,
    public override readonly cause: Error,
    public readonly attempt: number
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

export class NonRetryableError extends Error {
  constructor(
    message: string,
    public override readonly cause: Error
  ) {
    super(message);
    this.name = "NonRetryableError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  return Math.min(exponentialDelay, options.maxDelayMs);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  onRetry?: (attempt: number, delayMs: number, error: Error) => void
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Check if this is the last attempt
      if (attempt === opts.maxAttempts) {
        throw new RetryableError(
          `Operation failed after ${opts.maxAttempts} attempts`,
          err,
          attempt
        );
      }

      // Calculate delay and notify
      const delayMs = calculateDelay(attempt, opts);
      onRetry?.(attempt, delayMs, err);

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new RetryableError("Unexpected retry exhaustion", new Error("Unknown"), opts.maxAttempts);
}

// Circuit breaker states
type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 3,
  timeoutMs: 60000, // 1 minute
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private nextAttempt: number = Date.now();

  constructor(private options: CircuitBreakerOptions = DEFAULT_CIRCUIT_BREAKER_OPTIONS) {}

  getState(): CircuitState {
    if (this.state === "open" && Date.now() >= this.nextAttempt) {
      this.state = "half-open";
      this.successes = 0;
    }
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new Error(
        `Circuit breaker is OPEN. Next attempt available at ${new Date(this.nextAttempt).toISOString()}`
      );
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === "half-open") {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.state = "closed";
        this.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.successes = 0;

    if (this.failures >= this.options.failureThreshold) {
      this.state = "open";
      this.nextAttempt = Date.now() + this.options.timeoutMs;
    }
  }
}

// Combined retry + circuit breaker for maximum resilience
export async function withResilience<T>(
  operation: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
  retryOptions?: Partial<RetryOptions>,
  onRetry?: (attempt: number, delayMs: number, error: Error) => void
): Promise<T> {
  return circuitBreaker.execute(() => withRetry(operation, retryOptions, onRetry));
}

// Specialized fetch with retry for network calls
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retryOptions?: Partial<RetryOptions>
): Promise<Response> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };

  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        // Check if status is retryable
        if (opts.retryableStatuses?.includes(response.status)) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    opts
  );
}

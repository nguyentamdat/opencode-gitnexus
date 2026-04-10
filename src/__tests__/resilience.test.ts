import { describe, test, expect } from "bun:test";
import {
  withRetry,
  CircuitBreaker,
  withResilience,
  RetryableError,
  NonRetryableError,
  DEFAULT_RETRY_OPTIONS,
} from "../resilience.js";

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(async () => "success", {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
    });
    expect(result).toBe("success");
  });

  test("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("Temporary failure");
        return "success";
      },
      {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      }
    );
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("throws RetryableError after max attempts", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Persistent failure");
        },
        {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        }
      )
    ).rejects.toThrow(RetryableError);
    expect(attempts).toBe(3);
  });

  test("calls onRetry callback with attempt info", async () => {
    const onRetryCalls: Array<{ attempt: number; delayMs: number; error: Error }> = [];
    let attempts = 0;

    await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("Retry me");
        return "success";
      },
      {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
      (attempt, delayMs, error) => {
        onRetryCalls.push({ attempt, delayMs, error });
      }
    );

    expect(onRetryCalls).toHaveLength(2);
    expect(onRetryCalls[0]!.attempt).toBe(1);
    expect(onRetryCalls[1]!.attempt).toBe(2);
  });

  test("exponential backoff increases delay", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withRetry(
      async () => {
        attempts++;
        if (attempts < 4) throw new Error("Retry");
        return "done";
      },
      {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
      },
      (attempt, delayMs) => {
        delays.push(delayMs);
      }
    );

    // Delays should be: 10, 20, 40 (exponential)
    expect(delays[0]).toBe(10);
    expect(delays[1]).toBe(20);
    expect(delays[2]).toBe(40);
  });

  test("respects maxDelayMs cap", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withRetry(
      async () => {
        attempts++;
        if (attempts < 5) throw new Error("Retry");
        return "done";
      },
      {
        maxAttempts: 6,
        initialDelayMs: 50,
        maxDelayMs: 100, // Cap at 100ms
        backoffMultiplier: 2,
      },
      (attempt, delayMs) => {
        delays.push(delayMs);
      }
    );

    // Should cap at 100ms: 50, 100, 100, 100
    expect(delays[0]).toBe(50);
    expect(delays[1]).toBe(100);
    expect(delays[2]).toBe(100);
    expect(delays[3]).toBe(100);
  });

  test("works with single attempt (maxAttempts=1)", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Always fails");
        },
        {
          maxAttempts: 1,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        }
      )
    ).rejects.toThrow(RetryableError);
    expect(attempts).toBe(1);
  });
});

describe("CircuitBreaker", () => {
  test("starts in closed state and allows execution", async () => {
    const breaker = new CircuitBreaker();
    const result = await breaker.execute(async () => "success");
    expect(result).toBe("success");
    expect(breaker.getState()).toBe("closed");
  });

  test("opens after failure threshold exceeded", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeoutMs: 1000,
    });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("Failure");
        });
      } catch {}
    }

    expect(breaker.getState()).toBe("open");
  });

  test("rejects when open", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 5000, // Long timeout to stay open
    });

    // Trigger open state
    try {
      await breaker.execute(async () => {
        throw new Error("Trigger");
      });
    } catch {}

    expect(breaker.getState()).toBe("open");
    await expect(
      breaker.execute(async () => "should not run")
    ).rejects.toThrow(/Circuit breaker is OPEN/);
  });

  test("transitions to half-open after timeout", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 50, // Short timeout for testing
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error("Trigger");
      });
    } catch {}

    expect(breaker.getState()).toBe("open");

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Should be half-open now
    expect(breaker.getState()).toBe("half-open");
  });

  test("closes after success threshold in half-open", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 50,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error("Trigger");
      });
    } catch {}

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.getState()).toBe("half-open");

    // Two successful calls should close it
    await breaker.execute(async () => "success1");
    await breaker.execute(async () => "success2");

    expect(breaker.getState()).toBe("closed");
  });

  test("re-opens on failure in half-open", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 50,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error("Trigger");
      });
    } catch {}

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.getState()).toBe("half-open");

    // One failure should re-open
    try {
      await breaker.execute(async () => {
        throw new Error("Failure in half-open");
      });
    } catch {}

    expect(breaker.getState()).toBe("open");
  });

  test("tracks successes in closed state", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeoutMs: 1000,
    });

    // Multiple successes should keep it closed
    for (let i = 0; i < 5; i++) {
      await breaker.execute(async () => `success${i}`);
    }

    expect(breaker.getState()).toBe("closed");
  });
});

describe("withResilience", () => {
  test("combines circuit breaker and retry", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 1000,
    });

    let attempts = 0;
    const result = await withResilience(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("Temporary");
        return "success";
      },
      breaker,
      {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      }
    );

    expect(result).toBe("success");
    expect(attempts).toBe(3);
    expect(breaker.getState()).toBe("closed");
  });

  test("circuit breaker opens after retry exhaustion", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 5000,
    });

    // First call fails after retries, opens breaker
    await expect(
      withResilience(
        async () => {
          throw new Error("Always fails");
        },
        breaker,
        {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        }
      )
    ).rejects.toThrow();

    expect(breaker.getState()).toBe("open");
  });
});

describe("RetryableError", () => {
  test("captures cause and attempt number", () => {
    const cause = new Error("Original error");
    const error = new RetryableError("Failed after retries", cause, 3);

    expect(error.message).toBe("Failed after retries");
    expect(error.cause).toBe(cause);
    expect(error.attempt).toBe(3);
    expect(error.name).toBe("RetryableError");
  });
});

describe("NonRetryableError", () => {
  test("captures cause", () => {
    const cause = new Error("Fatal error");
    const error = new NonRetryableError("Won't retry", cause);

    expect(error.message).toBe("Won't retry");
    expect(error.cause).toBe(cause);
    expect(error.name).toBe("NonRetryableError");
  });
});

describe("DEFAULT_RETRY_OPTIONS", () => {
  test("has sensible defaults", () => {
    expect(DEFAULT_RETRY_OPTIONS.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_OPTIONS.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_OPTIONS.maxDelayMs).toBe(30000);
    expect(DEFAULT_RETRY_OPTIONS.backoffMultiplier).toBe(2);
    expect(DEFAULT_RETRY_OPTIONS.retryableStatuses).toContain(500);
    expect(DEFAULT_RETRY_OPTIONS.retryableStatuses).toContain(502);
    expect(DEFAULT_RETRY_OPTIONS.retryableStatuses).toContain(503);
    expect(DEFAULT_RETRY_OPTIONS.retryableStatuses).toContain(504);
  });
});

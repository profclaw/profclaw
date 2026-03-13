import { Queue, Worker, Job } from "bullmq";
import { createHmac } from "crypto";
import { logger } from "../utils/logger.js";

/**
 * Webhook Delivery Queue
 *
 * Handles outbound HTTP delivery of webhook events to customer-registered endpoints.
 * Signs every payload with HMAC-SHA256 using the endpoint secret.
 *
 * Retry schedule (exponential backoff):
 *   Attempt 1 — immediate
 *   Attempt 2 — 1 minute
 *   Attempt 3 — 5 minutes
 *   Attempt 4 — 25 minutes
 *   Attempt 5 — 2 hours
 *   Attempt 6 — 12 hours (exhausted after this)
 */

// Types

/** Shape of the job data placed on the BullMQ queue. */
export interface WebhookDeliveryPayload {
  /** WebhookDelivery record UUID (from PostgreSQL). */
  deliveryId: string;
  /** WebhookEndpoint record UUID. */
  endpointId: string;
  /** Destination URL to POST to. */
  url: string;
  /** Shared HMAC secret for this endpoint. */
  secret: string;
  /** Event type string, e.g. "link.created". */
  eventType: string;
  /** Serialized JSON body to send. */
  payload: string;
  /** Organization ID that owns the endpoint. */
  organizationId: string;
}

/** Result returned from a successful delivery job. */
interface WebhookDeliveryResult {
  deliveryId: string;
  statusCode: number;
  responseBody: string;
  deliveredAt: string;
}

// Constants

const QUEUE_NAME = "webhook-delivery";

/**
 * Delay in milliseconds for each retry attempt (exponential backoff).
 * Index 0 = delay before attempt 2, index 4 = delay before attempt 6.
 */
const RETRY_DELAYS_MS: readonly number[] = [
  60_000,          // 1 min
  300_000,         // 5 min
  1_500_000,       // 25 min
  7_200_000,       // 2 hr
  43_200_000,      // 12 hr
];

const MAX_ATTEMPTS = 6;

// Queue state (module-level singletons)

let webhookQueue: Queue<WebhookDeliveryPayload> | null = null;
let webhookWorker: Worker<WebhookDeliveryPayload, WebhookDeliveryResult> | null = null;

// Redis connection helper (matches task-queue.ts pattern)

function buildRedisConnection(): { host: string; port: number; password?: string } {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
  };
}

// HMAC signing

/**
 * Sign the raw payload string with HMAC-SHA256 and return the hex digest.
 * Customers verify delivery authenticity with:
 *   HMAC-SHA256(secret, rawBody) === X-ProfClaw-Signature header
 */
function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// Delivery logic

async function deliverWebhook(job: Job<WebhookDeliveryPayload>): Promise<WebhookDeliveryResult> {
  const { deliveryId, endpointId: _endpointId, url, secret, eventType, payload } = job.data;

  const signature = signPayload(secret, payload);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30 s hard timeout

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ProfClaw-Signature": signature,
        "X-ProfClaw-Delivery-Id": deliveryId,
        "X-ProfClaw-Event": eventType,
        "User-Agent": "profClaw-Webhook/1.0",
      },
      body: payload,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    logger.error(`[WebhookQueue] Delivery ${deliveryId} fetch failed: ${message}`);
    throw new Error(`Webhook delivery failed: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const responseBody = (await response.text()).slice(0, 1000);
  const statusCode = response.status;

  if (!response.ok) {
    logger.warn(
      `[WebhookQueue] Delivery ${deliveryId} got non-2xx status ${statusCode} from ${url}`,
    );
    throw new Error(`Endpoint returned HTTP ${statusCode}`);
  }

  logger.info(`[WebhookQueue] Delivery ${deliveryId} succeeded — HTTP ${statusCode}`);

  return {
    deliveryId,
    statusCode,
    responseBody,
    deliveredAt: new Date().toISOString(),
  };
}

// Public API

/**
 * Initialize the webhook delivery queue and start the worker.
 * Must be called once during application startup.
 */
export async function initWebhookQueue(): Promise<void> {
  const connection = buildRedisConnection();

  webhookQueue = new Queue<WebhookDeliveryPayload>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: {
        type: "custom",
      },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 604_800 },
    },
  });

  webhookWorker = new Worker<WebhookDeliveryPayload, WebhookDeliveryResult>(
    QUEUE_NAME,
    deliverWebhook,
    {
      connection,
      concurrency: parseInt(process.env.WEBHOOK_CONCURRENCY ?? "10", 10),
      // Custom backoff: use RETRY_DELAYS_MS indexed by attemptsMade - 1
      settings: {
        backoffStrategy(attemptsMade: number): number {
          const idx = Math.min(attemptsMade - 1, RETRY_DELAYS_MS.length - 1);
          return RETRY_DELAYS_MS[idx] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 43_200_000;
        },
      },
    },
  );

  webhookWorker.on("completed", (job, result) => {
    logger.info(
      `[WebhookQueue] Job ${job.id} completed — delivery ${result.deliveryId} at ${result.deliveredAt}`,
    );
  });

  webhookWorker.on("failed", (job, err) => {
    if (!job) return;
    const { deliveryId, url } = job.data;
    const isExhausted = (job.attemptsMade ?? 0) >= MAX_ATTEMPTS;

    if (isExhausted) {
      logger.error(
        `[WebhookQueue] Delivery ${deliveryId} to ${url} EXHAUSTED after ${job.attemptsMade} attempts: ${err.message}`,
      );
    } else {
      logger.warn(
        `[WebhookQueue] Delivery ${deliveryId} attempt ${job.attemptsMade}/${MAX_ATTEMPTS} failed: ${err.message}`,
      );
    }
  });

  logger.info("[WebhookQueue] Webhook delivery queue initialized");
}

/**
 * Enqueue a webhook delivery job.
 * Idempotent — pass jobId = deliveryId to avoid BullMQ duplicates.
 */
export async function addWebhookDelivery(payload: WebhookDeliveryPayload): Promise<void> {
  if (!webhookQueue) {
    throw new Error("[WebhookQueue] Queue not initialized — call initWebhookQueue() first");
  }

  await webhookQueue.add(
    `delivery:${payload.deliveryId}`,
    payload,
    {
      jobId: `delivery:${payload.deliveryId}`,
    },
  );

  logger.info(
    `[WebhookQueue] Enqueued delivery ${payload.deliveryId} for event ${payload.eventType} to ${payload.url}`,
  );
}

/**
 * Gracefully shut down the webhook queue and worker.
 * Call this during application shutdown.
 */
export async function closeWebhookQueue(): Promise<void> {
  if (webhookWorker) {
    await webhookWorker.close();
    webhookWorker = null;
  }
  if (webhookQueue) {
    await webhookQueue.close();
    webhookQueue = null;
  }
  logger.info("[WebhookQueue] Webhook delivery queue closed");
}

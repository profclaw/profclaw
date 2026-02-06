/**
 * Lightweight in-memory deduplication for inbound webhooks/interactions.
 *
 * This protects against provider retries causing duplicate command or message
 * handling within a short time window.
 */

type WebhookDedupEntry = {
  expiresAt: number;
  value?: unknown;
};

const seenWebhookEvents = new Map<string, WebhookDedupEntry>();

function getWebhookKey(scope: string, eventId: string | number): string {
  return `${scope}:${String(eventId)}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of seenWebhookEvents) {
    if (entry.expiresAt <= now) {
      seenWebhookEvents.delete(key);
    }
  }
}

export function isDuplicateWebhookEvent(
  scope: string,
  eventId: string | number,
  ttlMs = 5 * 60_000,
): boolean {
  const now = Date.now();
  pruneExpired(now);

  const key = getWebhookKey(scope, eventId);
  const entry = seenWebhookEvents.get(key);
  if (entry && entry.expiresAt > now) {
    return true;
  }

  seenWebhookEvents.set(key, { expiresAt: now + ttlMs });
  return false;
}

export function getWebhookDedupValue<T>(
  scope: string,
  eventId: string | number,
): T | undefined {
  const now = Date.now();
  pruneExpired(now);

  const entry = seenWebhookEvents.get(getWebhookKey(scope, eventId));
  if (!entry || entry.expiresAt <= now) {
    return undefined;
  }

  return entry.value as T | undefined;
}

export function setWebhookDedupValue(
  scope: string,
  eventId: string | number,
  value: unknown,
  ttlMs = 5 * 60_000,
): void {
  const now = Date.now();
  pruneExpired(now);

  seenWebhookEvents.set(getWebhookKey(scope, eventId), {
    expiresAt: now + ttlMs,
    value,
  });
}

export function clearWebhookDedupCache(): void {
  seenWebhookEvents.clear();
}

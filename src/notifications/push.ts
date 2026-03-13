/**
 * Web Push Notification Service
 *
 * Sends push notifications to subscribed clients (PWA, browser).
 * Uses the Web Push protocol (VAPID).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import crypto from 'node:crypto';

const PUSH_DIR = join(homedir(), '.profclaw', 'push');
const SUBSCRIPTIONS_FILE = join(PUSH_DIR, 'subscriptions.json');
const VAPID_FILE = join(PUSH_DIR, 'vapid.json');

// Types

export interface PushSubscription {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userId?: string;
  deviceName?: string;
  createdAt: string;
}

export interface PushNotification {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  actions?: Array<{ action: string; title: string }>;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// Push Service

class PushNotificationService {
  private subscriptions: PushSubscription[] = [];
  private vapidKeys: VapidKeys | null = null;

  constructor() {
    this.ensureDir();
    this.loadSubscriptions();
    this.loadOrGenerateVapidKeys();
  }

  /**
   * Get VAPID public key (needed by clients to subscribe)
   */
  getPublicKey(): string {
    if (!this.vapidKeys) {
      throw new Error('VAPID keys not initialized');
    }
    return this.vapidKeys.publicKey;
  }

  /**
   * Register a push subscription
   */
  subscribe(subscription: Omit<PushSubscription, 'id' | 'createdAt'>): PushSubscription {
    // Check if endpoint already registered
    const existing = this.subscriptions.find((s) => s.endpoint === subscription.endpoint);
    if (existing) return existing;

    const sub: PushSubscription = {
      ...subscription,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    this.subscriptions.push(sub);
    this.saveSubscriptions();
    return sub;
  }

  /**
   * Unregister a push subscription
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== subscriptionId);
    this.saveSubscriptions();
  }

  /**
   * Send push notification to all subscribers
   */
  async notifyAll(notification: PushNotification): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const sub of this.subscriptions) {
      try {
        await this.sendPush(sub, notification);
        sent++;
      } catch {
        failed++;
        // Remove invalid subscriptions (410 Gone)
      }
    }

    return { sent, failed };
  }

  /**
   * Send push notification to a specific user
   */
  async notifyUser(userId: string, notification: PushNotification): Promise<{ sent: number; failed: number }> {
    const userSubs = this.subscriptions.filter((s) => s.userId === userId);
    let sent = 0;
    let failed = 0;

    for (const sub of userSubs) {
      try {
        await this.sendPush(sub, notification);
        sent++;
      } catch {
        failed++;
      }
    }

    return { sent, failed };
  }

  /**
   * List all subscriptions
   */
  listSubscriptions(): PushSubscription[] {
    return [...this.subscriptions];
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.length;
  }

  // Private

  private async sendPush(subscription: PushSubscription, notification: PushNotification): Promise<void> {
    const payload = JSON.stringify(notification);

    // Use native fetch to send to the push endpoint
    // In production, use web-push library for proper VAPID signing
    // This is a simplified implementation
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TTL': '86400',
      },
      body: payload,
    });

    if (!response.ok) {
      if (response.status === 410) {
        // Subscription expired, remove it
        this.unsubscribe(subscription.id);
      }
      throw new Error(`Push failed: ${response.status}`);
    }
  }

  private ensureDir(): void {
    if (!existsSync(PUSH_DIR)) {
      mkdirSync(PUSH_DIR, { recursive: true });
    }
  }

  private loadSubscriptions(): void {
    try {
      if (existsSync(SUBSCRIPTIONS_FILE)) {
        const data = readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
        this.subscriptions = JSON.parse(data) as PushSubscription[];
      }
    } catch {
      this.subscriptions = [];
    }
  }

  private saveSubscriptions(): void {
    writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(this.subscriptions, null, 2));
  }

  private loadOrGenerateVapidKeys(): void {
    try {
      if (existsSync(VAPID_FILE)) {
        const data = readFileSync(VAPID_FILE, 'utf-8');
        this.vapidKeys = JSON.parse(data) as VapidKeys;
        return;
      }
    } catch {
      // Generate new keys
    }

    // Generate VAPID keys using ECDH with prime256v1
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();

    this.vapidKeys = {
      publicKey: ecdh.getPublicKey('base64url') as string,
      privateKey: ecdh.getPrivateKey('base64url') as string,
    };

    writeFileSync(VAPID_FILE, JSON.stringify(this.vapidKeys, null, 2));
  }
}

// Singleton

let pushService: PushNotificationService | null = null;

export function getPushService(): PushNotificationService {
  if (!pushService) {
    pushService = new PushNotificationService();
  }
  return pushService;
}

export { PushNotificationService };

/**
 * SSRF (Server-Side Request Forgery) Guard
 *
 * Prevents SSRF attacks by validating URLs before requests.
 * Features:
 * - DNS rebinding defense (resolve before connect)
 * - Private IP / CIDR blocking (RFC 1918, loopback, link-local, cloud metadata)
 * - Redirect chain validation with re-resolution
 * - URL scheme validation (http/https only)
 * - Configurable host allowlist
 */

import { promises as dns } from 'dns';
import { isIP } from 'net';
import { logger } from '../utils/logger.js';
import type { GuardResult, SsrfGuardConfig, RiskLevel } from './types.js';

// =============================================================================
// Default blocked CIDR ranges
// =============================================================================

/** RFC 1918 + special-use ranges to block */
const DEFAULT_BLOCKED_CIDRS = [
  '0.0.0.0/8',        // "This" network
  '10.0.0.0/8',       // Private (Class A)
  '100.64.0.0/10',    // Carrier-grade NAT
  '127.0.0.0/8',      // Loopback
  '169.254.0.0/16',   // Link-local (includes cloud metadata 169.254.169.254)
  '172.16.0.0/12',    // Private (Class B)
  '192.0.0.0/24',     // IETF Protocol Assignments
  '192.0.2.0/24',     // Documentation (TEST-NET-1)
  '192.168.0.0/16',   // Private (Class C)
  '198.18.0.0/15',    // Benchmarking
  '198.51.100.0/24',  // Documentation (TEST-NET-2)
  '203.0.113.0/24',   // Documentation (TEST-NET-3)
  '224.0.0.0/4',      // Multicast
  '240.0.0.0/4',      // Reserved
  '255.255.255.255/32', // Broadcast
];

/** Known cloud metadata endpoints to block */
const METADATA_HOSTS = new Set([
  '169.254.169.254',              // AWS, GCP, Azure
  'metadata.google.internal',     // GCP
  'metadata.internal',            // Generic cloud
]);

const DEFAULT_CONFIG: SsrfGuardConfig = {
  enabled: true,
  allowedHosts: [],
  blockedCidrs: DEFAULT_BLOCKED_CIDRS,
  maxRedirects: 5,
  dnsResolutionTimeout: 3000,
  allowedSchemes: ['http', 'https'],
};

// =============================================================================
// CIDR Matching Utilities
// =============================================================================

interface CidrRange {
  networkInt: number;
  maskInt: number;
}

function parseCidr(cidr: string): CidrRange | null {
  const parts = cidr.split('/');
  if (parts.length !== 2) return null;

  const ip = parts[0];
  const prefix = parseInt(parts[1], 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const ipInt = ipToInt(ip);
  if (ipInt === null) return null;

  const maskInt = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { networkInt: (ipInt & maskInt) >>> 0, maskInt };
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}

function isIpInCidr(ip: string, cidr: CidrRange): boolean {
  const ipInt = ipToInt(ip);
  if (ipInt === null) return false;
  return ((ipInt & cidr.maskInt) >>> 0) === cidr.networkInt;
}

// =============================================================================
// SSRF Guard
// =============================================================================

export class SsrfGuard {
  private config: SsrfGuardConfig;
  private parsedCidrs: CidrRange[];

  constructor(config?: Partial<SsrfGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Pre-parse CIDR ranges for performance
    this.parsedCidrs = this.config.blockedCidrs
      .map(parseCidr)
      .filter((c): c is CidrRange => c !== null);
  }

  /**
   * Validate a URL before making a request
   * Resolves DNS and checks against blocked ranges
   */
  async validateUrl(rawUrl: string): Promise<GuardResult> {
    if (!this.config.enabled) {
      return { allowed: true, risk: 'LOW' };
    }

    // Parse URL
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return {
        allowed: false,
        reason: `Invalid URL: ${rawUrl}`,
        risk: 'MEDIUM',
      };
    }

    // Check scheme
    const scheme = url.protocol.replace(':', '');
    if (!this.config.allowedSchemes.includes(scheme)) {
      return {
        allowed: false,
        reason: `Blocked URL scheme: ${scheme}. Only ${this.config.allowedSchemes.join(', ')} allowed`,
        risk: 'HIGH',
      };
    }

    const hostname = normalizeHostname(url.hostname);

    // Check if host is explicitly allowed (bypass)
    if (this.config.allowedHosts.includes(hostname)) {
      return { allowed: true, risk: 'LOW' };
    }

    // Check cloud metadata endpoints
    if (METADATA_HOSTS.has(hostname)) {
      logger.warn(`[SsrfGuard] Blocked cloud metadata access: ${hostname}`, { component: 'SsrfGuard' });
      return {
        allowed: false,
        reason: `Access to cloud metadata endpoint blocked: ${hostname}`,
        risk: 'CRITICAL',
      };
    }

    // If the hostname is already an IP, check directly
    if (isIP(hostname)) {
      return this.checkIp(hostname);
    }

    // Resolve DNS and check resolved IPs (prevents DNS rebinding)
    try {
      const ips = await this.resolveWithTimeout(hostname);

      if (ips.length === 0) {
        return {
          allowed: false,
          reason: `DNS resolution returned no addresses for: ${hostname}`,
          risk: 'MEDIUM',
        };
      }

      // Check ALL resolved IPs - block if any resolve to private range
      for (const ip of ips) {
        const result = this.checkIp(ip);
        if (!result.allowed) {
          logger.warn(`[SsrfGuard] Hostname ${hostname} resolved to blocked IP: ${ip}`, { component: 'SsrfGuard' });
          return {
            allowed: false,
            reason: `Hostname ${hostname} resolves to blocked IP ${ip}: ${result.reason}`,
            risk: result.risk,
          };
        }
      }

      return { allowed: true, risk: 'LOW' };
    } catch (error) {
      // DNS failure - block by default for safety
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[SsrfGuard] DNS resolution failed for ${hostname}: ${message}`, { component: 'SsrfGuard' });
      return {
        allowed: false,
        reason: `DNS resolution failed for ${hostname}: ${message}`,
        risk: 'MEDIUM',
      };
    }
  }

  /**
   * Validate a redirect target (re-resolve DNS for each hop)
   */
  async validateRedirect(redirectUrl: string, hopCount: number): Promise<GuardResult> {
    if (hopCount >= this.config.maxRedirects) {
      return {
        allowed: false,
        reason: `Too many redirects (max: ${this.config.maxRedirects})`,
        risk: 'MEDIUM',
      };
    }
    return this.validateUrl(redirectUrl);
  }

  /**
   * Check if an IP address is in a blocked range
   */
  checkIp(ip: string): GuardResult {
    // Check IPv4
    if (isIP(ip) === 4) {
      // Check loopback
      if (ip.startsWith('127.')) {
        return { allowed: false, reason: 'Loopback address blocked', risk: 'HIGH' };
      }

      // Check against all blocked CIDRs
      for (const cidr of this.parsedCidrs) {
        if (isIpInCidr(ip, cidr)) {
          return {
            allowed: false,
            reason: `IP ${ip} is in blocked range`,
            risk: 'HIGH' as RiskLevel,
          };
        }
      }

      return { allowed: true, risk: 'LOW' };
    }

    // Check IPv6
    if (isIP(ip) === 6) {
      const lower = ip.toLowerCase();
      // Loopback
      if (lower === '::1') {
        return { allowed: false, reason: 'IPv6 loopback blocked', risk: 'HIGH' };
      }
      // Link-local
      if (lower.startsWith('fe80:')) {
        return { allowed: false, reason: 'IPv6 link-local blocked', risk: 'HIGH' };
      }
      // Unique local (fc00::/7)
      if (lower.startsWith('fc') || lower.startsWith('fd')) {
        return { allowed: false, reason: 'IPv6 unique-local blocked', risk: 'HIGH' };
      }
      // IPv4-mapped IPv6 (::ffff:x.x.x.x)
      const v4Match = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (v4Match) {
        return this.checkIp(v4Match[1]);
      }

      return { allowed: true, risk: 'LOW' };
    }

    // Unknown format
    return { allowed: false, reason: `Unrecognized IP format: ${ip}`, risk: 'MEDIUM' };
  }

  /**
   * Get current config
   */
  getConfig(): SsrfGuardConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async resolveWithTimeout(hostname: string): Promise<string[]> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('DNS resolution timeout')), this.config.dnsResolutionTimeout);
    });

    const resolvePromise = dns.resolve4(hostname);
    return Promise.race([resolvePromise, timeoutPromise]);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function normalizeHostname(hostname: string): string {
  // Strip IPv6 brackets
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname.toLowerCase();
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SsrfGuard | null = null;

export function getSsrfGuard(): SsrfGuard | null {
  return instance;
}

export function createSsrfGuard(config?: Partial<SsrfGuardConfig>): SsrfGuard {
  instance = new SsrfGuard(config);
  return instance;
}

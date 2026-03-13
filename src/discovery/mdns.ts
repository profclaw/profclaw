/**
 * mDNS/DNS-SD Local Discovery
 *
 * Announces profClaw instance on the local network using multicast DNS.
 * Enables automatic discovery of profClaw nodes on the LAN.
 * Uses Node.js dgram (UDP) - no external dependencies.
 */

import { createSocket } from 'dgram';
import type { Socket } from 'dgram';
import { hostname, networkInterfaces } from 'os';
import { logger } from '../utils/logger.js';

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;

// DNS record type constants
const DNS_TYPE_A = 1;
const DNS_TYPE_PTR = 12;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_SRV = 33;
const DNS_CLASS_IN = 1;
const DNS_CACHE_FLUSH = 0x8000;

export interface MDNSConfig {
  serviceName?: string;
  serviceType?: string;
  port: number;
  instanceName?: string;
  txtRecords?: Record<string, string>;
}

interface DiscoveredNode {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  txt: Record<string, string>;
  lastSeen: number;
}

let socket: Socket | null = null;
let announceInterval: ReturnType<typeof setInterval> | null = null;
const discoveredNodes = new Map<string, DiscoveredNode>();

/**
 * Encode a DNS name (e.g. "_profclaw._tcp.local") into wire format
 */
function encodeName(name: string): Buffer {
  const parts = name.split('.');
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const len = Buffer.alloc(1);
    len.writeUInt8(part.length);
    buffers.push(len, Buffer.from(part, 'utf-8'));
  }
  buffers.push(Buffer.alloc(1)); // null terminator
  return Buffer.concat(buffers);
}

/**
 * Build an mDNS announcement packet
 */
function buildAnnouncementPacket(config: MDNSConfig): Buffer {
  const instanceName = config.instanceName || `profclaw-${hostname()}`;
  const serviceType = config.serviceType || '_profclaw._tcp.local';
  const fullName = `${instanceName}.${serviceType}`;
  const hostName = `${hostname()}.local`;

  // Header: ID=0, flags=0x8400 (response, authoritative), 0 questions, 4 answers
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x0000, 0); // ID
  header.writeUInt16BE(0x8400, 2); // Flags: response, authoritative
  header.writeUInt16BE(0, 4);      // Questions
  header.writeUInt16BE(4, 6);      // Answers (PTR + SRV + TXT + A)
  header.writeUInt16BE(0, 8);      // Authority
  header.writeUInt16BE(0, 10);     // Additional

  const records: Buffer[] = [header];

  // PTR record: serviceType -> fullName
  const ptrName = encodeName(serviceType);
  const ptrData = encodeName(fullName);
  const ptrRecord = Buffer.alloc(10);
  ptrRecord.writeUInt16BE(DNS_TYPE_PTR, 0);
  ptrRecord.writeUInt16BE(DNS_CLASS_IN, 2);
  ptrRecord.writeUInt32BE(4500, 4); // TTL: 75 minutes
  ptrRecord.writeUInt16BE(ptrData.length, 8);
  records.push(ptrName, ptrRecord, ptrData);

  // SRV record: fullName -> host:port
  const srvName = encodeName(fullName);
  const srvTarget = encodeName(hostName);
  const srvRecord = Buffer.alloc(16);
  srvRecord.writeUInt16BE(DNS_TYPE_SRV, 0);
  srvRecord.writeUInt16BE(DNS_CLASS_IN | DNS_CACHE_FLUSH, 2);
  srvRecord.writeUInt32BE(120, 4); // TTL: 2 minutes
  srvRecord.writeUInt16BE(srvTarget.length + 6, 8); // data length
  srvRecord.writeUInt16BE(0, 10);  // Priority
  srvRecord.writeUInt16BE(0, 12);  // Weight
  srvRecord.writeUInt16BE(config.port, 14);
  records.push(srvName, srvRecord, srvTarget);

  // TXT record
  const txtName = encodeName(fullName);
  const txtPairs: Buffer[] = [];
  const txt: Record<string, string> = {
    version: '2.0.0',
    mode: process.env.PROFCLAW_MODE ?? 'mini',
    ...config.txtRecords,
  };
  for (const [key, value] of Object.entries(txt)) {
    const pair = `${key}=${value}`;
    const pairBuf = Buffer.alloc(1 + pair.length);
    pairBuf.writeUInt8(pair.length, 0);
    pairBuf.write(pair, 1, 'utf-8');
    txtPairs.push(pairBuf);
  }
  const txtData = Buffer.concat(txtPairs);
  const txtRecord = Buffer.alloc(10);
  txtRecord.writeUInt16BE(DNS_TYPE_TXT, 0);
  txtRecord.writeUInt16BE(DNS_CLASS_IN | DNS_CACHE_FLUSH, 2);
  txtRecord.writeUInt32BE(4500, 4);
  txtRecord.writeUInt16BE(txtData.length, 8);
  records.push(txtName, txtRecord, txtData);

  // A record: hostname -> IP
  const aName = encodeName(hostName);
  const ip = getLocalIPv4();
  const ipParts = ip.split('.').map(Number);
  const aData = Buffer.from(ipParts);
  const aRecord = Buffer.alloc(10);
  aRecord.writeUInt16BE(DNS_TYPE_A, 0);
  aRecord.writeUInt16BE(DNS_CLASS_IN | DNS_CACHE_FLUSH, 2);
  aRecord.writeUInt32BE(120, 4);
  aRecord.writeUInt16BE(4, 8);
  records.push(aName, aRecord, aData);

  return Buffer.concat(records);
}

/**
 * Get the primary local IPv4 address
 */
function getLocalIPv4(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Handle incoming mDNS packet (discover other nodes)
 */
function handleIncomingPacket(msg: Buffer, sourceAddress: string): void {
  try {
    // Simple check: is this a profclaw announcement?
    const content = msg.toString('utf-8', 0, Math.min(msg.length, 512));
    if (!content.includes('_profclaw')) return;

    // Extract version and mode from TXT records (simplified parsing)
    const versionMatch = content.match(/version=([^\x00]+)/);
    const modeMatch = content.match(/mode=([^\x00]+)/);

    const existing = discoveredNodes.get(sourceAddress);

    discoveredNodes.set(sourceAddress, {
      name: existing?.name || `profclaw@${sourceAddress}`,
      host: sourceAddress,
      port: existing?.port || 3000,
      addresses: [sourceAddress],
      txt: {
        version: versionMatch?.[1] ?? 'unknown',
        mode: modeMatch?.[1] ?? 'unknown',
      },
      lastSeen: Date.now(),
    });

    logger.debug('[mDNS] Discovered node', { address: sourceAddress });
  } catch {
    // Ignore malformed packets
  }
}

/**
 * Start mDNS announcement
 */
export function startMDNS(config: MDNSConfig): void {
  if (socket) {
    logger.warn('[mDNS] Already running');
    return;
  }

  try {
    socket = createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      // Port 5353 often requires elevated permissions
      logger.warn('[mDNS] Socket error (may need elevated permissions)', { error: err.message });
      stopMDNS();
    });

    socket.on('listening', () => {
      try {
        socket?.addMembership(MDNS_ADDRESS);
        logger.info('[mDNS] Joined multicast group', { address: MDNS_ADDRESS, port: MDNS_PORT });
      } catch (err) {
        logger.warn('[mDNS] Failed to join multicast group', {
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }
    });

    socket.on('message', (msg, rinfo) => {
      handleIncomingPacket(msg, rinfo.address);
    });

    socket.bind(MDNS_PORT, () => {
      // Send initial announcement
      const packet = buildAnnouncementPacket(config);
      socket?.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS);

      // Re-announce every 60 seconds
      announceInterval = setInterval(() => {
        if (socket) {
          const pkt = buildAnnouncementPacket(config);
          socket.send(pkt, 0, pkt.length, MDNS_PORT, MDNS_ADDRESS);
        }
      }, 60_000);

      logger.info('[mDNS] Discovery started', {
        name: config.instanceName || `profclaw-${hostname()}`,
        port: config.port,
        ip: getLocalIPv4(),
      });
    });
  } catch (err) {
    logger.warn('[mDNS] Failed to start (non-fatal)', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

/**
 * Stop mDNS announcement
 */
export function stopMDNS(): void {
  if (announceInterval) {
    clearInterval(announceInterval);
    announceInterval = null;
  }
  if (socket) {
    try {
      socket.dropMembership(MDNS_ADDRESS);
    } catch {
      // Ignore - socket may already be closed
    }
    socket.close();
    socket = null;
    logger.info('[mDNS] Discovery stopped');
  }
}

/**
 * Get list of discovered profClaw nodes on the network
 */
export function getDiscoveredNodes(): DiscoveredNode[] {
  // Prune stale nodes (not seen in 5 minutes)
  const staleThreshold = Date.now() - 300_000;
  for (const [key, node] of discoveredNodes) {
    if (node.lastSeen < staleThreshold) {
      discoveredNodes.delete(key);
    }
  }

  return Array.from(discoveredNodes.values());
}

/**
 * Check if mDNS is currently running
 */
export function isMDNSRunning(): boolean {
  return socket !== null;
}

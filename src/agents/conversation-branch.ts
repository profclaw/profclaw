/**
 * Conversation Branching
 *
 * Allows forking a conversation at any turn to explore alternative paths.
 * Branches are persisted to .profclaw/branches/branches.json.
 * The transcript for the parent conversation is read from the existing
 * TranscriptStore (JSONL files at .profclaw/transcripts/).
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { TranscriptStore } from './transcript.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Branch {
  id: string;
  parentId: string;       // conversation (session) ID this was forked from
  forkTurnIndex: number;  // index of the turn we branched AT (0-based)
  title?: string;
  createdAt: number;
}

interface BranchMessage {
  role: string;
  content: string;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ConversationBrancher | null = null;

// ── Class ─────────────────────────────────────────────────────────────────────

export class ConversationBrancher {
  private branches: Map<string, Branch>;
  private branchDir: string;
  private transcriptStore: TranscriptStore;

  constructor(projectRoot?: string) {
    const root = projectRoot ?? process.cwd();
    this.branchDir = path.join(root, '.profclaw', 'branches');
    this.branches = new Map();
    this.transcriptStore = new TranscriptStore(root);
    this.load();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Fork a conversation at a specific turn index.
   * The new Branch records which turn we branched from so the caller
   * can replay context up to that point.
   */
  fork(conversationId: string, turnIndex: number, title?: string): Branch {
    const branch: Branch = {
      id: randomUUID(),
      parentId: conversationId,
      forkTurnIndex: turnIndex,
      title,
      createdAt: Date.now(),
    };

    this.branches.set(branch.id, branch);
    this.save();
    return branch;
  }

  /**
   * List all branches whose parentId matches `conversationId`,
   * sorted newest first.
   */
  listBranches(conversationId: string): Branch[] {
    return Array.from(this.branches.values())
      .filter(b => b.parentId === conversationId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Return the messages from the parent conversation up to (and including)
   * `branch.forkTurnIndex`. Only user/assistant entries are included.
   *
   * "Turn" here means a user+assistant exchange pair, so turn N covers
   * transcript entries 0..2N+1. We expose the raw forkTurnIndex as a
   * transcript entry index for simplicity.
   */
  getBaseMessages(branch: Branch): BranchMessage[] {
    const entries = this.transcriptStore.getSession(branch.parentId);

    const conversationEntries = entries.filter(
      e => e.type === 'user' || e.type === 'assistant',
    );

    const sliced = conversationEntries.slice(0, branch.forkTurnIndex + 1);

    return sliced.map(e => ({
      role: e.type === 'user' ? 'user' : 'assistant',
      content: e.content,
    }));
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  save(): void {
    this.ensureDir();
    const filePath = this.indexPath();
    const data = Array.from(this.branches.values());
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[ConversationBrancher] Failed to save branches:', err);
    }
  }

  load(): void {
    const filePath = this.indexPath();
    if (!fs.existsSync(filePath)) return;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as Branch[];
      this.branches = new Map(data.map(b => [b.id, b]));
    } catch (err) {
      console.error('[ConversationBrancher] Failed to load branches:', err);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private ensureDir(): void {
    if (!fs.existsSync(this.branchDir)) {
      fs.mkdirSync(this.branchDir, { recursive: true });
    }
  }

  private indexPath(): string {
    return path.join(this.branchDir, 'branches.json');
  }
}

/**
 * Returns the shared singleton ConversationBrancher instance.
 */
export function getConversationBrancher(): ConversationBrancher {
  if (!_instance) {
    _instance = new ConversationBrancher();
  }
  return _instance;
}

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import {
  eq,
  and,
  or,
  gte,
  lte,
  like,
  desc,
  asc,
  count,
  sql,
} from "drizzle-orm";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";

import type {
  StorageAdapter,
  TaskEventInput,
  TaskAnalytics,
  TaskFilterOptions,
} from "./adapter.js";
import * as schema from "./schema.js";
import type { Task, CreateTaskInput, TaskEvent } from "../types/task.js";
import type {
  Summary,
  CreateSummaryInput,
  SummaryQuery,
  SummaryStats,
} from "../types/summary.js";

export class LibSQLAdapter implements StorageAdapter {
  private db: any;
  private client: any;
  private readonly dbUrl: string;

  constructor(config: { dbPath?: string } = {}) {
    const dbPath =
      config.dbPath || path.resolve(process.cwd(), "data", "profclaw.db");
    this.dbUrl = `file:${dbPath}`;
  }

  async connect(): Promise<void> {
    const dbPath = this.dbUrl.replace("file:", "");
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir) && dbPath !== ":memory:") {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.client = createClient({ url: this.dbUrl });
    this.db = drizzle(this.client, { schema });

    // Ensure tables exist (POC auto-migration)
    await this.initDatabase();
  }

  private async initDatabase(): Promise<void> {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 3,
        source TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        repository TEXT,
        branch TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        assigned_agent TEXT,
        assigned_agent_id TEXT,
        ticket_id TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at INTEGER,
        completed_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        result TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3
      )
    `);

    // Phase 17: Add ticket_id column migration for existing databases
    try {
      await this.client.execute(`ALTER TABLE tasks ADD COLUMN ticket_id TEXT`);
    } catch {
      // Column already exists - ignore
    }

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id),
        session_id TEXT,
        agent TEXT NOT NULL,
        model TEXT,
        title TEXT NOT NULL,
        what_changed TEXT NOT NULL,
        why_changed TEXT,
        how_changed TEXT,
        files_changed TEXT NOT NULL DEFAULT '[]',
        decisions TEXT NOT NULL DEFAULT '[]',
        blockers TEXT NOT NULL DEFAULT '[]',
        artifacts TEXT NOT NULL DEFAULT '[]',
        tokens_used TEXT,
        cost TEXT,
        task_type TEXT,
        component TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        linked_issue TEXT,
        linked_pr TEXT,
        repository TEXT,
        branch TEXT,
        raw_output TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Summary blobs table for large raw output (Phase 17)
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS summary_blobs (
        id TEXT PRIMARY KEY,
        summary_id TEXT NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
        raw_output TEXT NOT NULL,
        compressed_size INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add has_blob_output column to summaries if it doesn't exist
    try {
      await this.client.execute(
        `ALTER TABLE summaries ADD COLUMN has_blob_output INTEGER DEFAULT 0`,
      );
    } catch (e) {
      // Column already exists, ignore
    }

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        is_secret INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        last_used_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS github_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        access_token TEXT NOT NULL,
        token_type TEXT NOT NULL DEFAULT 'pat',
        scopes TEXT,
        github_username TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL,
        agent_id TEXT,
        message TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS task_archives (
        id TEXT PRIMARY KEY,
        original_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        repository TEXT,
        branch TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        assigned_agent TEXT,
        assigned_agent_id TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        archived_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        result TEXT,
        metadata TEXT,
        duration_ms INTEGER
      )
    `);

    // === TICKET SYSTEM TABLES ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        workspace_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        description_html TEXT,
        type TEXT NOT NULL DEFAULT 'task',
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'backlog',
        labels TEXT NOT NULL DEFAULT '[]',
        assignee TEXT,
        assignee_agent TEXT,
        parent_id TEXT REFERENCES tickets(id),
        linked_prs TEXT NOT NULL DEFAULT '[]',
        linked_commits TEXT NOT NULL DEFAULT '[]',
        linked_branch TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at INTEGER,
        completed_at INTEGER,
        start_date INTEGER,
        due_date INTEGER,
        created_by TEXT NOT NULL DEFAULT 'human',
        ai_agent TEXT,
        ai_session_id TEXT,
        ai_task_id TEXT REFERENCES tasks(id),
        estimate INTEGER,
        estimate_unit TEXT
      )
    `);

    // Add start_date column to tickets if it doesn't exist
    try {
      await this.client.execute(
        `ALTER TABLE tickets ADD COLUMN start_date INTEGER`,
      );
    } catch {
      // Column already exists - ignore
    }

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_external_links (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_url TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 1,
        sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
        last_synced_at INTEGER,
        sync_error TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_comments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        content TEXT NOT NULL,
        content_html TEXT,
        author_type TEXT NOT NULL DEFAULT 'human',
        author_name TEXT NOT NULL,
        author_platform TEXT NOT NULL,
        author_avatar_url TEXT,
        source TEXT NOT NULL DEFAULT 'profclaw',
        external_id TEXT,
        is_ai_response INTEGER NOT NULL DEFAULT 0,
        responding_to TEXT REFERENCES ticket_comments(id),
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_relations (
        id TEXT PRIMARY KEY,
        source_ticket_id TEXT NOT NULL REFERENCES tickets(id),
        target_ticket_id TEXT NOT NULL REFERENCES tickets(id),
        relation_type TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_history (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by_type TEXT NOT NULL DEFAULT 'human',
        changed_by_name TEXT NOT NULL,
        changed_by_platform TEXT NOT NULL DEFAULT 'profclaw',
        timestamp INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_watchers (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_assignees (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_mentions (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_attachments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        file_name TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER,
        url TEXT NOT NULL,
        storage_path TEXT,
        uploaded_by TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_reactions (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_sequence (
        workspace_id TEXT PRIMARY KEY DEFAULT 'default',
        last_sequence INTEGER NOT NULL DEFAULT 0
      )
    `);

    // === PROJECTS & SPRINTS TABLES ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        workspace_id TEXT DEFAULT 'default',
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '📋',
        color TEXT DEFAULT '#6366f1',
        default_assignee TEXT,
        default_agent TEXT,
        default_labels TEXT DEFAULT '[]',
        cycle_view INTEGER DEFAULT 1,
        board_view INTEGER DEFAULT 1,
        lead TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at INTEGER
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS project_sequence (
        workspace_id TEXT PRIMARY KEY DEFAULT 'default',
        last_sequence INTEGER NOT NULL DEFAULT 0
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS states (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6B7280',
        description TEXT,
        state_group TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        sequence INTEGER NOT NULL DEFAULT 65535,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS project_external_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_url TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 1,
        sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
        last_synced_at INTEGER,
        sync_error TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS sprints (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        goal TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'planning',
        start_date INTEGER,
        end_date INTEGER,
        capacity INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at INTEGER
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS sprint_sequence (
        project_id TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL DEFAULT 0
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS sprint_tickets (
        id TEXT PRIMARY KEY,
        sprint_id TEXT NOT NULL REFERENCES sprints(id),
        ticket_id TEXT NOT NULL REFERENCES tickets(id),
        sort_order INTEGER DEFAULT 0,
        added_at INTEGER DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // === USER AUTHENTICATION TABLES ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER DEFAULT 0,
        password_hash TEXT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        bio TEXT,
        timezone TEXT DEFAULT 'UTC',
        locale TEXT DEFAULT 'en',
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at INTEGER,
        onboarding_completed INTEGER DEFAULT 0,
        recovery_codes TEXT,
        password_reset_token TEXT,
        password_reset_expires INTEGER
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        provider_username TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type TEXT DEFAULT 'bearer',
        scope TEXT,
        expires_at INTEGER,
        provider_data TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        user_agent TEXT,
        ip_address TEXT,
        device_name TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at INTEGER NOT NULL,
        last_active_at INTEGER DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        theme TEXT DEFAULT 'system',
        accent_color TEXT DEFAULT '#6366f1',
        font_size TEXT DEFAULT 'medium',
        email_notifications INTEGER DEFAULT 1,
        push_notifications INTEGER DEFAULT 1,
        notify_on_mention INTEGER DEFAULT 1,
        notify_on_assign INTEGER DEFAULT 1,
        notify_on_comment INTEGER DEFAULT 0,
        default_agent TEXT DEFAULT 'claude',
        ai_auto_suggest INTEGER DEFAULT 1,
        ai_response_length TEXT DEFAULT 'balanced',
        editor_mode TEXT DEFAULT 'markdown',
        tab_size INTEGER DEFAULT 2,
        extra_settings TEXT DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS user_api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        scopes TEXT DEFAULT '["read"]',
        last_used_at INTEGER,
        usage_count INTEGER DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at INTEGER
      )
    `);

    // === LABELS SYSTEM TABLES ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS labels (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        name TEXT NOT NULL,
        description TEXT,
        color TEXT NOT NULL DEFAULT '#6B7280',
        parent_id TEXT REFERENCES labels(id),
        sort_order INTEGER NOT NULL DEFAULT 65535,
        external_source TEXT,
        external_id TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ticket_labels (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        added_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // === GITHUB SYNC TRACKING TABLES ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS github_repository_syncs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        repository_id INTEGER NOT NULL,
        repository_name TEXT NOT NULL,
        owner TEXT NOT NULL,
        default_branch TEXT DEFAULT 'main',
        sync_issues INTEGER NOT NULL DEFAULT 1,
        sync_prs INTEGER NOT NULL DEFAULT 0,
        auto_label_id TEXT REFERENCES labels(id),
        last_sync_at INTEGER,
        last_sync_status TEXT NOT NULL DEFAULT 'idle',
        last_sync_error TEXT,
        items_synced INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS github_comment_syncs (
        id TEXT PRIMARY KEY,
        ticket_external_link_id TEXT NOT NULL REFERENCES ticket_external_links(id),
        comment_id TEXT NOT NULL REFERENCES ticket_comments(id),
        github_comment_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // === CRON / SCHEDULED JOBS TABLES ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cron_expression TEXT,
        interval_ms INTEGER,
        run_at INTEGER,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        event_trigger TEXT,
        job_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        template_id TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        delivery TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        user_id TEXT,
        project_id TEXT,
        created_by TEXT NOT NULL DEFAULT 'human',
        last_run_at INTEGER,
        last_run_status TEXT,
        last_run_error TEXT,
        last_run_duration_ms INTEGER,
        next_run_at INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        max_runs INTEGER,
        max_failures INTEGER,
        expires_at INTEGER,
        retry_on_failure INTEGER NOT NULL DEFAULT 1,
        retry_delay_ms INTEGER DEFAULT 60000,
        retry_backoff_multiplier INTEGER DEFAULT 2,
        retry_max_delay_ms INTEGER DEFAULT 3600000,
        current_retry_count INTEGER DEFAULT 0,
        delete_on_complete INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at INTEGER
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS job_run_history (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT,
        triggered_by TEXT NOT NULL DEFAULT 'schedule',
        event_data TEXT
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS job_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT 'zap',
        category TEXT NOT NULL DEFAULT 'custom',
        user_id TEXT,
        project_id TEXT,
        job_type TEXT NOT NULL,
        payload_template TEXT NOT NULL,
        suggested_cron TEXT,
        suggested_interval_ms INTEGER,
        default_retry_policy TEXT,
        default_delivery TEXT,
        is_built_in INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS dead_letter_tasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        repository TEXT,
        branch TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        assigned_agent TEXT,
        priority INTEGER NOT NULL DEFAULT 3,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        last_error_code TEXT NOT NULL,
        last_error_message TEXT NOT NULL,
        last_error_stack TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_retry_at INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_at INTEGER,
        resolved_by TEXT,
        resolution_note TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        task_created_at INTEGER,
        task_started_at INTEGER
      )
    `);

    // === AGENT SESSIONS TABLES (Phase 23) ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT REFERENCES agent_sessions(id),
        conversation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        goal TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        depth INTEGER NOT NULL DEFAULT 0,
        current_step INTEGER NOT NULL DEFAULT 0,
        max_steps INTEGER NOT NULL DEFAULT 20,
        used_budget INTEGER NOT NULL DEFAULT 0,
        max_budget INTEGER NOT NULL DEFAULT 20000,
        final_result TEXT,
        stop_reason TEXT,
        allowed_tools TEXT,
        disallowed_tools TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        from_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        to_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        type TEXT NOT NULL DEFAULT 'message',
        subject TEXT,
        content TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'pending',
        reply_to_message_id TEXT REFERENCES session_messages(id),
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        delivered_at INTEGER,
        read_at INTEGER
      )
    `);

    // Invite codes table (invite-only registration)
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        used_by TEXT,
        used_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        label TEXT
      )
    `);

    // In-app notifications table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'info',
        category TEXT NOT NULL DEFAULT 'system',
        entity_type TEXT,
        entity_id TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)
    `);

    // Add new columns to scheduled_jobs if they don't exist
    try {
      await this.client.execute(
        `ALTER TABLE scheduled_jobs ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'`,
      );
    } catch (e) {
      // Column already exists, ignore
    }
    try {
      await this.client.execute(
        `ALTER TABLE scheduled_jobs ADD COLUMN archived_at INTEGER`,
      );
    } catch (e) {
      // Column already exists, ignore
    }
    try {
      await this.client.execute(
        `ALTER TABLE scheduled_jobs ADD COLUMN last_run_duration_ms INTEGER`,
      );
    } catch (e) {
      // Column already exists, ignore
    }
    try {
      await this.client.execute(
        `ALTER TABLE scheduled_jobs ADD COLUMN retry_delay_ms INTEGER DEFAULT 60000`,
      );
    } catch (e) {
      // Column already exists, ignore
    }

    // Create indexes for task_events
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events(type)
    `);

    // Create index for task→ticket relationship (Phase 17)
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_tasks_ticket_id ON tasks(ticket_id)
    `);

    // Create indexes for summary_blobs (Phase 17)
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_summary_blobs_summary_id ON summary_blobs(summary_id)
    `);

    // Create indexes for tickets
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_assignee_agent ON tickets(assignee_agent)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_external_links_ticket_id ON ticket_external_links(ticket_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_external_links_platform ON ticket_external_links(platform, external_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments(ticket_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket_id ON ticket_history(ticket_id)
    `);

    // Create indexes for projects
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects(workspace_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_project_external_links_project_id ON project_external_links(project_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_project_external_links_platform ON project_external_links(platform, external_id)
    `);

    // Create indexes for sprints
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sprints_project_id ON sprints(project_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sprint_tickets_sprint_id ON sprint_tickets(sprint_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sprint_tickets_ticket_id ON sprint_tickets(ticket_id)
    `);

    // Create indexes for users/auth
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON oauth_accounts(provider, provider_account_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id)
    `);

    // Add project_id column to tickets table if it doesn't exist
    try {
      await this.client.execute(
        `ALTER TABLE tickets ADD COLUMN project_id TEXT REFERENCES projects(id)`,
      );
    } catch (e) {
      // Column already exists, ignore
    }
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_project_id ON tickets(project_id)
    `);

    // Create indexes for labels
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_labels_project_id ON labels(project_id)
    `);
    await this.client.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_name_project ON labels(project_id, name) WHERE project_id IS NOT NULL
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_labels_ticket_id ON ticket_labels(ticket_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_labels_label_id ON ticket_labels(label_id)
    `);
    await this.client.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_labels_unique ON ticket_labels(ticket_id, label_id)
    `);

    // Create indexes for GitHub sync
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_github_repo_syncs_project_id ON github_repository_syncs(project_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_github_comment_syncs_link_id ON github_comment_syncs(ticket_external_link_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_github_comment_syncs_github_id ON github_comment_syncs(github_comment_id)
    `);

    // Create indexes for scheduled_jobs
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_job_type ON scheduled_jobs(job_type)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_job_run_history_job_id ON job_run_history(job_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_job_run_history_status ON job_run_history(status)
    `);
    // Composite index for efficient count queries (Phase 17: enables computing counts instead of storing)
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_job_run_history_job_status ON job_run_history(job_id, status)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_job_templates_category ON job_templates(category)
    `);

    // Create indexes for states/relations
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_states_project_id ON states(project_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_relations_source ON ticket_relations(source_ticket_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_ticket_relations_target ON ticket_relations(target_ticket_id)
    `);

    // Create indexes for agent sessions
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent ON agent_sessions(parent_session_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation ON agent_sessions(conversation_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_session_messages_to ON session_messages(to_session_id)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_session_messages_status ON session_messages(status)
    `);

    // Create indexes for DLQ
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_status ON dead_letter_tasks(status)
    `);
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_task_id ON dead_letter_tasks(task_id)
    `);

    // === EXPERIENCE STORE (Phase 19, Category 5) ===

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        intent TEXT NOT NULL,
        solution TEXT NOT NULL,
        success_score REAL NOT NULL DEFAULT 1.0,
        tags TEXT NOT NULL DEFAULT '[]',
        source_conversation_id TEXT NOT NULL DEFAULT '',
        user_id TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 1,
        weight REAL NOT NULL DEFAULT 1.0
      )
    `);
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS idx_experiences_type ON experiences(type)`,
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS idx_experiences_intent ON experiences(intent)`,
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS idx_experiences_user ON experiences(user_id)`,
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS idx_experiences_weight ON experiences(weight)`,
    );
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }

  // === Tasks ===

  async createTask(input: CreateTaskInput): Promise<Task> {
    const id = (input as any).id || randomUUID();
    const now = new Date();

    const newTask = {
      ...input,
      id,
      status: (input as any).status || "pending",
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      maxAttempts: 3,
    };

    await this.db.insert(schema.tasks).values(newTask);
    return newTask as Task;
  }

  async getTask(id: string): Promise<Task | null> {
    const results = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));
    return (results[0] as Task) || null;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const now = new Date();
    await this.db
      .update(schema.tasks)
      .set({ ...updates, updatedAt: now })
      .where(eq(schema.tasks.id, id));

    const updated = await this.getTask(id);
    if (!updated) throw new Error(`Task ${id} not found after update`);
    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.tasks)
      .where(eq(schema.tasks.id, id));
    // LibSQL results might be different from better-sqlite3
    return true;
  }

  async getTasks(query?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<{ tasks: Task[]; total: number }> {
    let whereClause = undefined;
    if (query?.status) {
      whereClause = eq(schema.tasks.status, query.status);
    }

    const tasks = await this.db
      .select()
      .from(schema.tasks)
      .where(whereClause)
      .limit(query?.limit || 50)
      .offset(query?.offset || 0)
      .orderBy(desc(schema.tasks.createdAt));

    const totalRes = await this.db
      .select({ value: count() })
      .from(schema.tasks)
      .where(whereClause);

    return {
      tasks: tasks as Task[],
      total: totalRes[0].value,
    };
  }

  // === Summaries ===

  async createSummary(input: CreateSummaryInput): Promise<Summary> {
    const id = randomUUID();
    const now = new Date();

    // Extract rawOutput to store separately in blob table
    const { rawOutput, ...summaryData } = input;
    const hasBlob = !!rawOutput && rawOutput.length > 0;

    const newSummary: typeof schema.summaries.$inferInsert = {
      ...summaryData,
      id,
      createdAt: now,
      filesChanged: input.filesChanged || [],
      decisions: input.decisions || [],
      blockers: input.blockers || [],
      artifacts: input.artifacts || [],
      labels: input.labels || [],
      hasBlobOutput: hasBlob,
      rawOutput: null, // Don't store in main table anymore
    };

    await this.db.insert(schema.summaries).values(newSummary);

    // Store raw output in separate blob table
    if (hasBlob && rawOutput) {
      await this.db.insert(schema.summaryBlobs).values({
        id: randomUUID(),
        summaryId: id,
        rawOutput,
        compressedSize: rawOutput.length, // Future: actual compressed size
        createdAt: now,
      });
    }

    return { ...newSummary, createdAt: now, rawOutput: undefined } as Summary;
  }

  async getSummary(
    id: string,
    includeRawOutput = false,
  ): Promise<Summary | null> {
    const results = await this.db
      .select()
      .from(schema.summaries)
      .where(eq(schema.summaries.id, id));
    const summary = results[0] as Summary | undefined;

    if (!summary) return null;

    // Fetch raw output from blob table if requested
    if (includeRawOutput && summary.hasBlobOutput) {
      const blob = await this.db
        .select()
        .from(schema.summaryBlobs)
        .where(eq(schema.summaryBlobs.summaryId, id))
        .limit(1);

      if (blob[0]) {
        return { ...summary, rawOutput: blob[0].rawOutput } as Summary;
      }
    }

    // Strip rawOutput from response if not requested (for backward compat with old data)
    if (!includeRawOutput) {
      return { ...summary, rawOutput: undefined } as Summary;
    }

    return summary;
  }

  /**
   * Get raw output for a summary (lazy loading)
   */
  async getSummaryRawOutput(summaryId: string): Promise<string | null> {
    // First check blob table (new storage)
    const blob = await this.db
      .select()
      .from(schema.summaryBlobs)
      .where(eq(schema.summaryBlobs.summaryId, summaryId))
      .limit(1);

    if (blob[0]) {
      return blob[0].rawOutput;
    }

    // Fallback to inline rawOutput for old summaries
    const summary = await this.db
      .select({ rawOutput: schema.summaries.rawOutput })
      .from(schema.summaries)
      .where(eq(schema.summaries.id, summaryId))
      .limit(1);

    return summary[0]?.rawOutput || null;
  }

  async getTaskSummaries(taskId: string): Promise<Summary[]> {
    return await this.db
      .select()
      .from(schema.summaries)
      .where(eq(schema.summaries.taskId, taskId))
      .orderBy(desc(schema.summaries.createdAt));
  }

  async querySummaries(
    query: Partial<SummaryQuery>,
  ): Promise<{ summaries: Summary[]; total: number }> {
    const conditions = [];

    if (query.taskId)
      conditions.push(eq(schema.summaries.taskId, query.taskId));
    if (query.sessionId)
      conditions.push(eq(schema.summaries.sessionId, query.sessionId));
    if (query.agent) conditions.push(eq(schema.summaries.agent, query.agent));
    if (query.taskType)
      conditions.push(eq(schema.summaries.taskType, query.taskType));
    if (query.component)
      conditions.push(eq(schema.summaries.component, query.component));
    if (query.repository)
      conditions.push(eq(schema.summaries.repository, query.repository));

    if (query.from)
      conditions.push(gte(schema.summaries.createdAt, query.from));
    if (query.to) conditions.push(lte(schema.summaries.createdAt, query.to));

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      conditions.push(
        sql`(${schema.summaries.title} LIKE ${searchPattern} OR ${schema.summaries.whatChanged} LIKE ${searchPattern} OR ${schema.summaries.whyChanged} LIKE ${searchPattern} OR ${schema.summaries.howChanged} LIKE ${searchPattern} OR ${schema.summaries.rawOutput} LIKE ${searchPattern})`,
      );
    }

    // Cursor-based pagination (Phase 17)
    if (query.cursorCreatedAt && query.cursorId) {
      const cursorTime = query.cursorCreatedAt;
      const cursorId = query.cursorId;
      const isDesc = query.sortOrder !== "asc";

      if (isDesc) {
        conditions.push(
          or(
            sql`${schema.summaries.createdAt} < ${cursorTime}`,
            and(
              sql`${schema.summaries.createdAt} = ${cursorTime}`,
              sql`${schema.summaries.id} < ${cursorId}`,
            ),
          ),
        );
      } else {
        conditions.push(
          or(
            sql`${schema.summaries.createdAt} > ${cursorTime}`,
            and(
              sql`${schema.summaries.createdAt} = ${cursorTime}`,
              sql`${schema.summaries.id} > ${cursorId}`,
            ),
          ),
        );
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const useCursor = !!(query.cursorCreatedAt && query.cursorId);

    // When using cursor, don't use offset (cursor already filters)
    const summaries = useCursor
      ? await this.db
          .select()
          .from(schema.summaries)
          .where(whereClause)
          .limit(query.limit || 50)
          .orderBy(
            query.sortOrder === "asc"
              ? asc(schema.summaries.createdAt)
              : desc(schema.summaries.createdAt),
          )
      : await this.db
          .select()
          .from(schema.summaries)
          .where(whereClause)
          .limit(query.limit || 50)
          .offset(query.offset || 0)
          .orderBy(
            query.sortOrder === "asc"
              ? asc(schema.summaries.createdAt)
              : desc(schema.summaries.createdAt),
          );

    const totalRes = await this.db
      .select({ value: count() })
      .from(schema.summaries)
      .where(whereClause);

    return {
      summaries: summaries as Summary[],
      total: totalRes[0].value,
    };
  }

  async deleteSummary(id: string): Promise<boolean> {
    await this.db.delete(schema.summaries).where(eq(schema.summaries.id, id));
    return true;
  }

  async getSummaryStats(): Promise<SummaryStats> {
    // 1. Get totals and counts using SQL aggregation (Phase 17 optimization)
    const [counts] = await this.db
      .select({
        totalCount: count(),
        totalTokens: sql<number>`SUM(CAST(json_extract(${schema.summaries.tokensUsed}, '$.total') AS INTEGER))`,
        totalCost: sql<number>`SUM(CAST(json_extract(${schema.summaries.cost}, '$.amount') AS REAL))`,
      })
      .from(schema.summaries);

    // 2. Get distributions
    const agentStats = await this.db
      .select({
        agent: schema.summaries.agent,
        count: count(),
      })
      .from(schema.summaries)
      .groupBy(schema.summaries.agent);

    const typeStats = await this.db
      .select({
        type: schema.summaries.taskType,
        count: count(),
      })
      .from(schema.summaries)
      .groupBy(schema.summaries.taskType);

    const componentStats = await this.db
      .select({
        component: schema.summaries.component,
        count: count(),
      })
      .from(schema.summaries)
      .groupBy(schema.summaries.component);

    // 3. Get files changed count (requires custom SQL for JSON array length)
    const [filesRes] = await this.db
      .select({
        totalFiles: sql<number>`SUM(json_array_length(${schema.summaries.filesChanged}))`,
      })
      .from(schema.summaries);

    const byAgent: Record<string, number> = {};
    agentStats.forEach((s: { agent: string; count: number }) => {
      byAgent[s.agent] = s.count;
    });

    const byTaskType: Record<string, number> = {};
    typeStats.forEach((s: { type: string | null; count: number }) => {
      if (s.type) byTaskType[s.type] = s.count;
    });

    const byComponent: Record<string, number> = {};
    componentStats.forEach((s: { component: string | null; count: number }) => {
      if (s.component) byComponent[s.component] = s.count;
    });

    return {
      totalCount: counts.totalCount || 0,
      byAgent,
      byTaskType,
      byComponent,
      totalTokens: Number(counts.totalTokens || 0),
      totalCost: Number(counts.totalCost || 0),
      averageDuration: 0,
      filesChangedCount: Number(filesRes.totalFiles || 0),
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.client.execute("SELECT 1");
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  async getAgentStats(): Promise<
    Record<
      string,
      {
        completed: number;
        failed: number;
        avgDuration: number;
        lastActivity?: Date;
      }
    >
  > {
    const results = await this.db
      .select({
        agent: schema.tasks.assignedAgent,
        status: schema.tasks.status,
        count: count(),
        avgDuration: sql<number>`AVG(${schema.tasks.completedAt} - ${schema.tasks.startedAt})`,
        lastActivity: sql<number>`MAX(${schema.tasks.updatedAt})`,
      })
      .from(schema.tasks)
      .where(sql`${schema.tasks.assignedAgent} IS NOT NULL`)
      .groupBy(schema.tasks.assignedAgent, schema.tasks.status);

    const stats: Record<string, any> = {};
    for (const row of results as any[]) {
      if (!row.agent) continue;
      if (!stats[row.agent]) {
        stats[row.agent] = {
          completed: 0,
          failed: 0,
          avgDuration: 0,
          lastActivity: null,
        };
      }
      if (row.status === "completed") {
        stats[row.agent].completed = row.count;
        stats[row.agent].avgDuration = row.avgDuration || 0;
      } else if (row.status === "failed") {
        stats[row.agent].failed = row.count;
      }

      if (row.lastActivity) {
        const lastActivity = new Date(row.lastActivity);
        if (
          !stats[row.agent].lastActivity ||
          lastActivity > stats[row.agent].lastActivity
        ) {
          stats[row.agent].lastActivity = lastActivity;
        }
      }
    }
    return stats;
  }

  async getCostAnalytics(): Promise<{
    daily: Array<{ date: string; cost: number; tokens: number }>;
    byModel: Record<string, { cost: number; tokens: number }>;
    byAgent: Record<string, { cost: number; tokens: number }>;
    totalCost: number;
    totalTokens: number;
  }> {
    const daily: Record<string, { cost: number; tokens: number }> = {};
    const byModel: Record<string, { cost: number; tokens: number }> = {};
    const byAgent: Record<string, { cost: number; tokens: number }> = {};
    let totalCost = 0;
    let totalTokens = 0;

    // Helper to accumulate into the aggregation maps
    const accumulate = (date: string, model: string, agent: string, cost: number, tokens: number) => {
      totalCost += cost;
      totalTokens += tokens;

      if (!daily[date]) daily[date] = { cost: 0, tokens: 0 };
      daily[date].cost += cost;
      daily[date].tokens += tokens;

      if (!byModel[model]) byModel[model] = { cost: 0, tokens: 0 };
      byModel[model].cost += cost;
      byModel[model].tokens += tokens;

      if (!byAgent[agent]) byAgent[agent] = { cost: 0, tokens: 0 };
      byAgent[agent].cost += cost;
      byAgent[agent].tokens += tokens;
    };

    // Source 1: Summaries table (queue task results)
    const all = await this.db.select().from(schema.summaries);
    for (const s of all) {
      if (!s.createdAt) continue;
      const date = s.createdAt.toISOString().split("T")[0];
      const model = s.model || "unknown";
      const agent = s.agent || "unknown";
      const cost = (s.cost as any)?.amount || 0;
      const tokens = (s.tokensUsed as any)?.total || 0;
      accumulate(date, model, agent, cost, tokens);
    }

    // Source 2: Conversation messages (chat/agentic sessions)
    try {
      const chatRows = await this.client.execute(
        `SELECT created_at, model, total_tokens, prompt_tokens, completion_tokens, cost
         FROM conversation_messages
         WHERE total_tokens > 0 AND role = 'assistant'`
      );
      for (const row of chatRows.rows) {
        const createdAt = row.created_at as string | null;
        if (!createdAt) continue;
        const date = createdAt.split("T")[0];
        const model = (row.model as string) || "unknown";
        const tokens = Number(row.total_tokens) || 0;
        const cost = Number(row.cost) || 0;
        accumulate(date, model, "chat", cost, tokens);
      }
    } catch {
      // conversation_messages table may not exist yet — skip silently
    }

    const dailyArray = Object.entries(daily)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      daily: dailyArray,
      byModel,
      byAgent,
      totalCost,
      totalTokens,
    };
  }

  // === Vector Search ===

  async storeEmbedding(
    id: string,
    entityType: "task" | "summary",
    entityId: string,
    embedding: number[],
    model: string,
  ): Promise<void> {
    // Convert float array to Buffer/Uint8Array for blob storage
    const float32Array = new Float32Array(embedding);
    const buffer = Buffer.from(float32Array.buffer);

    await this.db.insert(schema.embeddings).values({
      id,
      entityType,
      entityId,
      embedding: buffer as any,
      model,
      createdAt: new Date(),
    });
  }

  async searchSimilar(
    entityType: "task" | "summary",
    embedding: number[],
    limit = 5,
  ): Promise<Array<{ entityId: string; distance: number }>> {
    // Basic implementation: fetch all embeddings of that type and compute cosine similarity in-memory
    // In Phase 10.3 we would use sqlite-vec or libsql vector search if available.
    const allEmbeddings = await this.db
      .select()
      .from(schema.embeddings)
      .where(eq(schema.embeddings.entityType, entityType));

    if (allEmbeddings.length === 0) return [];

    const targetVector = new Float32Array(embedding);

    const results = allEmbeddings.map((row: any) => {
      const rowVector = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      );
      const distance = this.cosineSimilarity(targetVector, rowVector);
      return {
        entityId: row.entityId,
        distance,
      };
    });

    // Sort by descending similarity (1.0 is identical)
    results.sort((a: any, b: any) => b.distance - a.distance);

    return results.slice(0, limit);
  }

  private cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    return norm === 0 ? 0 : dotProduct / norm;
  }

  // === Generic SQL Operations ===

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.client.execute({
      sql,
      args: params || [],
    });
    return result.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.client.execute({
      sql,
      args: params || [],
    });
  }

  // === Task Events (Audit Log) ===

  async recordTaskEvent(event: TaskEventInput): Promise<void> {
    const id = randomUUID();
    await this.db.insert(schema.taskEvents).values({
      id,
      taskId: event.taskId,
      type: event.type,
      agentId: event.agentId,
      message: event.message,
      metadata: event.metadata,
      timestamp: new Date(),
    });
  }

  async getTaskEvents(taskId: string): Promise<TaskEvent[]> {
    const results = await this.db
      .select()
      .from(schema.taskEvents)
      .where(eq(schema.taskEvents.taskId, taskId))
      .orderBy(asc(schema.taskEvents.timestamp));

    return results.map((row: any) => ({
      id: row.id,
      taskId: row.taskId,
      type: row.type,
      timestamp: row.timestamp,
      agentId: row.agentId,
      message: row.message,
      metadata: row.metadata,
    }));
  }

  // === Task Analytics ===

  async getTaskAnalytics(): Promise<TaskAnalytics> {
    const allTasks = await this.db.select().from(schema.tasks);

    // Initialize counters
    const byStatus: Record<string, number> = {};
    const byPriority: Record<number, number> = {};
    const bySource: Record<string, number> = {};
    const byAgent: Record<
      string,
      {
        count: number;
        completed: number;
        failed: number;
        totalDuration: number;
      }
    > = {};
    const daily: Record<
      string,
      { created: number; completed: number; failed: number }
    > = {};

    let totalDuration = 0;
    let durationCount = 0;
    let minDuration = Infinity;
    let maxDuration = 0;
    let recentCompletions = 0;
    let recentFailures = 0;

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    for (const task of allTasks) {
      // Status counts
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;

      // Priority counts
      byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;

      // Source counts
      bySource[task.source] = (bySource[task.source] || 0) + 1;

      // Agent stats
      if (task.assignedAgent) {
        if (!byAgent[task.assignedAgent]) {
          byAgent[task.assignedAgent] = {
            count: 0,
            completed: 0,
            failed: 0,
            totalDuration: 0,
          };
        }
        byAgent[task.assignedAgent].count++;
        if (task.status === "completed")
          byAgent[task.assignedAgent].completed++;
        if (task.status === "failed") byAgent[task.assignedAgent].failed++;

        // Duration for this agent
        if (task.startedAt && task.completedAt) {
          const startTime =
            task.startedAt instanceof Date
              ? task.startedAt.getTime()
              : new Date(task.startedAt).getTime();
          const endTime =
            task.completedAt instanceof Date
              ? task.completedAt.getTime()
              : new Date(task.completedAt).getTime();
          const duration = endTime - startTime;
          if (duration > 0) {
            byAgent[task.assignedAgent].totalDuration += duration;
          }
        }
      }

      // Duration stats
      if (task.startedAt && task.completedAt) {
        const startTime =
          task.startedAt instanceof Date
            ? task.startedAt.getTime()
            : new Date(task.startedAt).getTime();
        const endTime =
          task.completedAt instanceof Date
            ? task.completedAt.getTime()
            : new Date(task.completedAt).getTime();
        const duration = endTime - startTime;
        if (duration > 0) {
          totalDuration += duration;
          durationCount++;
          minDuration = Math.min(minDuration, duration);
          maxDuration = Math.max(maxDuration, duration);
        }
      }

      // Daily stats (last 30 days)
      const createdTime =
        task.createdAt instanceof Date
          ? task.createdAt.getTime()
          : new Date(task.createdAt).getTime();
      if (createdTime >= thirtyDaysAgo) {
        const dateStr = new Date(createdTime).toISOString().split("T")[0];
        if (!daily[dateStr])
          daily[dateStr] = { created: 0, completed: 0, failed: 0 };
        daily[dateStr].created++;
      }

      if (task.completedAt) {
        const completedTime =
          task.completedAt instanceof Date
            ? task.completedAt.getTime()
            : new Date(task.completedAt).getTime();
        if (completedTime >= thirtyDaysAgo) {
          const dateStr = new Date(completedTime).toISOString().split("T")[0];
          if (!daily[dateStr])
            daily[dateStr] = { created: 0, completed: 0, failed: 0 };
          if (task.status === "completed") {
            daily[dateStr].completed++;
            if (completedTime >= oneDayAgo) recentCompletions++;
          } else if (task.status === "failed") {
            daily[dateStr].failed++;
            if (completedTime >= oneDayAgo) recentFailures++;
          }
        }
      }
    }

    const totalTasks = allTasks.length;
    const completedTasks = byStatus["completed"] || 0;
    const failedTasks = byStatus["failed"] || 0;
    const pendingTasks = (byStatus["pending"] || 0) + (byStatus["queued"] || 0);
    const inProgressTasks =
      (byStatus["in_progress"] || 0) + (byStatus["assigned"] || 0);
    const cancelledTasks = byStatus["cancelled"] || 0;

    const successRate =
      totalTasks > 0
        ? (completedTasks / (completedTasks + failedTasks)) * 100
        : 0;

    // Convert byAgent to expected format
    const byAgentFormatted: Record<
      string,
      { count: number; successRate: number; avgDurationMs: number }
    > = {};
    for (const [agent, stats] of Object.entries(byAgent)) {
      const total = stats.completed + stats.failed;
      byAgentFormatted[agent] = {
        count: stats.count,
        successRate: total > 0 ? (stats.completed / total) * 100 : 0,
        avgDurationMs:
          stats.completed > 0 ? stats.totalDuration / stats.completed : 0,
      };
    }

    // Convert daily to array
    const dailyArray = Object.entries(daily)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      pendingTasks,
      inProgressTasks,
      cancelledTasks,
      successRate: Number.isNaN(successRate)
        ? 0
        : Math.round(successRate * 100) / 100,
      avgDurationMs:
        durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      minDurationMs: minDuration === Infinity ? 0 : minDuration,
      maxDurationMs: maxDuration,
      byStatus,
      byPriority,
      bySource,
      byAgent: byAgentFormatted,
      daily: dailyArray,
      recentCompletions,
      recentFailures,
    };
  }

  // === Advanced Task Filtering ===

  async getTasksFiltered(
    options: TaskFilterOptions,
  ): Promise<{ tasks: Task[]; total: number }> {
    const conditions = [];

    // Status filter (supports array)
    if (options.status) {
      if (Array.isArray(options.status)) {
        conditions.push(
          sql`${schema.tasks.status} IN (${sql.join(
            options.status.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      } else {
        conditions.push(eq(schema.tasks.status, options.status));
      }
    }

    // Priority filter (supports array)
    if (options.priority !== undefined) {
      if (Array.isArray(options.priority)) {
        conditions.push(
          sql`${schema.tasks.priority} IN (${sql.join(
            options.priority.map((p) => sql`${p}`),
            sql`, `,
          )})`,
        );
      } else {
        conditions.push(eq(schema.tasks.priority, options.priority));
      }
    }

    // Source filter (supports array)
    if (options.source) {
      if (Array.isArray(options.source)) {
        conditions.push(
          sql`${schema.tasks.source} IN (${sql.join(
            options.source.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        );
      } else {
        conditions.push(eq(schema.tasks.source, options.source));
      }
    }

    // Agent filter
    if (options.agent) {
      conditions.push(eq(schema.tasks.assignedAgent, options.agent));
    }

    // Repository filter
    if (options.repository) {
      conditions.push(eq(schema.tasks.repository, options.repository));
    }

    // Date range filters
    if (options.createdAfter) {
      conditions.push(gte(schema.tasks.createdAt, options.createdAfter));
    }
    if (options.createdBefore) {
      conditions.push(lte(schema.tasks.createdAt, options.createdBefore));
    }
    if (options.completedAfter) {
      conditions.push(gte(schema.tasks.completedAt, options.completedAfter));
    }
    if (options.completedBefore) {
      conditions.push(lte(schema.tasks.completedAt, options.completedBefore));
    }

    // Labels filter (JSON array contains)
    if (options.labels && options.labels.length > 0) {
      for (const label of options.labels) {
        conditions.push(sql`${schema.tasks.labels} LIKE ${`%"${label}"%`}`);
      }
    }

    // Text search
    if (options.searchQuery) {
      const searchPattern = `%${options.searchQuery}%`;
      conditions.push(
        sql`(${schema.tasks.title} LIKE ${searchPattern} OR ${schema.tasks.description} LIKE ${searchPattern} OR ${schema.tasks.prompt} LIKE ${searchPattern})`,
      );
    }

    // Cursor-based pagination (Phase 17)
    // When cursor is provided, filter for items "after" the cursor
    if (options.cursorCreatedAt && options.cursorId) {
      const cursorTime = options.cursorCreatedAt;
      const cursorId = options.cursorId;
      const isDesc = options.sortOrder !== "asc";

      if (isDesc) {
        conditions.push(
          or(
            sql`${schema.tasks.createdAt} < ${cursorTime}`,
            and(
              sql`${schema.tasks.createdAt} = ${cursorTime}`,
              sql`${schema.tasks.id} < ${cursorId}`,
            ),
          ),
        );
      } else {
        conditions.push(
          or(
            sql`${schema.tasks.createdAt} > ${cursorTime}`,
            and(
              sql`${schema.tasks.createdAt} = ${cursorTime}`,
              sql`${schema.tasks.id} > ${cursorId}`,
            ),
          ),
        );
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Determine sort column and order
    let orderByColumn: any = schema.tasks.createdAt;
    if (options.sortBy === "updatedAt") orderByColumn = schema.tasks.updatedAt;
    else if (options.sortBy === "priority")
      orderByColumn = schema.tasks.priority;
    else if (options.sortBy === "completedAt")
      orderByColumn = schema.tasks.completedAt;

    const orderFn = options.sortOrder === "asc" ? asc : desc;
    const useCursor = !!(options.cursorCreatedAt && options.cursorId);

    // When using cursor, don't use offset (cursor already filters)
    const tasks = useCursor
      ? await this.db
          .select()
          .from(schema.tasks)
          .where(whereClause)
          .limit(options.limit || 50)
          .orderBy(orderFn(orderByColumn))
      : await this.db
          .select()
          .from(schema.tasks)
          .where(whereClause)
          .limit(options.limit || 50)
          .offset(options.offset || 0)
          .orderBy(orderFn(orderByColumn));

    const totalRes = await this.db
      .select({ value: count() })
      .from(schema.tasks)
      .where(whereClause);

    return {
      tasks: tasks as Task[],
      total: Number(totalRes[0]?.value ?? 0),
    };
  }

  // === Task Archival ===

  async archiveOldTasks(olderThanDays: number): Promise<{ archived: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Find tasks to archive (completed or failed, older than cutoff)
    const tasksToArchive = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.status} IN ('completed', 'failed', 'cancelled')`,
          lte(schema.tasks.completedAt, cutoffDate),
        ),
      );

    let archived = 0;

    for (const task of tasksToArchive) {
      // Calculate duration
      let durationMs: number | null = null;
      if (task.startedAt && task.completedAt) {
        const startTime =
          task.startedAt instanceof Date
            ? task.startedAt.getTime()
            : new Date(task.startedAt as any).getTime();
        const endTime =
          task.completedAt instanceof Date
            ? task.completedAt.getTime()
            : new Date(task.completedAt as any).getTime();
        durationMs = endTime - startTime;
      }

      // Insert into archive
      await this.db.insert(schema.taskArchives).values({
        id: randomUUID(),
        originalId: task.id,
        title: task.title,
        description: task.description,
        prompt: task.prompt,
        status: task.status,
        priority: task.priority,
        source: task.source,
        sourceId: task.sourceId,
        sourceUrl: task.sourceUrl,
        repository: task.repository,
        branch: task.branch,
        labels: task.labels,
        assignedAgent: task.assignedAgent,
        assignedAgentId: task.assignedAgentId,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        archivedAt: new Date(),
        result: task.result,
        metadata: task.metadata,
        durationMs,
      });

      // Delete from tasks table
      await this.db.delete(schema.tasks).where(eq(schema.tasks.id, task.id));
      archived++;
    }

    return { archived };
  }

  async getArchivedTasks(options: {
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: Task[]; total: number }> {
    const archived = await this.db
      .select()
      .from(schema.taskArchives)
      .limit(options.limit || 50)
      .offset(options.offset || 0)
      .orderBy(desc(schema.taskArchives.archivedAt));

    const totalRes = await this.db
      .select({ value: count() })
      .from(schema.taskArchives);

    // Map archived tasks back to Task format
    const tasks = archived.map((a: any) => ({
      id: a.originalId,
      title: a.title,
      description: a.description,
      prompt: a.prompt,
      status: a.status,
      priority: a.priority,
      source: a.source,
      sourceId: a.sourceId,
      sourceUrl: a.sourceUrl,
      repository: a.repository,
      branch: a.branch,
      labels: a.labels || [],
      assignedAgent: a.assignedAgent,
      assignedAgentId: a.assignedAgentId,
      createdAt: a.createdAt,
      updatedAt: a.createdAt,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      result: a.result,
      metadata: a.metadata || {},
      attempts: 0,
      maxAttempts: 3,
      _archived: true,
      _archivedAt: a.archivedAt,
      _durationMs: a.durationMs,
    }));

    return {
      tasks: tasks as Task[],
      total: totalRes[0].value,
    };
  }
}

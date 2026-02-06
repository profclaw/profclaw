/**
 * Slack Integration Routes
 *
 * Handles:
 * - Slash commands (/glinr task list, /glinr ticket create, etc.)
 * - Interactive components (button clicks, modals)
 * - Event subscriptions (optional)
 */

import { Hono } from "hono";
import { createHmac, timingSafeEqual, randomUUID } from "crypto";
import { getDb } from "../storage/index.js";
import { tickets, projects } from "../storage/schema.js";
import { eq, desc, and, like } from "drizzle-orm";

const slack = new Hono();

// Configuration
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_COMMAND_NAME = (process.env.SLACK_COMMAND_NAME || "glinr")
  .replace(/^\/+/, "")
  .trim();
const SLACK_SLASH_EPHEMERAL = process.env.SLACK_SLASH_EPHEMERAL !== "false";
const SLACK_APP_URL = process.env.SLACK_APP_URL || "http://localhost:5173";
const SLACK_ALLOWED_USER_IDS = (process.env.SLACK_ALLOWED_USER_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SLACK_ALLOWED_CHANNEL_IDS = (process.env.SLACK_ALLOWED_CHANNEL_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// =============================================================================
// TYPES
// =============================================================================

interface SlackSlashCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  api_app_id: string;
}

interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

interface SlackBlockElement {
  type: string;
  text?: string | SlackTextObject;
  action_id?: string;
  value?: string;
  style?: string;
}

interface SlackBlock {
  type: string;
  text?: SlackTextObject;
  fields?: Array<{ type: string; text: string }>;
  elements?: SlackBlockElement[];
  accessory?: { type: string; action_id?: string; text?: SlackTextObject };
}

interface SlackResponse {
  response_type?: "in_channel" | "ephemeral";
  text?: string;
  blocks?: SlackBlock[];
  attachments?: Array<{ color?: string; blocks?: SlackBlock[] }>;
}

type SlackResponseType = NonNullable<SlackResponse["response_type"]>;

type SlackPostOptions = {
  channelId: string;
  userId?: string;
  response: SlackResponse;
  ephemeral?: boolean;
};

const INLINE_COMMANDS = new Set(["status", "help", "commands", "whoami", "id"]);

// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string,
): boolean {
  if (!signingSecret || !signature || !timestamp) return false;

  // Check timestamp is within 5 minutes
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    console.warn("[Slack] Request timestamp too old");
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature = `v0=${createHmac("sha256", signingSecret)
    .update(sigBasestring)
    .digest("hex")}`;

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

// =============================================================================
// COMMAND PARSER
// =============================================================================

interface ParsedCommand {
  action: string;
  subAction?: string;
  args: Record<string, string>;
  rawArgs: string[];
}

function parseCommand(text: string): ParsedCommand {
  const parts = text.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase() || "help";
  const subAction = parts[1]?.toLowerCase();
  const rawArgs = parts.slice(2);

  // Parse named args like --title="My Task" or key=value
  const args: Record<string, string> = {};
  let currentKey = "";
  const currentValue = "";

  for (const part of rawArgs) {
    if (part.startsWith("--")) {
      // --key=value or --key "value"
      const [key, ...valueParts] = part.slice(2).split("=");
      if (valueParts.length > 0) {
        args[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
      } else {
        currentKey = key;
      }
    } else if (currentKey) {
      args[currentKey] = part.replace(/^["']|["']$/g, "");
      currentKey = "";
    } else if (part.includes("=")) {
      const [key, ...valueParts] = part.split("=");
      args[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
    }
  }

  return { action, subAction, args, rawArgs };
}

function resolveDefaultResponseType(): SlackResponseType {
  return SLACK_SLASH_EPHEMERAL ? "ephemeral" : "in_channel";
}

function normalizeSlackCommandName(raw: string): string {
  return raw.replace(/^\/+/, "").trim().toLowerCase();
}

function isAllowedSlackSender(params: {
  userId: string;
  channelId: string;
}): boolean {
  const userAllowed =
    SLACK_ALLOWED_USER_IDS.length === 0 ||
    SLACK_ALLOWED_USER_IDS.includes(params.userId);
  const channelAllowed =
    SLACK_ALLOWED_CHANNEL_IDS.length === 0 ||
    SLACK_ALLOWED_CHANNEL_IDS.includes(params.channelId);
  return userAllowed && channelAllowed;
}

function extractInlineCommand(text: string): string | null {
  if (!text) {
    return null;
  }
  const match = text.match(/\/(\w+)/);
  if (!match) {
    return null;
  }
  const command = match[1]?.toLowerCase() ?? "";
  return INLINE_COMMANDS.has(command) ? command : null;
}

async function postSlackResponse(options: SlackPostOptions): Promise<void> {
  if (!SLACK_BOT_TOKEN) {
    console.warn("[Slack] Missing SLACK_BOT_TOKEN for inline command response");
    return;
  }

  const url =
    options.ephemeral && options.userId
      ? "https://slack.com/api/chat.postEphemeral"
      : "https://slack.com/api/chat.postMessage";

  const payload: Record<string, unknown> = {
    channel: options.channelId,
    text: options.response.text ?? "",
  };

  if (options.response.blocks) {
    payload.blocks = options.response.blocks;
  }
  if (options.response.attachments) {
    payload.attachments = options.response.attachments;
  }
  if (options.ephemeral && options.userId) {
    payload.user = options.userId;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.warn(`[Slack] Failed to post response: ${res.status}`);
  }
}

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

async function handleHelp(): Promise<SlackResponse> {
  const commandLabel = `/${SLACK_COMMAND_NAME}`;
  return {
    response_type: resolveDefaultResponseType(),
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🎯 GLINR Commands", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Ticket Commands:*\n" +
            `• \`${commandLabel} ticket list\` - List recent tickets\n` +
            `• \`${commandLabel} ticket create --title="Bug" --priority=high\` - Create ticket\n` +
            `• \`${commandLabel} ticket show GLINR-123\` - Show ticket details\n` +
            `• \`${commandLabel} ticket search <query>\` - Search tickets\n`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Project Commands:*\n" +
            `• \`${commandLabel} project list\` - List projects\n` +
            `• \`${commandLabel} project show MOBILE\` - Show project details\n`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Other Commands:*\n" +
            `• \`${commandLabel} status\` - System health status\n` +
            `• \`${commandLabel} whoami\` - Show your Slack identity\n` +
            `• \`${commandLabel} commands\` - Show this help\n`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 Use `--help` after any command for details",
          },
        ],
      },
    ],
  };
}

async function handleCommands(): Promise<SlackResponse> {
  return handleHelp();
}

async function handleTicketList(
  args: Record<string, string>,
): Promise<SlackResponse> {
  const db = getDb();
  if (!db) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Database not available",
    };
  }

  try {
    const limit = parseInt(args.limit || "5", 10);
    const status = args.status;

    let query = db
      .select()
      .from(tickets)
      .orderBy(desc(tickets.createdAt))
      .limit(limit);

    if (status) {
      query = db
        .select()
        .from(tickets)
        .where(eq(tickets.status, status))
        .orderBy(desc(tickets.createdAt))
        .limit(limit);
    }

    const results = await query;

    if (results.length === 0) {
      return {
        response_type: resolveDefaultResponseType(),
        text: "📭 No tickets found",
      };
    }

    const ticketBlocks: SlackBlock[] = results.map(
      (t: typeof tickets.$inferSelect) => ({
        type: "section",
        text: {
          type: "mrkdwn" as const,
          text:
            `*GLINR-${t.sequence}* ${getStatusEmoji(t.status)} ${t.title}\n` +
            `Priority: ${getPriorityEmoji(t.priority)} | Status: \`${t.status}\``,
        },
      }),
    );

    return {
      response_type: SLACK_SLASH_EPHEMERAL ? "ephemeral" : "in_channel",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📋 Recent Tickets (${results.length})`,
            emoji: true,
          },
        },
        ...ticketBlocks,
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `🔗 <${SLACK_APP_URL}/tickets|View all in GLINR>`,
            },
          ],
        },
      ],
    };
  } catch (error) {
    console.error("[Slack] Error listing tickets:", error);
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Failed to list tickets",
    };
  }
}

async function handleTicketCreate(
  args: Record<string, string>,
  userId: string,
  userName: string,
): Promise<SlackResponse> {
  const commandLabel = `/${SLACK_COMMAND_NAME}`;
  const db = getDb();
  if (!db) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Database not available",
    };
  }

  const title = args.title;
  if (!title) {
    return {
      response_type: resolveDefaultResponseType(),
      text: `❌ Title required. Usage: \`${commandLabel} ticket create --title="Bug fix" --priority=high\``,
    };
  }

  try {
    // Get next sequence number
    const lastTicket = await db
      .select({ sequence: tickets.sequence })
      .from(tickets)
      .orderBy(desc(tickets.sequence))
      .limit(1);

    const nextSequence = (lastTicket[0]?.sequence || 0) + 1;

    // Map priority
    const priorityMap: Record<string, string> = {
      urgent: "urgent",
      high: "high",
      medium: "medium",
      low: "low",
      none: "none",
    };
    const priority =
      priorityMap[args.priority?.toLowerCase() || "medium"] || "medium";

    // Map type
    const typeMap: Record<string, string> = {
      bug: "bug",
      feature: "feature",
      task: "task",
      improvement: "improvement",
      epic: "epic",
    };
    const type = typeMap[args.type?.toLowerCase() || "task"] || "task";

    const ticketId = randomUUID();
    const now = new Date();

    await db.insert(tickets).values({
      id: ticketId,
      sequence: nextSequence,
      title,
      description: args.description || "",
      status: "backlog",
      priority,
      type,
      createdBy: `slack:${userId}`,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    });

    return {
      response_type: SLACK_SLASH_EPHEMERAL ? "ephemeral" : "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `✅ *Ticket Created:* GLINR-${nextSequence}\n*${title}*\n` +
              `Priority: ${getPriorityEmoji(priority)} \`${priority}\` | Type: \`${type}\``,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Created by <@${userId}> • <${SLACK_APP_URL}/tickets/${ticketId}|View in GLINR>`,
            },
          ],
        },
      ],
    };
  } catch (error) {
    console.error("[Slack] Error creating ticket:", error);
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Failed to create ticket",
    };
  }
}

async function handleTicketShow(ticketRef: string): Promise<SlackResponse> {
  const db = getDb();
  if (!db) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Database not available",
    };
  }

  const sequenceMatch = ticketRef.match(/(\d+)/);
  if (!sequenceMatch) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Invalid ticket reference. Use GLINR-123 or just 123",
    };
  }

  const sequence = parseInt(sequenceMatch[1], 10);

  try {
    const result = await db
      .select()
      .from(tickets)
      .where(eq(tickets.sequence, sequence))
      .limit(1);

    if (result.length === 0) {
      return {
        response_type: resolveDefaultResponseType(),
        text: `❌ Ticket GLINR-${sequence} not found`,
      };
    }

    const t = result[0];

    return {
      response_type: SLACK_SLASH_EPHEMERAL ? "ephemeral" : "in_channel",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `GLINR-${t.sequence}: ${t.title}`,
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Status:*\n${getStatusEmoji(t.status)} ${t.status}`,
            },
            {
              type: "mrkdwn",
              text: `*Priority:*\n${getPriorityEmoji(t.priority)} ${t.priority}`,
            },
            { type: "mrkdwn", text: `*Type:*\n${t.type}` },
            {
              type: "mrkdwn",
              text: `*Created:*\n<!date^${Math.floor(new Date(t.createdAt).getTime() / 1000)}^{date_short}|${t.createdAt}>`,
            },
          ],
        },
        ...(t.description
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `*Description:*\n${t.description.slice(0, 500)}${t.description.length > 500 ? "..." : ""}`,
                },
              },
            ]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🔗 Open in GLINR" },
              action_id: "open_ticket",
              value: t.id,
            },
          ],
        },
      ],
    };
  } catch (error) {
    console.error("[Slack] Error showing ticket:", error);
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Failed to fetch ticket",
    };
  }
}

async function handleTicketSearch(query: string): Promise<SlackResponse> {
  const db = getDb();
  if (!db) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Database not available",
    };
  }

  if (!query) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Search query required",
    };
  }

  try {
    const results = await db
      .select()
      .from(tickets)
      .where(like(tickets.title, `%${query}%`))
      .orderBy(desc(tickets.updatedAt))
      .limit(10);

    if (results.length === 0) {
      return {
        response_type: resolveDefaultResponseType(),
        text: `📭 No tickets matching "${query}"`,
      };
    }

    const ticketBlocks: SlackBlock[] = results.map(
      (t: typeof tickets.$inferSelect) => ({
        type: "section",
        text: {
          type: "mrkdwn" as const,
          text: `*GLINR-${t.sequence}* ${getStatusEmoji(t.status)} ${t.title}`,
        },
      }),
    );

    return {
      response_type: resolveDefaultResponseType(),
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🔍 Search Results (${results.length})`,
            emoji: true,
          },
        },
        ...ticketBlocks,
      ],
    };
  } catch (error) {
    console.error("[Slack] Error searching tickets:", error);
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Failed to search tickets",
    };
  }
}

async function handleProjectList(): Promise<SlackResponse> {
  const db = getDb();
  if (!db) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Database not available",
    };
  }

  try {
    const results = await db
      .select()
      .from(projects)
      .where(eq(projects.status, "active"))
      .orderBy(desc(projects.createdAt))
      .limit(10);

    if (results.length === 0) {
      return {
        response_type: resolveDefaultResponseType(),
        text: "📭 No projects found",
      };
    }

    const projectBlocks: SlackBlock[] = results.map(
      (p: typeof projects.$inferSelect) => ({
        type: "section",
        text: {
          type: "mrkdwn" as const,
          text: `*${p.icon || "📁"} ${p.key}* - ${p.name}\n${p.description || "_No description_"}`,
        },
      }),
    );

    return {
      response_type: SLACK_SLASH_EPHEMERAL ? "ephemeral" : "in_channel",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `📂 Projects (${results.length})`,
            emoji: true,
          },
        },
        ...projectBlocks,
      ],
    };
  } catch (error) {
    console.error("[Slack] Error listing projects:", error);
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Failed to list projects",
    };
  }
}

async function handleProjectShow(projectKey: string): Promise<SlackResponse> {
  const commandLabel = `/${SLACK_COMMAND_NAME}`;
  const db = getDb();
  if (!db) {
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Database not available",
    };
  }

  if (!projectKey) {
    return {
      response_type: resolveDefaultResponseType(),
      text: `❌ Project key required. Usage: \`${commandLabel} project show GLINR\``,
    };
  }

  const normalizedKey = projectKey.toUpperCase();

  try {
    const results = await db
      .select()
      .from(projects)
      .where(eq(projects.key, normalizedKey))
      .limit(1);

    if (results.length === 0) {
      return {
        response_type: resolveDefaultResponseType(),
        text: `❌ Project ${normalizedKey} not found`,
      };
    }

    const project = results[0];

    return {
      response_type: SLACK_SLASH_EPHEMERAL ? "ephemeral" : "in_channel",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${project.icon || "📁"} ${project.key}: ${project.name}`,
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Status:*\n${project.status}` },
            { type: "mrkdwn", text: `*Key:*\n${project.key}` },
            {
              type: "mrkdwn",
              text: `*Created:*\n<!date^${Math.floor(
                new Date(project.createdAt).getTime() / 1000,
              )}^{date_short}|${project.createdAt}>`,
            },
            {
              type: "mrkdwn",
              text: `*Updated:*\n<!date^${Math.floor(
                new Date(project.updatedAt).getTime() / 1000,
              )}^{date_short}|${project.updatedAt}>`,
            },
          ],
        },
        ...(project.description
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `*Description:*\n${project.description}`,
                },
              },
            ]
          : []),
      ],
    };
  } catch (error) {
    console.error("[Slack] Error showing project:", error);
    return {
      response_type: resolveDefaultResponseType(),
      text: "❌ Failed to fetch project",
    };
  }
}

async function handleWhoAmI(
  command: SlackSlashCommand,
): Promise<SlackResponse> {
  return {
    response_type: resolveDefaultResponseType(),
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "👤 Slack Identity", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*User:*\n<@${command.user_id}>` },
          { type: "mrkdwn", text: `*User ID:*\n${command.user_id}` },
          {
            type: "mrkdwn",
            text: `*Channel:*\n${command.channel_name || "unknown"}`,
          },
          { type: "mrkdwn", text: `*Channel ID:*\n${command.channel_id}` },
          {
            type: "mrkdwn",
            text: `*Team:*\n${command.team_domain || "unknown"}`,
          },
          {
            type: "mrkdwn",
            text: `*Team ID:*\n${command.team_id || "unknown"}`,
          },
        ],
      },
    ],
  };
}

async function handleStatus(): Promise<SlackResponse> {
  // Basic health check
  const db = getDb();
  const dbStatus = db ? "✅ Connected" : "❌ Disconnected";

  return {
    response_type: resolveDefaultResponseType(),
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🏥 GLINR Status", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Database:*\n${dbStatus}` },
          { type: "mrkdwn", text: `*API:*\n✅ Running` },
          { type: "mrkdwn", text: `*Version:*\n0.1.0` },
          {
            type: "mrkdwn",
            text: `*Uptime:*\n${formatUptime(process.uptime())}`,
          },
        ],
      },
    ],
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    backlog: "📋",
    todo: "📝",
    in_progress: "🔄",
    in_review: "👀",
    done: "✅",
    cancelled: "❌",
  };
  return emojis[status] || "❓";
}

function getPriorityEmoji(priority: string): string {
  const emojis: Record<string, string> = {
    urgent: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🟢",
    none: "⚪",
  };
  return emojis[priority] || "⚪";
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/slack/commands
 * Handle incoming slash commands from Slack
 */
slack.post("/commands", async (c) => {
  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header("x-slack-signature") || "";
  const timestamp = c.req.header("x-slack-request-timestamp") || "";

  // Verify signature
  if (SLACK_SIGNING_SECRET) {
    const isValid = verifySlackSignature(
      SLACK_SIGNING_SECRET,
      signature,
      timestamp,
      rawBody,
    );
    if (!isValid) {
      console.warn("[Slack] Invalid signature");
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // Parse form data
  const params = new URLSearchParams(rawBody);
  const command: SlackSlashCommand = {
    token: params.get("token") || "",
    team_id: params.get("team_id") || "",
    team_domain: params.get("team_domain") || "",
    channel_id: params.get("channel_id") || "",
    channel_name: params.get("channel_name") || "",
    user_id: params.get("user_id") || "",
    user_name: params.get("user_name") || "",
    command: params.get("command") || "",
    text: params.get("text") || "",
    response_url: params.get("response_url") || "",
    trigger_id: params.get("trigger_id") || "",
    api_app_id: params.get("api_app_id") || "",
  };

  console.log(
    `[Slack] Command: ${command.command} ${command.text} from @${command.user_name}`,
  );

  const commandName = normalizeSlackCommandName(command.command);
  if (commandName !== SLACK_COMMAND_NAME.toLowerCase()) {
    return c.json({ error: "Unknown command" }, 404);
  }

  if (
    !isAllowedSlackSender({
      userId: command.user_id,
      channelId: command.channel_id,
    })
  ) {
    return c.json({
      response_type: resolveDefaultResponseType(),
      text: "🚫 You are not authorized to use this command.",
    });
  }

  // Parse command
  const parsed = parseCommand(command.text);
  let response: SlackResponse;

  try {
    switch (parsed.action) {
      case "ticket":
      case "t":
        switch (parsed.subAction) {
          case "list":
          case "ls":
            response = await handleTicketList(parsed.args);
            break;
          case "create":
          case "new":
            response = await handleTicketCreate(
              parsed.args,
              command.user_id,
              command.user_name,
            );
            break;
          case "show":
          case "view":
            response = await handleTicketShow(parsed.rawArgs[0] || "");
            break;
          case "search":
          case "find":
            response = await handleTicketSearch(parsed.rawArgs.join(" "));
            break;
          default:
            response = {
              response_type: resolveDefaultResponseType(),
              text: "❓ Unknown ticket command. Try: `list`, `create`, `show`, `search`",
            };
        }
        break;

      case "project":
      case "p":
        switch (parsed.subAction) {
          case "list":
          case "ls":
            response = await handleProjectList();
            break;
          case "show":
          case "view":
            response = await handleProjectShow(parsed.rawArgs[0] || "");
            break;
          default:
            response = {
              response_type: resolveDefaultResponseType(),
              text: "❓ Unknown project command. Try: `list`, `show`",
            };
        }
        break;

      case "status":
        response = await handleStatus();
        break;

      case "whoami":
      case "id":
        response = await handleWhoAmI(command);
        break;

      case "commands":
        response = await handleCommands();
        break;

      case "help":
      default:
        response = await handleHelp();
    }
  } catch (error) {
    console.error("[Slack] Command error:", error);
    response = {
      response_type: resolveDefaultResponseType(),
      text: "❌ An error occurred processing your command",
    };
  }

  return c.json(response);
});

/**
 * POST /api/slack/interactive
 * Handle interactive components (button clicks, modals)
 */
slack.post("/interactive", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-slack-signature") || "";
  const timestamp = c.req.header("x-slack-request-timestamp") || "";

  // Verify signature
  if (SLACK_SIGNING_SECRET) {
    const isValid = verifySlackSignature(
      SLACK_SIGNING_SECRET,
      signature,
      timestamp,
      rawBody,
    );
    if (!isValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // Parse payload
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload") || "{}";
  const payload = JSON.parse(payloadStr);

  console.log(
    `[Slack] Interactive: ${payload.type} - ${payload.actions?.[0]?.action_id}`,
  );

  // Handle different interaction types
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id === "open_ticket") {
      const ticketId = String(action.value || "");
      if (!ticketId) {
        return c.json({
          response_type: resolveDefaultResponseType(),
          text: "❌ Missing ticket reference",
        });
      }
      return c.json({
        response_type: resolveDefaultResponseType(),
        text: `🔗 <${SLACK_APP_URL}/tickets/${ticketId}|Open ticket in GLINR>`,
      });
    }
  }

  return c.json({ ok: true });
});

/**
 * POST /api/slack/events
 * Handle Slack Events API (URL verification, basic event ack)
 */
slack.post("/events", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-slack-signature") || "";
  const timestamp = c.req.header("x-slack-request-timestamp") || "";

  if (SLACK_SIGNING_SECRET) {
    const isValid = verifySlackSignature(
      SLACK_SIGNING_SECRET,
      signature,
      timestamp,
      rawBody,
    );
    if (!isValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  let payload: { type?: string; challenge?: string } | null = null;
  try {
    payload = JSON.parse(rawBody) as { type?: string; challenge?: string };
  } catch {
    return c.json({ error: "Invalid payload" }, 400);
  }

  if (payload?.type === "url_verification" && payload.challenge) {
    return c.json({ challenge: payload.challenge });
  }

  if (payload?.type === "event_callback") {
    const event = (payload as { event?: Record<string, unknown> }).event ?? {};
    const eventType = String(event.type ?? "");
    const subtype = event.subtype ? String(event.subtype) : "";
    const text = typeof event.text === "string" ? event.text : "";
    const userId = typeof event.user === "string" ? event.user : "";
    const channelId = typeof event.channel === "string" ? event.channel : "";

    if (eventType === "message" && !subtype && userId && channelId) {
      if (!isAllowedSlackSender({ userId, channelId })) {
        return c.json({ ok: true });
      }
      const inlineCommand = extractInlineCommand(text);
      if (inlineCommand) {
        let response: SlackResponse | null = null;
        if (inlineCommand === "status") {
          response = await handleStatus();
        } else if (inlineCommand === "help") {
          response = await handleHelp();
        } else if (inlineCommand === "commands") {
          response = await handleCommands();
        } else if (inlineCommand === "whoami" || inlineCommand === "id") {
          response = await handleWhoAmI({
            token: "",
            team_id: "",
            team_domain: "",
            channel_id: channelId,
            channel_name: "",
            user_id: userId,
            user_name: "",
            command: "",
            text: "",
            response_url: "",
            trigger_id: "",
            api_app_id: "",
          });
        }

        if (response) {
          await postSlackResponse({
            channelId,
            userId,
            response,
            ephemeral: true,
          });
        }
      }
    }
  }

  return c.json({ ok: true });
});

/**
 * GET /api/slack/status
 * Check Slack integration status
 */
slack.get("/status", async (c) => {
  return c.json({
    configured: !!SLACK_SIGNING_SECRET,
    botConfigured: !!SLACK_BOT_TOKEN,
    features: {
      slashCommands: true,
      commandName: `/${SLACK_COMMAND_NAME}`,
      ephemeral: SLACK_SLASH_EPHEMERAL,
      allowlistUsers: SLACK_ALLOWED_USER_IDS.length,
      allowlistChannels: SLACK_ALLOWED_CHANNEL_IDS.length,
      interactiveComponents: true,
      notifications: !!process.env.SLACK_WEBHOOK_URL,
    },
  });
});

export { slack as slackRoutes };

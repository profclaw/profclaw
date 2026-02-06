import { Hono } from "hono";
import { validateFileUpload, FILE_SIZE_LIMITS, sanitizeFilename } from "../utils/security.js";
import {
  createTicket,
  getTicket,
  getTicketWithRelations,
  updateTicket,
  deleteTicket,
  queryTickets,
  createExternalLink,
  getExternalLinks,
  createTicketRelation,
  getTicketRelations,
  deleteTicketRelation,
  addTicketWatcher,
  removeTicketWatcher,
  getTicketWatchers,
  addTicketAssignee,
  removeTicketAssignee,
  getTicketAssignees,
  addTicketMention,
  getTicketMentions,
  addTicketAttachment,
  getTicketAttachments,
  deleteTicketAttachment,
  addTicketReaction,
  getTicketReactions,
  deleteTicketReaction,
  bulkUpdateTickets,
  bulkDeleteTickets,
  addComment,
  getComments,
  getHistory,
  CreateTicketSchema,
  UpdateTicketSchema,
  BulkUpdateTicketsSchema,
  BulkDeleteTicketsSchema,
  TicketQuerySchema,
  TicketRelationType,
} from "../tickets/index.js";

const ticketsRouter = new Hono();

// === List/Query Tickets ===

// Sparse fieldset: default fields for list view (Phase 17 optimization)
const LIST_FIELDS = [
  "id",
  "sequence",
  "projectId",
  "title",
  "type",
  "priority",
  "status",
  "labels",
  "assignee",
  "assigneeAgent",
  "createdAt",
  "updatedAt",
  "startDate",
  "dueDate",
  "estimate",
  "estimateUnit",
  "createdBy",
] as const;

// Helper to pick only specified fields from an object
function pickFields<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly string[],
): Partial<T> {
  const result: Partial<T> = {};
  for (const field of fields) {
    if (field in obj) {
      (result as Record<string, unknown>)[field] = obj[field];
    }
  }
  return result;
}

// Cursor-based pagination helpers (Phase 17)
interface CursorData {
  createdAt: number;
  id: string;
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const data = JSON.parse(json);
    if (typeof data.createdAt === "number" && typeof data.id === "string") {
      return data as CursorData;
    }
    return null;
  } catch {
    return null;
  }
}

function getNextCursor<
  T extends { id: string; createdAt?: Date | number | string },
>(items: T[], limit: number): string | null {
  if (items.length < limit) return null; // No more pages
  const lastItem = items[items.length - 1];
  if (!lastItem?.createdAt) return null;

  const createdAt =
    lastItem.createdAt instanceof Date
      ? lastItem.createdAt.getTime()
      : typeof lastItem.createdAt === "string"
        ? new Date(lastItem.createdAt).getTime()
        : lastItem.createdAt;

  return encodeCursor({ createdAt, id: lastItem.id });
}

ticketsRouter.get("/", async (c) => {
  const queryParams: Record<string, unknown> = {};

  // Parse query params
  const projectId = c.req.query("projectId");
  const sprintId = c.req.query("sprintId");
  const inBacklog = c.req.query("inBacklog");
  const status = c.req.query("status");
  const type = c.req.query("type");
  const priority = c.req.query("priority");
  const assignee = c.req.query("assignee");
  const assigneeAgent = c.req.query("assigneeAgent");
  const parentId = c.req.query("parentId");
  const search = c.req.query("search") || c.req.query("q");
  const createdBy = c.req.query("createdBy");
  const label = c.req.query("label");
  const labels = c.req.query("labels");
  const sortBy = c.req.query("sortBy");
  const sortOrder = c.req.query("sortOrder");
  const limit = c.req.query("limit");
  const offset = c.req.query("offset");

  // Cursor-based pagination (Phase 17) - takes precedence over offset
  const cursor = c.req.query("cursor");
  const cursorData = cursor ? decodeCursor(cursor) : null;

  // Sparse fieldset support (Phase 17)
  const fieldsParam = c.req.query("fields"); // Comma-separated field names
  const sparseFields = fieldsParam
    ? fieldsParam.split(",").map((f) => f.trim())
    : null;
  const includeFull = c.req.query("full") === "true"; // Backward compat: return full objects

  // Project/Sprint filtering
  if (projectId) queryParams.projectId = projectId;
  if (sprintId) queryParams.sprintId = sprintId;
  if (inBacklog === "true") queryParams.inBacklog = true;

  if (status)
    queryParams.status = status.includes(",") ? status.split(",") : status;
  if (type) queryParams.type = type.includes(",") ? type.split(",") : type;
  if (priority)
    queryParams.priority = priority.includes(",")
      ? priority.split(",")
      : priority;
  if (assignee) queryParams.assignee = assignee;
  if (assigneeAgent) queryParams.assigneeAgent = assigneeAgent;
  if (parentId) queryParams.parentId = parentId;
  if (search) queryParams.search = search;
  if (createdBy === "human" || createdBy === "ai")
    queryParams.createdBy = createdBy;
  if (label) queryParams.label = label;
  if (labels) queryParams.labels = labels.split(",");
  if (sortBy) queryParams.sortBy = sortBy;
  if (sortOrder) queryParams.sortOrder = sortOrder;

  const pageLimit = limit ? parseInt(limit) : 50;
  queryParams.limit = pageLimit;

  // Use cursor for pagination if provided, otherwise fall back to offset
  if (cursorData) {
    queryParams.cursorCreatedAt = new Date(cursorData.createdAt);
    queryParams.cursorId = cursorData.id;
  } else if (offset) {
    queryParams.offset = parseInt(offset);
  }

  try {
    const result = await queryTickets(queryParams);

    // Apply sparse fieldset - return only list fields by default
    const tickets = !includeFull
      ? result.tickets.map((t) =>
          pickFields(
            t as unknown as Record<string, unknown>,
            sparseFields || [...LIST_FIELDS],
          ),
        )
      : result.tickets;

    // Generate next cursor from full tickets (before sparse filtering)
    const nextCursor = getNextCursor(result.tickets, pageLimit);

    return c.json({
      tickets,
      total: result.total,
      limit: pageLimit,
      nextCursor, // For cursor-based pagination
      offset: queryParams.offset || 0,
      sparse: !includeFull, // Indicate if response is sparse
    });
  } catch (error) {
    console.error("[API] Error querying tickets:", error);
    return c.json({ error: "Failed to query tickets" }, 500);
  }
});

// === Create Ticket ===

ticketsRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateTicketSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const ticket = await createTicket(parsed.data);

    return c.json(
      {
        message: "Ticket created",
        ticket,
      },
      201,
    );
  } catch (error) {
    console.error("[API] Error creating ticket:", error);
    return c.json(
      {
        error: "Failed to create ticket",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// === Bulk Operations ===

ticketsRouter.post("/bulk-update", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = BulkUpdateTicketsSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const result = await bulkUpdateTickets(parsed.data);

    return c.json({
      message: "Bulk update completed",
      updated: result.updated,
      failed: result.failed,
    });
  } catch (error) {
    console.error("[API] Error bulk updating tickets:", error);
    return c.json({ error: "Failed to bulk update tickets" }, 500);
  }
});

ticketsRouter.post("/bulk-delete", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = BulkDeleteTicketsSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const result = await bulkDeleteTickets(parsed.data);

    return c.json({
      message: "Bulk delete completed",
      deletedIds: result.deletedIds,
      failed: result.failed,
    });
  } catch (error) {
    console.error("[API] Error bulk deleting tickets:", error);
    return c.json({ error: "Failed to bulk delete tickets" }, 500);
  }
});

// === Get Single Ticket ===

ticketsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const includeRelations = c.req.query("include") === "all";

  try {
    const ticket = includeRelations
      ? await getTicketWithRelations(id)
      : await getTicket(id);

    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    return c.json({ ticket });
  } catch (error) {
    console.error("[API] Error fetching ticket:", error);
    return c.json({ error: "Failed to fetch ticket" }, 500);
  }
});

// === Update Ticket ===

ticketsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json();
    const parsed = UpdateTicketSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const ticket = await updateTicket(id, parsed.data);

    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    return c.json({
      message: "Ticket updated",
      ticket,
    });
  } catch (error) {
    console.error("[API] Error updating ticket:", error);
    return c.json(
      {
        error: "Failed to update ticket",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// === Delete Ticket ===

ticketsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const deleted = await deleteTicket(id);
    if (!deleted) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    return c.json({ message: "Ticket deleted" });
  } catch (error) {
    console.error("[API] Error deleting ticket:", error);
    return c.json({ error: "Failed to delete ticket" }, 500);
  }
});

// === External Links ===

ticketsRouter.get("/:id/links", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const links = await getExternalLinks(id);
    return c.json({ ticketId: id, links, count: links.length });
  } catch (error) {
    console.error("[API] Error fetching links:", error);
    return c.json({ error: "Failed to fetch links" }, 500);
  }
});

ticketsRouter.post("/:id/links", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { platform, externalId, externalUrl } = body;

    if (!platform || !externalId) {
      return c.json({ error: "platform and externalId are required" }, 400);
    }

    const link = await createExternalLink(id, {
      platform,
      externalId,
      externalUrl,
    });

    return c.json(
      {
        message: "External link created",
        link,
      },
      201,
    );
  } catch (error) {
    console.error("[API] Error creating link:", error);
    return c.json({ error: "Failed to create link" }, 500);
  }
});

// === Comments ===

ticketsRouter.get("/:id/comments", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const comments = await getComments(id);
    return c.json({ ticketId: id, comments, count: comments.length });
  } catch (error) {
    console.error("[API] Error fetching comments:", error);
    return c.json({ error: "Failed to fetch comments" }, 500);
  }
});

ticketsRouter.post("/:id/comments", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { content, author } = body;

    if (!content) {
      return c.json({ error: "content is required" }, 400);
    }

    const commentAuthor = author || {
      type: "human",
      name: "User",
      platform: "glinr",
    };
    const comment = await addComment(id, content, commentAuthor);

    return c.json(
      {
        message: "Comment added",
        comment,
      },
      201,
    );
  } catch (error) {
    console.error("[API] Error adding comment:", error);
    return c.json({ error: "Failed to add comment" }, 500);
  }
});

// === History ===

ticketsRouter.get("/:id/history", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const history = await getHistory(id);
    return c.json({ ticketId: id, history, count: history.length });
  } catch (error) {
    console.error("[API] Error fetching history:", error);
    return c.json({ error: "Failed to fetch history" }, 500);
  }
});

// === Relations ===

ticketsRouter.get("/:id/relations", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const relations = await getTicketRelations(id);
    return c.json({ ticketId: id, relations, count: relations.length });
  } catch (error) {
    console.error("[API] Error fetching relations:", error);
    return c.json({ error: "Failed to fetch relations" }, 500);
  }
});

ticketsRouter.post("/:id/relations", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { targetId, relationType } = body;

    if (!targetId || !relationType) {
      return c.json({ error: "targetId and relationType are required" }, 400);
    }

    if (targetId === id) {
      return c.json({ error: "Ticket cannot relate to itself" }, 400);
    }

    const relationTypeParse = TicketRelationType.safeParse(relationType);
    if (!relationTypeParse.success) {
      return c.json(
        {
          error: `Invalid relationType. Must be one of: ${TicketRelationType.options.join(", ")}`,
        },
        400,
      );
    }

    const targetTicket = await getTicket(targetId);
    if (!targetTicket) {
      return c.json({ error: "Target ticket not found" }, 404);
    }

    const relation = await createTicketRelation(
      id,
      targetId,
      relationTypeParse.data,
    );

    return c.json(
      {
        message: "Relation created",
        relation,
      },
      201,
    );
  } catch (error) {
    console.error("[API] Error creating relation:", error);
    return c.json({ error: "Failed to create relation" }, 500);
  }
});

ticketsRouter.delete("/:id/relations/:relationId", async (c) => {
  const id = c.req.param("id");
  const relationId = c.req.param("relationId");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const deleted = await deleteTicketRelation(relationId, id);
    if (!deleted) {
      return c.json({ error: "Relation not found" }, 404);
    }

    return c.json({ message: "Relation deleted" });
  } catch (error) {
    console.error("[API] Error deleting relation:", error);
    return c.json({ error: "Failed to delete relation" }, 500);
  }
});

// === Watchers ===

ticketsRouter.get("/:id/watchers", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const watchers = await getTicketWatchers(id);
    return c.json({ ticketId: id, watchers, count: watchers.length });
  } catch (error) {
    console.error("[API] Error fetching watchers:", error);
    return c.json({ error: "Failed to fetch watchers" }, 500);
  }
});

ticketsRouter.post("/:id/watchers", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { userId } = body as { userId?: string };

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const watcher = await addTicketWatcher(id, userId);
    return c.json({ message: "Watcher added", watcher }, 201);
  } catch (error) {
    console.error("[API] Error adding watcher:", error);
    return c.json({ error: "Failed to add watcher" }, 500);
  }
});

ticketsRouter.delete("/:id/watchers/:userId", async (c) => {
  const id = c.req.param("id");
  const userId = c.req.param("userId");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const removed = await removeTicketWatcher(id, userId);
    if (!removed) {
      return c.json({ error: "Watcher not found" }, 404);
    }

    return c.json({ message: "Watcher removed" });
  } catch (error) {
    console.error("[API] Error removing watcher:", error);
    return c.json({ error: "Failed to remove watcher" }, 500);
  }
});

// === Assignees ===

ticketsRouter.get("/:id/assignees", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const assignees = await getTicketAssignees(id);
    return c.json({ ticketId: id, assignees, count: assignees.length });
  } catch (error) {
    console.error("[API] Error fetching assignees:", error);
    return c.json({ error: "Failed to fetch assignees" }, 500);
  }
});

ticketsRouter.post("/:id/assignees", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { userId } = body as { userId?: string };

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const assignee = await addTicketAssignee(id, userId);
    return c.json({ message: "Assignee added", assignee }, 201);
  } catch (error) {
    console.error("[API] Error adding assignee:", error);
    return c.json({ error: "Failed to add assignee" }, 500);
  }
});

ticketsRouter.delete("/:id/assignees/:userId", async (c) => {
  const id = c.req.param("id");
  const userId = c.req.param("userId");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const removed = await removeTicketAssignee(id, userId);
    if (!removed) {
      return c.json({ error: "Assignee not found" }, 404);
    }

    return c.json({ message: "Assignee removed" });
  } catch (error) {
    console.error("[API] Error removing assignee:", error);
    return c.json({ error: "Failed to remove assignee" }, 500);
  }
});

// === Mentions ===

ticketsRouter.get("/:id/mentions", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const mentions = await getTicketMentions(id);
    return c.json({ ticketId: id, mentions, count: mentions.length });
  } catch (error) {
    console.error("[API] Error fetching mentions:", error);
    return c.json({ error: "Failed to fetch mentions" }, 500);
  }
});

ticketsRouter.post("/:id/mentions", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { userId, source, sourceId } = body as {
      userId?: string;
      source?: "description" | "comment" | "history";
      sourceId?: string;
    };

    if (!userId || !source) {
      return c.json({ error: "userId and source are required" }, 400);
    }

    const mention = await addTicketMention({
      ticketId: id,
      userId,
      source,
      sourceId,
    });

    return c.json({ message: "Mention added", mention }, 201);
  } catch (error) {
    console.error("[API] Error adding mention:", error);
    return c.json({ error: "Failed to add mention" }, 500);
  }
});

// === Attachments ===

ticketsRouter.get("/:id/attachments", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const attachments = await getTicketAttachments(id);
    return c.json({ ticketId: id, attachments, count: attachments.length });
  } catch (error) {
    console.error("[API] Error fetching attachments:", error);
    return c.json({ error: "Failed to fetch attachments" }, 500);
  }
});

ticketsRouter.post("/:id/attachments", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { fileName, fileType, fileSize, url, storagePath, uploadedBy } =
      body as {
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        url?: string;
        storagePath?: string;
        uploadedBy?: string;
      };

    if (!fileName || !url) {
      return c.json({ error: "fileName and url are required" }, 400);
    }

    // Validate file upload
    const validation = validateFileUpload(
      { fileName, fileType, fileSize },
      { category: 'attachment' }
    );
    
    if (!validation.valid) {
      return c.json({ error: validation.errors.join(', ') }, 400);
    }

    // Sanitize filename
    const safeFileName = sanitizeFilename(fileName);

    const attachment = await addTicketAttachment({
      ticketId: id,
      fileName: safeFileName,
      fileType,
      fileSize,
      url,
      storagePath,
      uploadedBy,
    });

    return c.json({ message: "Attachment added", attachment }, 201);
  } catch (error) {
    console.error("[API] Error adding attachment:", error);
    return c.json({ error: "Failed to add attachment" }, 500);
  }
});

ticketsRouter.delete("/:id/attachments/:attachmentId", async (c) => {
  const id = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const deleted = await deleteTicketAttachment(attachmentId, id);
    if (!deleted) {
      return c.json({ error: "Attachment not found" }, 404);
    }

    return c.json({ message: "Attachment deleted" });
  } catch (error) {
    console.error("[API] Error deleting attachment:", error);
    return c.json({ error: "Failed to delete attachment" }, 500);
  }
});

// === Reactions ===

ticketsRouter.get("/:id/reactions", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const reactions = await getTicketReactions(id);
    return c.json({ ticketId: id, reactions, count: reactions.length });
  } catch (error) {
    console.error("[API] Error fetching reactions:", error);
    return c.json({ error: "Failed to fetch reactions" }, 500);
  }
});

ticketsRouter.post("/:id/reactions", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { userId, emoji } = body as { userId?: string; emoji?: string };

    if (!userId || !emoji) {
      return c.json({ error: "userId and emoji are required" }, 400);
    }

    const reaction = await addTicketReaction({
      ticketId: id,
      userId,
      emoji,
    });

    return c.json({ message: "Reaction added", reaction }, 201);
  } catch (error) {
    console.error("[API] Error adding reaction:", error);
    return c.json({ error: "Failed to add reaction" }, 500);
  }
});

ticketsRouter.delete("/:id/reactions/:reactionId", async (c) => {
  const id = c.req.param("id");
  const reactionId = c.req.param("reactionId");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const deleted = await deleteTicketReaction(reactionId, id);
    if (!deleted) {
      return c.json({ error: "Reaction not found" }, 404);
    }

    return c.json({ message: "Reaction deleted" });
  } catch (error) {
    console.error("[API] Error deleting reaction:", error);
    return c.json({ error: "Failed to delete reaction" }, 500);
  }
});

// === Transition Status (Convenience Endpoint) ===

ticketsRouter.post("/:id/transition", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json();
    const { status } = body;

    if (!status) {
      return c.json({ error: "status is required" }, 400);
    }

    const validStatuses = [
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return c.json(
        {
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        },
        400,
      );
    }

    const ticket = await updateTicket(id, { status });

    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    return c.json({
      message: `Ticket transitioned to ${status}`,
      ticket,
    });
  } catch (error) {
    console.error("[API] Error transitioning ticket:", error);
    return c.json({ error: "Failed to transition ticket" }, 500);
  }
});

// === Assign to Agent ===

ticketsRouter.post("/:id/assign-agent", async (c) => {
  const id = c.req.param("id");

  try {
    const body = await c.req.json();
    const { agent } = body;

    if (!agent) {
      return c.json({ error: "agent is required" }, 400);
    }

    const ticket = await updateTicket(id, { assigneeAgent: agent });

    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    return c.json({
      message: `Ticket assigned to ${agent}`,
      ticket,
    });
  } catch (error) {
    console.error("[API] Error assigning agent:", error);
    return c.json({ error: "Failed to assign agent" }, 500);
  }
});

// === AI-Powered Endpoints ===

import {
  isAIAvailable,
  categorizeTicket,
  suggestTicketImprovements,
  summarizeTicket,
  calculateSimilarity,
} from "../utils/ai-inference.js";
import {
  processComment,
  generateResponse,
  getResponderStatus,
} from "../utils/ai-responder.js";

/**
 * POST /tickets/ai/categorize
 * Auto-categorize a ticket based on title and description
 */
ticketsRouter.post("/ai/categorize", async (c) => {
  try {
    const body = await c.req.json();
    const { title, description } = body;

    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    // Check if AI is available
    const available = await isAIAvailable();
    if (!available) {
      return c.json(
        {
          error: "AI service unavailable",
          fallback: {
            type: "task",
            priority: "medium",
            labels: [],
            confidence: 0,
          },
        },
        503,
      );
    }

    const result = await categorizeTicket(title, description);

    if (!result.success) {
      return c.json(
        {
          error: result.error || "Categorization failed",
          fallback: {
            type: "task",
            priority: "medium",
            labels: [],
            confidence: 0,
          },
        },
        500,
      );
    }

    return c.json({
      categorization: result.data,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("[API] Error categorizing ticket:", error);
    return c.json({ error: "Failed to categorize ticket" }, 500);
  }
});

/**
 * POST /tickets/ai/suggest
 * Get AI suggestions to improve a ticket
 */
ticketsRouter.post("/ai/suggest", async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, type } = body;

    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    const available = await isAIAvailable();
    if (!available) {
      return c.json({ error: "AI service unavailable" }, 503);
    }

    const result = await suggestTicketImprovements(title, description, type);

    if (!result.success) {
      return c.json({ error: result.error || "Suggestion failed" }, 500);
    }

    return c.json({
      suggestions: result.data,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("[API] Error getting suggestions:", error);
    return c.json({ error: "Failed to get suggestions" }, 500);
  }
});

/**
 * GET /tickets/:id/ai/summary
 * Get an AI-generated summary of a ticket
 */
ticketsRouter.get("/:id/ai/summary", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicketWithRelations(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const available = await isAIAvailable();
    if (!available) {
      // Fallback: return first 100 chars of description
      return c.json({
        summary: ticket.description?.slice(0, 100) || ticket.title,
        source: "fallback",
      });
    }

    const comments =
      ticket.comments?.map((c: { content: string }) => c.content) || [];
    const result = await summarizeTicket(
      ticket.title,
      ticket.description,
      comments,
    );

    return c.json({
      summary: result.success ? result.data : ticket.title,
      source: result.success ? "ai" : "fallback",
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("[API] Error summarizing ticket:", error);
    return c.json({ error: "Failed to summarize ticket" }, 500);
  }
});

/**
 * GET /tickets/:id/similar
 * Find similar tickets based on title and description
 */
ticketsRouter.get("/:id/similar", async (c) => {
  const id = c.req.param("id");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 5;

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    // Get all tickets to compare
    const { tickets: allTickets } = await queryTickets({ limit: 100 });

    // Calculate similarity scores
    const ticketText = `${ticket.title} ${ticket.description || ""}`;
    const similarities = allTickets
      .filter((t: { id: string }) => t.id !== id) // Exclude the ticket itself
      .map(
        (t: {
          id: string;
          title: string;
          description?: string;
          sequence: number;
          status: string;
          type: string;
        }) => ({
          id: t.id,
          sequence: t.sequence,
          title: t.title,
          status: t.status,
          type: t.type,
          similarity: calculateSimilarity(
            ticketText,
            `${t.title} ${t.description || ""}`,
          ),
        }),
      )
      .filter((t: { similarity: number }) => t.similarity > 0.1) // Minimum similarity threshold
      .sort(
        (a: { similarity: number }, b: { similarity: number }) =>
          b.similarity - a.similarity,
      )
      .slice(0, limit);

    return c.json({
      ticketId: id,
      similar: similarities,
      count: similarities.length,
    });
  } catch (error) {
    console.error("[API] Error finding similar tickets:", error);
    return c.json({ error: "Failed to find similar tickets" }, 500);
  }
});

/**
 * GET /tickets/ai/status
 * Check if AI features are available
 */
ticketsRouter.get("/ai/status", async (c) => {
  const available = await isAIAvailable();
  return c.json({
    available,
    model: process.env.OLLAMA_MODEL || "llama3.2",
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  });
});

/**
 * GET /tickets/ai/responder-status
 * Check AI responder status
 */
ticketsRouter.get("/ai/responder-status", async (c) => {
  const status = await getResponderStatus();
  return c.json(status);
});

/**
 * POST /tickets/:id/comments/ai-respond
 * Generate an AI response to the latest comment or a specific comment
 */
ticketsRouter.post("/:id/comments/ai-respond", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicketWithRelations(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const { commentId, autoPost = false, minConfidence = 0.6 } = body;

    const comments = ticket.comments || [];
    if (comments.length === 0) {
      return c.json({ error: "No comments to respond to" }, 400);
    }

    // Get the comment to respond to (latest or specific)
    const targetComment = commentId
      ? comments.find((c: { id: string }) => c.id === commentId)
      : comments[comments.length - 1];

    if (!targetComment) {
      return c.json({ error: "Comment not found" }, 404);
    }

    // Don't respond to AI comments
    if (targetComment.author.type === "ai" || targetComment.isAiResponse) {
      return c.json({
        skipped: true,
        reason: "Cannot respond to AI comments",
      });
    }

    // Get previous comments for context (excluding the target)
    const previousComments = comments.filter(
      (c: { id: string }) => c.id !== targetComment.id,
    );

    // Process the comment and generate response
    const result = await processComment(
      targetComment.content,
      {
        title: ticket.title,
        description: ticket.description,
        type: ticket.type,
        status: ticket.status,
        labels: ticket.labels,
        priority: ticket.priority,
      },
      previousComments,
      { autoPost, minConfidence },
    );

    // If auto-post is enabled and we should post
    if (result.success && result.shouldPost && result.response && autoPost) {
      const aiComment = await addComment(id, result.response, {
        type: "ai",
        name: "GLINR AI",
        platform: "glinr",
      });

      return c.json({
        posted: true,
        comment: aiComment,
        response: result.response,
        confidence: result.confidence,
        responseType: result.responseType,
        durationMs: result.durationMs,
      });
    }

    // Return the response without posting
    return c.json({
      posted: false,
      response: result.response || null,
      confidence: result.confidence,
      responseType: result.responseType,
      shouldPost: result.shouldPost,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("[API] Error generating AI response:", error);
    return c.json({ error: "Failed to generate AI response" }, 500);
  }
});

/**
 * POST /tickets/:id/ai/analyze-comment
 * Analyze a comment without responding - useful for UI preview
 */
ticketsRouter.post("/:id/ai/analyze-comment", async (c) => {
  const id = c.req.param("id");

  try {
    const ticket = await getTicket(id);
    if (!ticket) {
      return c.json({ error: "Ticket not found" }, 404);
    }

    const body = await c.req.json();
    const { content } = body;

    if (!content) {
      return c.json({ error: "content is required" }, 400);
    }

    const comments = await getComments(id);

    // Generate response
    const result = await generateResponse(
      content,
      {
        title: ticket.title,
        description: ticket.description,
        type: ticket.type,
        status: ticket.status,
        labels: ticket.labels,
        priority: ticket.priority,
      },
      comments,
      "answer",
    );

    return c.json({
      response: result.response || null,
      confidence: result.confidence,
      responseType: result.responseType,
      shouldPost: result.shouldPost,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("[API] Error analyzing comment:", error);
    return c.json({ error: "Failed to analyze comment" }, 500);
  }
});

export { ticketsRouter as ticketsRoutes };

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as labelsService from "../index.js";
import { getDb } from "../../storage/index.js";

vi.mock("../../storage/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../storage/schema.js", () => ({
  labels: {
    id: "id",
    name: "name",
    projectId: "projectId",
    sortOrder: "sortOrder",
    description: "description",
    color: "color",
    parentId: "parentId",
    externalSource: "externalSource",
    externalId: "externalId",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  ticketLabels: {
    id: "id",
    labelId: "labelId",
    ticketId: "ticketId",
    addedAt: "addedAt",
  },
}));

describe("Labels Service", () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
    };
    (getDb as any).mockReturnValue(mockDb);
  });

  it("should create a label", async () => {
    mockDb.limit.mockResolvedValue([{ sortOrder: 10000 }]);

    const label = await labelsService.createLabel({
      name: "Bug",
      color: "#ff0000",
    });

    expect(label.name).toBe("Bug");
    expect(label.color).toBe("#ff0000");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("should get a label by id", async () => {
    mockDb.limit.mockResolvedValue([{ id: "l1", name: "Bug" }]);

    const label = await labelsService.getLabel("l1");

    expect(label?.id).toBe("l1");
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("should list labels for a project", async () => {
    const mockLabels = [
      { id: "1", name: "L1" },
      { id: "2", name: "L2" },
    ];
    mockDb.orderBy.mockResolvedValue(mockLabels);

    const result = await labelsService.listLabels("p1");
    expect(result.length).toBe(2);
    expect(mockDb.where).toHaveBeenCalled();
  });

  it("should update a label", async () => {
    mockDb.limit.mockResolvedValueOnce([{ id: "l1", name: "New" }]);

    const updated = await labelsService.updateLabel("l1", {
      name: "New",
      color: "#111111",
    });

    expect(updated.name).toBe("New");
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalled();
  });

  it("should delete a label and associations", async () => {
    await labelsService.deleteLabel("l1");

    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });

  it("should add label to a ticket", async () => {
    mockDb.limit.mockResolvedValue([]); // Not already exists

    await labelsService.addLabelToTicket("t1", "l1");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("should not add duplicate label to ticket", async () => {
    mockDb.limit.mockResolvedValue([{ id: "existing" }]);

    await labelsService.addLabelToTicket("t1", "l1");

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("should remove label from a ticket", async () => {
    await labelsService.removeLabelFromTicket("t1", "l1");

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("should get ticket labels", async () => {
    const rows = [{ id: "l1", name: "Bug", color: "#fff" }];
    mockDb.orderBy.mockResolvedValue(rows);

    const labels = await labelsService.getTicketLabels("t1");

    expect(labels).toEqual(rows);
    expect(mockDb.innerJoin).toHaveBeenCalled();
  });

  it("should set ticket labels", async () => {
    await labelsService.setTicketLabels("t1", ["l1", "l2"]);

    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalled();
  });

  it("should clear ticket labels without inserting", async () => {
    await labelsService.setTicketLabels("t1", []);

    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("should find label by external id", async () => {
    mockDb.limit.mockResolvedValue([{ id: "l1", externalId: "ext" }]);

    const label = await labelsService.findLabelByExternalId(
      "p1",
      "github",
      "ext",
    );

    expect(label?.id).toBe("l1");
  });

  it("should find or create a label", async () => {
    // 1. Find by externalId fails
    mockDb.limit.mockResolvedValueOnce([]);
    // 2. Find by name succeeds
    mockDb.limit.mockResolvedValueOnce([{ id: "existing", name: "Bug" }]);

    const label = await labelsService.findOrCreateLabel("p1", "Bug", {
      externalSource: "gh",
      externalId: "1",
    });

    expect(label.id).toBe("existing");
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it("should create label when findOrCreate misses", async () => {
    mockDb.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sortOrder: 0 }]);

    const label = await labelsService.findOrCreateLabel("p1", "New", {
      color: "#123456",
    });

    expect(label.name).toBe("New");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("should sync labels from GitHub", async () => {
    // Mock the inner calls of findOrCreateLabel
    mockDb.limit
      .mockResolvedValueOnce([{ id: "l1", name: "Bug" }]) // findLabelByExternalId
      .mockResolvedValueOnce([{ id: "l1", name: "Bug" }]); // getLabel or whatever
      
    const synced = await labelsService.syncLabelsFromGitHub("p1", [
      { name: "Bug", color: "ff0000" },
    ]);

    expect(synced).toHaveLength(1);
    expect(synced[0].name).toBe("Bug");
  });
});

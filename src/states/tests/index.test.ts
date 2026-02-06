import { describe, it, expect, vi, beforeEach } from "vitest";
import * as statesService from "../index.js";
import { getDb } from "../../storage/index.js";

vi.mock("../../storage/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../storage/schema.js", () => ({
  states: {
    id: "id",
    name: "name",
    isDefault: "isDefault",
    projectId: "projectId",
    stateGroup: "stateGroup",
    sequence: "sequence",
    slug: "slug",
    color: "color",
    description: "description",
  },
}));

describe("States Service", () => {
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
    };
    (getDb as any).mockReturnValue(mockDb);
  });

  it("should create a state", async () => {
    const state = await statesService.createState({
      name: "Backlog",
      stateGroup: "backlog",
    });

    expect(state.name).toBe("Backlog");
    expect(state.stateGroup).toBe("backlog");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("should get a state by id", async () => {
    mockDb.limit.mockResolvedValue([{ id: "s1", name: "Todo" }]);

    const state = await statesService.getState("s1");

    expect(state?.id).toBe("s1");
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("should list states for a project", async () => {
    const mockStates = [{ id: "1", name: "Todo" }];
    mockDb.orderBy.mockResolvedValue(mockStates);

    const result = await statesService.listStates("p1");
    expect(result.length).toBe(1);
    expect(mockDb.where).toHaveBeenCalled();
  });

  it("should update a state and unset defaults", async () => {
    mockDb.limit
      .mockResolvedValueOnce([{ id: "s1", name: "Todo", projectId: "p1" }])
      .mockResolvedValueOnce([{ id: "s1", name: "Doing" }]);

    const updated = await statesService.updateState("s1", {
      name: "Doing",
      isDefault: true,
    });

    expect(updated.name).toBe("Doing");
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalled();
  });

  it("should throw when updating missing state", async () => {
    mockDb.limit.mockResolvedValue([]);

    await expect(
      statesService.updateState("missing", { name: "X" }),
    ).rejects.toThrow("State missing not found");
  });

  it("should delete a non-default state", async () => {
    mockDb.limit.mockResolvedValue([{ id: "s1", isDefault: false }]);

    await statesService.deleteState("s1");

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("should no-op when deleting missing state", async () => {
    mockDb.limit.mockResolvedValue([]);

    await statesService.deleteState("missing");

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("should initialize project states", async () => {
    // Should call insert multiple times
    await statesService.initializeProjectStates("p1");
    expect(mockDb.insert).toHaveBeenCalledTimes(6);
  });

  it("should not allow deleting default state", async () => {
    mockDb.limit.mockResolvedValue([{ id: "1", isDefault: true }]);

    await expect(statesService.deleteState("1")).rejects.toThrow(
      "Cannot delete the default state",
    );
  });
});

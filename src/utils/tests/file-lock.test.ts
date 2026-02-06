import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("proper-lockfile", () => ({
  default: {
    lock: vi.fn(),
    check: vi.fn(),
    unlock: vi.fn(),
  },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe("file lock", () => {
  let lockfile: {
    lock: ReturnType<typeof vi.fn>;
    check: ReturnType<typeof vi.fn>;
    unlock: ReturnType<typeof vi.fn>;
  };
  let fs: {
    existsSync: ReturnType<typeof vi.fn>;
    writeFileSync: ReturnType<typeof vi.fn>;
    mkdirSync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();
    lockfile = (await import("proper-lockfile")).default as any;
    fs = (await import("fs")) as any;

    lockfile.lock.mockReset();
    lockfile.check.mockReset();
    lockfile.unlock.mockReset();
    fs.existsSync.mockReset();
    fs.writeFileSync.mockReset();
    fs.mkdirSync.mockReset();
    fs.readFileSync.mockReset();
  });

  it("acquires and releases a lock", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    lockfile.lock.mockResolvedValue(release);
    fs.existsSync.mockReturnValue(true);

    const { acquireLock } = await import("../file-lock.js");
    const result = await acquireLock("/tmp/file.json");

    expect(result).toBe(release);
    await result();
    expect(release).toHaveBeenCalled();
  });

  it("creates file when missing", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    lockfile.lock.mockResolvedValue(release);
    fs.existsSync.mockReturnValue(false);

    const { acquireLock } = await import("../file-lock.js");
    await acquireLock("/tmp/missing.json");

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/missing.json", "");
  });

  it("returns false when checking missing file", async () => {
    fs.existsSync.mockReturnValue(false);

    const { isLocked } = await import("../file-lock.js");
    const locked = await isLocked("/tmp/missing.json");

    expect(locked).toBe(false);
  });

  it("returns true when lock check succeeds", async () => {
    fs.existsSync.mockReturnValue(true);
    lockfile.check.mockResolvedValue(true);

    const { isLocked } = await import("../file-lock.js");
    const locked = await isLocked("/tmp/file.json");

    expect(locked).toBe(true);
  });

  it("returns false when lock check throws", async () => {
    fs.existsSync.mockReturnValue(true);
    lockfile.check.mockRejectedValue(new Error("fail"));

    const { isLocked } = await import("../file-lock.js");
    const locked = await isLocked("/tmp/file.json");

    expect(locked).toBe(false);
  });

  it("handles locked errors", async () => {
    const error: NodeJS.ErrnoException = new Error("locked");
    error.code = "ELOCKED";
    lockfile.lock.mockRejectedValue(error);
    fs.existsSync.mockReturnValue(true);

    const { acquireLock } = await import("../file-lock.js");

    await expect(acquireLock("/tmp/file.json")).rejects.toThrow(
      "File is locked by another process",
    );
  });

  it("supports readJsonWithLock and writeJsonWithLock", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    lockfile.lock.mockResolvedValue(release);
    fs.existsSync.mockReturnValue(true);

    fs.readFileSync.mockReturnValue('{"a":1}');

    const { readJsonWithLock, writeJsonWithLock } =
      await import("../file-lock.js");

    const data = await readJsonWithLock("/tmp/file.json");
    expect(data).toEqual({ a: 1 });

    await writeJsonWithLock("/tmp/file.json", { b: 2 });
  });

  it("updates json with updater", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    lockfile.lock.mockResolvedValue(release);

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{"a":1}');

    const { updateJsonWithLock } = await import("../file-lock.js");

    const result = await updateJsonWithLock("/tmp/file.json", (current) => ({
      a: (current?.a ?? 0) + 1,
    }));

    expect(result).toEqual({ a: 2 });
  });

  it("locks multiple files in order", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    lockfile.lock.mockResolvedValue(release);
    fs.existsSync.mockReturnValue(true);

    const { withMultiLock } = await import("../file-lock.js");

    const result = await withMultiLock(
      ["/tmp/b.json", "/tmp/a.json"],
      async () => "ok",
    );
    expect(result).toBe("ok");
    expect(lockfile.lock).toHaveBeenCalledTimes(2);
  });

  it("gets lock file path", async () => {
    const { getLockFilePath } = await import("../file-lock.js");
    expect(getLockFilePath("/tmp/file.json")).toBe("/tmp/file.json.lock");
  });

  it("cleans up stale lock", async () => {
    lockfile.check.mockResolvedValue(true);
    lockfile.unlock.mockResolvedValue(undefined);

    const { cleanupStaleLock } = await import("../file-lock.js");
    const result = await cleanupStaleLock("/tmp/file.json");

    expect(result).toBe(true);
  });
});

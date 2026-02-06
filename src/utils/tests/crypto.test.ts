import { describe, it, expect, vi } from "vitest";
import { encrypt, decrypt } from "../crypto.js";
import { logger } from "../logger.js";

vi.mock("../logger.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("crypto utils", () => {
  it("round-trips encryption and decryption with provided key", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.ENCRYPTION_KEY;

    process.env.NODE_ENV = "test";
    process.env.ENCRYPTION_KEY = "b".repeat(64); // 32 bytes hex

    try {
      const value = "secret-data";

      const encrypted = encrypt(value);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(value);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey === undefined) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY = prevKey;
      }
    }
  });

  it("throws on invalid encrypted payload", () => {
    expect(() => decrypt("bad-payload")).toThrow("Failed to decrypt data");
  });

  it("logs error on failed decrypt", () => {
    try {
      decrypt("bad-payload");
    } catch {
      // ignore
    }

    expect(logger.error).toHaveBeenCalled();
  });

  it("requires ENCRYPTION_KEY in production", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.ENCRYPTION_KEY;

    process.env.NODE_ENV = "production";
    delete process.env.ENCRYPTION_KEY;

    try {
      expect(() => encrypt("data")).toThrow(
        "ENCRYPTION_KEY environment variable is required in production",
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey === undefined) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY = prevKey;
      }
    }
  });

  it("throws when ENCRYPTION_KEY is wrong length", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.ENCRYPTION_KEY;

    process.env.NODE_ENV = "test";
    process.env.ENCRYPTION_KEY = "deadbeef";

    try {
      expect(() => encrypt("data")).toThrow(
        "ENCRYPTION_KEY must be a 32-byte hex string",
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey === undefined) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY = prevKey;
      }
    }
  });

  it("accepts a valid hex ENCRYPTION_KEY", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.ENCRYPTION_KEY;

    process.env.NODE_ENV = "test";
    process.env.ENCRYPTION_KEY = "a".repeat(64); // 32 bytes hex

    try {
      const encrypted = encrypt("data");
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe("data");
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey === undefined) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY = prevKey;
      }
    }
  });
});

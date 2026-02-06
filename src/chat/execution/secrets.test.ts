import { describe, expect, it } from "vitest";
import { hasSecrets, redactSecrets, scanForSecrets } from "./secrets.js";

describe("secrets detection", () => {
  it("detects common secrets", () => {
    const input = "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    expect(hasSecrets(input)).toBe(true);
  });

  it("redacts detected secrets", () => {
    const input =
      "OPENAI_API_KEY=sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const output = redactSecrets(input);
    expect(output).not.toContain("sk-ant-");
    expect(output).toContain("[REDACTED]");
  });

  it("returns matches with redacted text", () => {
    const input =
      "Authorization: Bearer abcdef1234567890.abcdef1234567890.abcdef1234567890";
    const result = scanForSecrets(input);
    expect(result.hasSecrets).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.redactedText).toContain("[REDACTED]");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as loader from "../loader.js";
import type {
  SkillEntry,
  SkillMetadata,
  SkillsSystemConfig,
} from "../types.js";

describe("Skills Loader", () => {
  beforeEach(() => {
    loader.clearBinaryCache();
    vi.restoreAllMocks();
  });

  describe("parseSkillMd", () => {
    it("should parse skill with frontmatter", () => {
      const content = `---
name: test-skill
description: A test skill
user-invocable: true
---
# Instructions
Do something.`;

      const result = loader.parseSkillMd(content);
      expect(result.frontmatter.name).toBe("test-skill");
      expect(result.frontmatter.description).toBe("A test skill");
      expect(result.frontmatter["user-invocable"]).toBe(true);
      expect(result.instructions).toBe("# Instructions\nDo something.");
    });

    it("should handle missing frontmatter", () => {
      const content = "# Instructions\nJust text.";
      const result = loader.parseSkillMd(content);
      expect(result.frontmatter.name).toBe("unknown");
      expect(result.instructions).toBe(content);
    });

    it("should parse metadata JSON", () => {
      const content = `---
name: meta-skill
metadata: |
  {
    "emoji": "🚀",
    "requires": { "bins": ["git"] }
  }
---
Instructions`;
      const result = loader.parseSkillMd(content);
      expect(result.metadata?.emoji).toBe("🚀");
      expect(result.metadata?.requires?.bins).toContain("git");
    });

    it("should parse simple YAML values", () => {
      const content = `---
name: yaml-test
user-invocable: false
disable-model-invocation: true
priority: 10
---
Instruction`;
      const result = loader.parseSkillMd(content);
      expect(result.frontmatter.name).toBe("yaml-test");
      expect(result.frontmatter["user-invocable"]).toBe(false);
      expect(result.frontmatter["disable-model-invocation"]).toBe(true);
    });
  });

  it("filters skills by eligibility and config", () => {
    const skills: SkillEntry[] = [
      {
        name: "Eligible",
        description: "ok",
        source: "workspace",
        dirPath: "/skills/eligible",
        skillMdPath: "/skills/eligible/SKILL.md",
        frontmatter: { name: "Eligible", description: "ok" },
        instructions: "Do it",
        invocation: { userInvocable: true, modelInvocable: true },
        eligible: true,
        eligibilityErrors: [],
        enabled: true,
      },
      {
        name: "Disabled",
        description: "no",
        source: "workspace",
        dirPath: "/skills/disabled",
        skillMdPath: "/skills/disabled/SKILL.md",
        frontmatter: { name: "Disabled", description: "no" },
        instructions: "No",
        invocation: { userInvocable: true, modelInvocable: true },
        eligible: true,
        eligibilityErrors: [],
        enabled: false,
      },
      {
        name: "Ineligible",
        description: "bad",
        source: "workspace",
        dirPath: "/skills/ineligible",
        skillMdPath: "/skills/ineligible/SKILL.md",
        frontmatter: { name: "Ineligible", description: "bad" },
        instructions: "No",
        invocation: { userInvocable: true, modelInvocable: true },
        eligible: false,
        eligibilityErrors: ["Missing env: X"],
        enabled: true,
      },
    ];

    const config: SkillsSystemConfig = {
      load: { extraDirs: [], watch: false, watchDebounceMs: 250 },
      install: { preferBrew: true, nodeManager: "pnpm" },
      entries: { Eligible: { enabled: true }, Disabled: { enabled: false } },
      allowBundled: [],
    };

    const filtered = loader.filterSkills(skills, config);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("Eligible");
  });

  it("checks eligibility against required bins and env", async () => {
    const metadata: SkillMetadata = {
      requires: {
        bins: ["definitely_missing_bin_123"],
        anyBins: ["also_missing_bin_456", "missing_bin_789"],
        env: ["TOKEN"],
      },
    };

    const previousToken = process.env.TOKEN;
    process.env.TOKEN = "ok";

    try {
      const result = await loader.checkEligibility(metadata, undefined);

      expect(result.eligible).toBe(false);
      expect(result.errors).toContain(
        "Missing binary: definitely_missing_bin_123",
      );
      expect(result.errors).toContain(
        "Missing one of: also_missing_bin_456, missing_bin_789",
      );
      expect(result.errors).not.toContain("Missing env: TOKEN");
    } finally {
      if (previousToken === undefined) {
        delete process.env.TOKEN;
      } else {
        process.env.TOKEN = previousToken;
      }
    }
  });

  it("checks eligibility with missing env", async () => {
    const metadata: SkillMetadata = {
      requires: {
        env: ["MISSING_TOKEN"],
      },
    };

    const previousToken = process.env.MISSING_TOKEN;
    delete process.env.MISSING_TOKEN;

    try {
      const result = await loader.checkEligibility(metadata, undefined);

      expect(result.eligible).toBe(false);
      expect(result.errors).toContain("Missing env: MISSING_TOKEN");
    } finally {
      if (previousToken !== undefined) {
        process.env.MISSING_TOKEN = previousToken;
      }
    }
  });

  it("builds skill snapshot sync for eligible skills", () => {
    const skills: SkillEntry[] = [
      {
        name: "Short",
        description: "Short desc",
        source: "workspace",
        dirPath: "/skills/short",
        skillMdPath: "/skills/short/SKILL.md",
        frontmatter: { name: "Short", description: "Short desc" },
        instructions: "Small instructions",
        invocation: { userInvocable: true, modelInvocable: true },
        eligible: true,
        eligibilityErrors: [],
        enabled: true,
      },
      {
        name: "Long",
        description: "Long desc",
        source: "workspace",
        dirPath: "/skills/long",
        skillMdPath: "/skills/long/SKILL.md",
        frontmatter: { name: "Long", description: "Long desc" },
        instructions: "x".repeat(2100),
        invocation: { userInvocable: true, modelInvocable: true },
        eligible: true,
        eligibilityErrors: [],
        enabled: true,
      },
    ];

    const { prompt, snapshot } = loader.buildSkillSnapshotSync(skills, 1);

    expect(snapshot.entries).toHaveLength(2);
    expect(prompt).toContain("Available Skills");
    expect(prompt).toContain("Full instructions available");
  });

  it("builds skills status with missing items", () => {
    const skills: SkillEntry[] = [
      {
        name: "Missing",
        description: "Missing",
        source: "workspace",
        dirPath: "/skills/missing",
        skillMdPath: "/skills/missing/SKILL.md",
        frontmatter: { name: "Missing", description: "Missing" },
        instructions: "Do",
        invocation: { userInvocable: true, modelInvocable: true },
        eligible: false,
        eligibilityErrors: ["Missing binary: git", "Missing env: TOKEN"],
        enabled: true,
        metadata: { install: [], toolCategories: [] },
      },
    ];

    const status = loader.buildSkillsStatus(skills, 1);

    expect(status.totalLoaded).toBe(1);
    expect(status.skills[0]?.missing.bins).toContain("git");
    expect(status.skills[0]?.missing.env).toContain("TOKEN");
  });
});

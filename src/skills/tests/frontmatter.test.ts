import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  getMarkdownContent,
  resolveMetadata,
  resolveSkillInvocationPolicy,
  parseSkillFile,
} from "../frontmatter.js";

describe("skills frontmatter", () => {
  it("parses basic frontmatter fields", () => {
    const content = `---
name: Test Skill
description: "Hello world"
user-invocable: true
# comment line
---
Body`;

    const raw = parseFrontmatter(content);

    expect(raw.name).toBe("Test Skill");
    expect(raw.description).toBe("Hello world");
    expect(raw["user-invocable"]).toBe("true");
  });

  it("returns markdown body without frontmatter", () => {
    const content = `---
name: Example
---
# Title
Content`;

    const body = getMarkdownContent(content);

    expect(body).toBe("# Title\nContent");
  });

  it("resolves metadata from JSON string", () => {
    const raw = parseFrontmatter(`---
name: Meta
metadata: '{"profclaw":{"primaryEnv":"API_KEY","os":"darwin, linux","requires":{"bins":"git,rg"},"toolCategories":"web"}}'
---
Body`);

    const metadata = resolveMetadata(raw);

    expect(metadata?.primaryEnv).toBe("API_KEY");
    expect(metadata?.os).toEqual(["darwin", "linux"]);
    expect(metadata?.requires?.bins).toEqual(["git", "rg"]);
    expect(metadata?.toolCategories).toEqual(["web"]);
  });

  it("resolves invocation policy defaults and overrides", () => {
    const raw = parseFrontmatter(`---
name: Policy
user-invocable: false
disable-model-invocation: true
---
Body`);

    const policy = resolveSkillInvocationPolicy(raw);

    expect(policy.userInvocable).toBe(false);
    expect(policy.modelInvocable).toBe(false);
  });

  it("parses a skill file into an entry", () => {
    const content = `---
name: Parse Skill
description: Sample
---
Instructions`;

    const entry = parseSkillFile(
      content,
      "/skills/parse/SKILL.md",
      "/skills/parse",
      "workspace",
    );

    expect(entry?.name).toBe("Parse Skill");
    expect(entry?.instructions).toBe("Instructions");
    expect(entry?.source).toBe("workspace");
  });

  it("returns null when skill name is missing", () => {
    const content = `---
description: Missing name
---
Instructions`;

    const entry = parseSkillFile(
      content,
      "/skills/missing/SKILL.md",
      "/skills/missing",
      "workspace",
    );

    expect(entry).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  formatSkillsForPrompt,
  buildSkillSnapshot,
  resolveSkillsPromptForRun,
  estimateSkillsTokenCost,
  getSkillFromSnapshot,
} from "../prompt-builder.js";
import type { SkillEntry } from "../types.js";

function makeEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  const name = overrides.name ?? "Sample";
  const description = overrides.description ?? "Desc";

  return {
    name,
    description,
    source: overrides.source ?? "workspace",
    dirPath: overrides.dirPath ?? "/skills/sample",
    skillMdPath: overrides.skillMdPath ?? "/skills/sample/SKILL.md",
    frontmatter: overrides.frontmatter ?? { name, description },
    metadata: overrides.metadata,
    instructions: overrides.instructions ?? "Do work",
    invocation: overrides.invocation ?? {
      userInvocable: true,
      modelInvocable: true,
    },
    eligible: overrides.eligible ?? true,
    eligibilityErrors: overrides.eligibilityErrors ?? [],
    enabled: overrides.enabled ?? true,
    command: overrides.command,
  };
}

describe("skills prompt builder", () => {
  it("formats skills into XML with escaping", () => {
    const entry = makeEntry({
      name: "Build & Ship",
      description: "Use <tags>",
      skillMdPath: "/skills/a&b/SKILL.md",
      instructions: 'Do "this" & that',
      invocation: { userInvocable: true, modelInvocable: true },
    });

    const prompt = formatSkillsForPrompt([{ ...entry, name: "Build & Ship" }]);

    // Content preserves raw quotes
    expect(prompt).toContain('Do "this" & that');
    // Description has angle brackets escaped
    expect(prompt).toContain("&lt;tags&gt;");
    // Name and path have ampersand escaped
    expect(prompt).toContain("&amp;");
  });

  it("builds a snapshot and filters prompt entries", async () => {
    const eligible = makeEntry({
      name: "Eligible",
      invocation: { userInvocable: true, modelInvocable: true },
    });
    const notInvocable = makeEntry({
      name: "Hidden",
      invocation: { userInvocable: true, modelInvocable: false },
    });
    const ineligible = makeEntry({ name: "Ineligible", eligible: false });

    const snapshot = await buildSkillSnapshot({
      entries: [eligible, notInvocable, ineligible],
    });

    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.prompt).toContain("Eligible");
    expect(snapshot.prompt).not.toContain("Hidden");
  });

  it("resolves prompt from snapshot when available", async () => {
    const snapshot = await buildSkillSnapshot({ entries: [makeEntry({})] });

    const prompt = await resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
    });

    expect(prompt).toBe(snapshot.prompt);
  });

  it("resolves prompt from entries when snapshot is missing", async () => {
    const prompt = await resolveSkillsPromptForRun({
      entries: [makeEntry({})],
    });

    expect(prompt).toContain("<available_skills>");
  });

  it("returns empty prompt when no skills are available", async () => {
    const prompt = await resolveSkillsPromptForRun({});

    expect(prompt).toBe("");
  });

  it("estimates token cost for entries", () => {
    const cost = estimateSkillsTokenCost([
      makeEntry({}),
      makeEntry({ name: "Two" }),
    ]);

    expect(cost).toBeGreaterThan(0);
  });

  it("gets a skill entry from snapshot by name", async () => {
    const entry = makeEntry({ name: "Lookup" });
    const snapshot = await buildSkillSnapshot({ entries: [entry] });

    const found = getSkillFromSnapshot(snapshot, "Lookup");

    expect(found?.name).toBe("Lookup");
  });
});

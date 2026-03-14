---
name: skill-creator
description: Guide for authoring new profClaw skills - explains SKILL.md format, frontmatter fields, progressive disclosure, and bundled resources
version: 1.0.0
metadata: {"profclaw": {"emoji": "🛠️", "category": "meta", "priority": 70, "triggerPatterns": ["create skill", "new skill", "author skill", "skill template", "write a skill", "make a skill", "skill format", "how do skills work"]}}
---

# Skill Creator

You are a profClaw skill author. When asked to create a new skill or explain how skills work, you produce well-structured, production-quality SKILL.md files and explain the conventions behind them.

## What This Skill Does

- Generates new SKILL.md files for any capability or workflow
- Explains the profClaw skill format and frontmatter fields
- Applies progressive disclosure to keep skills focused
- Advises on trigger patterns, categories, and priority values
- Describes when to add bundled resources (scripts, references, assets)

## Skill File Format

Every skill lives in `skills/<skill-name>/SKILL.md`:

```
skills/
  my-skill/
    SKILL.md          # Required - the skill definition
    scripts/          # Optional - shell/python scripts the skill references
    references/       # Optional - reference docs, cheat sheets
    assets/           # Optional - static files, templates
```

### Frontmatter Reference

```yaml
---
name: skill-name            # kebab-case, matches directory name
description: One sentence.  # What this skill does (shown in /skills list)
version: 1.0.0              # Semantic version
metadata: {"profclaw": {
  "emoji": "🎯",            # Single emoji for UI display
  "category": "category",   # See categories below
  "priority": 75,           # 0-100, higher = matched first on ambiguous triggers
  "triggerPatterns": [      # Phrases that activate this skill
    "trigger phrase one",
    "trigger phrase two"
  ]
}}
---
```

### Categories

| Category | Use for |
|----------|---------|
| `meta` | Skills about profClaw itself (skill-creator, help) |
| `productivity` | Research, writing, summarization |
| `creative` | Image gen, content creation |
| `utility` | Weather, calculators, converters |
| `system` | Health checks, diagnostics, monitoring |
| `devops` | Docker, CI, deployments, infrastructure |
| `development` | Code review, debug, generation |
| `integration` | GitHub, Jira, Linear, Slack workflows |

### Priority Guidelines

| Priority | Meaning |
|----------|---------|
| 90-100 | Core system skill, almost always preferred |
| 75-89 | Strongly preferred for matching triggers |
| 60-74 | Normal skill, standard matching |
| 40-59 | Supplemental, yields to higher-priority skills |
| < 40 | Low-priority helper or niche use case |

## Writing Good Trigger Patterns

Triggers are substring-matched against user messages (case-insensitive).

**Do:**
- Use natural language phrases users actually type
- Include common misspellings or synonyms
- Cover both question and imperative forms: `"what is the weather"` and `"check weather"`

**Avoid:**
- Single words that are too broad (`"run"`, `"check"`)
- Patterns that overlap heavily with a higher-priority skill
- More than 10 patterns - be selective

## Skill Body Structure

A skill body should follow this pattern:

```markdown
# Skill Title

One-sentence role statement: "You are a [role]. When [trigger condition], you [action]."

## What This Skill Does
Bullet list of capabilities (4-8 items).

## How to Execute [Main Workflow]
Numbered steps with concrete examples and code blocks.

## [Secondary Sections as needed]
Reference tables, command examples, edge-case handling.

## Example Interactions
**User**: [realistic prompt]
**You**: *(what you do - italicized action description)*

## Best Practices / Safety Rules
Numbered rules for correct, safe, and useful behavior.
```

## Progressive Disclosure

Keep the main SKILL.md focused on the 80% use case. Move detailed reference material to `references/`:

```
skills/my-skill/
  SKILL.md              # Core instructions (60-120 lines)
  references/
    api-reference.md    # Full API docs, rarely needed inline
    error-codes.md      # Exhaustive error code table
  scripts/
    run.sh             # Shell script the skill calls via exec tool
```

Reference files in SKILL.md like:
```markdown
For full parameter reference, see `references/api-reference.md`.
```

## Example: Minimal Skill

```markdown
---
name: unit-converter
description: Convert between units of measurement (length, weight, temperature, etc.)
version: 1.0.0
metadata: {"profclaw": {"emoji": "📐", "category": "utility", "priority": 60, "triggerPatterns": ["convert", "how many", "in meters", "in pounds", "to celsius", "to fahrenheit"]}}
---

# Unit Converter

You are a unit conversion assistant. When users ask to convert values between units, you perform the conversion accurately and explain the formula used.

## Supported Conversions
- Length: mm, cm, m, km, in, ft, yd, mi
- Weight: mg, g, kg, lb, oz
- Temperature: C, F, K
- Volume: ml, L, fl oz, cups, pints, gallons

## How to Convert

1. Identify the source unit and target unit from the user's message.
2. Apply the appropriate formula.
3. Return the result with 4 significant figures.
4. Show the formula so the user can verify.

## Example Interactions

**User**: Convert 72 Fahrenheit to Celsius
**You**: 72°F = 22.22°C. Formula: (F - 32) × 5/9

**User**: How many kilometers is 26.2 miles?
**You**: 26.2 miles = 42.16 km. Formula: miles × 1.60934
```

## Quality Checklist

Before finalizing a skill, verify:

- [ ] `name` matches the directory name exactly
- [ ] `description` is a single, clear sentence (no trailing period needed)
- [ ] `emoji` is relevant and distinct from existing skills
- [ ] Trigger patterns are specific enough not to conflict with other skills
- [ ] Role statement in body is present (first paragraph)
- [ ] At least one "Example Interactions" section
- [ ] No `any` types if skill references TypeScript
- [ ] No hardcoded secrets, tokens, or credentials
- [ ] Safety rules section if the skill can execute destructive operations
- [ ] 60-120 lines for the main SKILL.md body (use references/ for overflow)

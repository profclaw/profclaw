---
name: git-workflow
description: Branching, committing, PR creation, merge strategies, and git history management
version: 1.0.0
metadata: {"profclaw": {"emoji": "🌿", "category": "development", "priority": 80, "triggerPatterns": ["commit", "branch", "pull request", "merge", "push", "git", "pr", "stash", "rebase", "checkout"]}}
---

# Git Workflow

You are a git workflow expert. You help users perform git operations, follow branching conventions, write good commit messages, create pull requests, and resolve git problems.

## What This Skill Does

- Creates branches following naming conventions
- Stages changes and writes well-formed commit messages
- Creates pull requests with descriptive summaries
- Advises on merge vs rebase strategies
- Resolves merge conflicts and git history issues
- Explains git operations before executing them

## Commit Message Convention

This project uses the following format:

```
<type>: <description>

<optional body>

Co-Authored-By: profClaw <bot@profclaw.ai>
```

**Types**:
| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation only |
| `test` | Test additions or fixes |
| `chore` | Build, deps, config (no production code) |

**Rules**:
- Imperative mood: "add retry logic" not "added retry logic"
- Under 72 characters for the subject line
- No period at end of subject
- No "Claude", "AI-generated", or tool names in commit messages

## Branching Strategy

**Main branch**: `main` (protected — never force push)

**Feature branches**: `feat/<short-description>`
**Bug fix branches**: `fix/<short-description>`
**Release branches**: `release/<version>`

```bash
git checkout -b feat/webhook-retry-logic
git checkout -b fix/task-queue-null-check
```

## How to Execute Git Operations

### Creating a Commit

1. Check what changed:
```bash
git status
git diff
```

2. Stage specific files (never `git add .` blindly — avoid committing `.env` or build artifacts):
```bash
git add src/queue/task-queue.ts src/queue/task-queue.test.ts
```

3. Commit with a message using heredoc to preserve formatting:
```bash
git commit -m "$(cat <<'EOF'
feat: add exponential backoff to task retry logic

Retry attempts now use 2^n * 1000ms delays, capped at 30s,
to reduce thundering herd on downstream services.

Co-Authored-By: profClaw <bot@profclaw.ai>
EOF
)"
```

### Creating a Pull Request

1. Push the branch:
```bash
git push -u origin feat/my-feature
```

2. Create PR via `gh`:
```bash
gh pr create --title "feat: add webhook retry logic" --body "$(cat <<'EOF'
## Summary
- Add exponential backoff for failed webhook deliveries
- Cap retries at 5 attempts with 30s max delay
- Add test coverage for retry edge cases

## Test plan
- [ ] Run `pnpm test src/queue/webhook-queue.test.ts`
- [ ] Manually trigger a webhook with a failing endpoint
- [ ] Verify retry schedule in BullMQ dashboard

Co-Authored-By: profClaw <bot@profclaw.ai>
EOF
)"
```

### Merge vs Rebase

| Situation | Strategy |
|-----------|----------|
| Feature branch onto main | **Rebase** to keep linear history |
| Long-lived branch with multiple contributors | **Merge** to preserve context |
| Hotfix | **Merge** directly, then tag |
| Squashing noisy commits | **Squash merge** via PR |

```bash
# Rebase onto latest main
git fetch origin
git rebase origin/main

# Interactive rebase to clean up commits before PR
git rebase -i HEAD~3
```

### Resolving Merge Conflicts

1. Open conflicted files — look for `<<<<<<<`, `=======`, `>>>>>>>`
2. Decide which version to keep (or combine both)
3. Remove conflict markers
4. Stage the resolved file: `git add <file>`
5. Continue: `git rebase --continue` or `git merge --continue`

## Example Interactions

**User**: Commit my changes with a message about adding webhook support
**You**: *(runs git status, stages relevant files, commits with proper format including Co-Authored-By)*

**User**: Create a PR for this feature
**You**: *(checks current branch, pushes if needed, creates PR with summary and test plan via gh)*

**User**: I need to undo my last commit but keep the changes
**You**: `git reset HEAD~1` — this removes the commit but leaves your files staged.

**User**: How do I clean up 5 messy commits before merging?
**You**: Use `git rebase -i HEAD~5` — I'll explain each option (pick, squash, fixup, reword).

## Safety Rules

- **Never** force push to `main` or `master`
- **Never** run `git reset --hard` or `git checkout .` without explicit user confirmation — these destroy work
- **Never** commit `.env`, `*.key`, `*.pem`, or secret files
- **Always** warn before destructive operations and explain what will be lost
- **Always** prefer `git reset HEAD~1` over `git reset --hard HEAD~1` to preserve working tree

## Best Practices

1. **One logical change per commit** — don't bundle unrelated fixes
2. **Commit early and often** on feature branches
3. **Pull before push** — `git pull --rebase origin main` to stay current
4. **Review your own diff** before committing — `git diff --staged`
5. **Use `.gitignore`** — never track build artifacts, logs, or secrets
6. **Tag releases** — `git tag -a v1.2.0 -m "Release 1.2.0"`

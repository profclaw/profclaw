/**
 * Tests for Summary Templates
 */

import { describe, it, expect } from 'vitest';
import {
  TASK_TYPE_TEMPLATES,
  generatePRDescription,
  generateChangelog,
  generateReleaseNotes,
  getConventionalCommitPrefix,
  generateCommitMessage,
} from '../templates.js';
import type { Summary } from '../../types/summary.js';

// Helper to create a minimal summary
function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    id: 'sum-1',
    taskId: 'task-1',
    title: 'Add user authentication',
    whatChanged: 'Implemented JWT-based auth flow with refresh tokens.',
    agent: 'claude-sonnet',
    createdAt: new Date('2026-03-01'),
    ...overrides,
  } as Summary;
}

describe('TASK_TYPE_TEMPLATES', () => {
  it('has entries for common task types', () => {
    expect(TASK_TYPE_TEMPLATES.feature).toBeDefined();
    expect(TASK_TYPE_TEMPLATES.bug_fix).toBeDefined();
    expect(TASK_TYPE_TEMPLATES.refactor).toBeDefined();
    expect(TASK_TYPE_TEMPLATES.security).toBeDefined();
    expect(TASK_TYPE_TEMPLATES.test).toBeDefined();
  });

  it('feature has correct fields', () => {
    const feature = TASK_TYPE_TEMPLATES.feature;
    expect(feature.title).toBe('New Feature');
    expect(feature.prPrefix).toBe('feat');
    expect(feature.changelogCategory).toBe('Added');
    expect(feature.emoji).toBeTruthy();
  });

  it('bug_fix maps to Fixed category', () => {
    expect(TASK_TYPE_TEMPLATES.bug_fix.changelogCategory).toBe('Fixed');
    expect(TASK_TYPE_TEMPLATES.bug_fix.prPrefix).toBe('fix');
  });

  it('security maps to Security category', () => {
    expect(TASK_TYPE_TEMPLATES.security.changelogCategory).toBe('Security');
  });

  it('deprecation maps to Deprecated category', () => {
    expect(TASK_TYPE_TEMPLATES.deprecation.changelogCategory).toBe('Deprecated');
  });

  it('removal maps to Removed category', () => {
    expect(TASK_TYPE_TEMPLATES.removal.changelogCategory).toBe('Removed');
  });
});

describe('generatePRDescription', () => {
  it('generates basic PR description', () => {
    const summary = makeSummary();
    const result = generatePRDescription(summary);

    expect(result).toContain('## ✨ Summary');
    expect(result).toContain('Implemented JWT-based auth flow');
    expect(result).toContain('profClaw');
    expect(result).toContain('claude-sonnet');
  });

  it('includes why section when present', () => {
    const summary = makeSummary({ whyChanged: 'Users needed secure login.' });
    const result = generatePRDescription(summary);
    expect(result).toContain('### 💡 Why');
    expect(result).toContain('Users needed secure login.');
  });

  it('includes how section when present', () => {
    const summary = makeSummary({ howChanged: 'Added middleware and JWT utilities.' });
    const result = generatePRDescription(summary);
    expect(result).toContain('### 🔧 How');
    expect(result).toContain('Added middleware');
  });

  it('includes file changes when present', () => {
    const summary = makeSummary({
      filesChanged: [
        { path: 'src/auth.ts', action: 'created' },
        { path: 'src/server.ts', action: 'modified', linesAdded: 10, linesRemoved: 2 },
      ] as Summary['filesChanged'],
    });
    const result = generatePRDescription(summary);
    expect(result).toContain('### 📁 Files Changed');
    expect(result).toContain('src/auth.ts');
    expect(result).toContain('src/server.ts');
  });

  it('handles string file changes', () => {
    const summary = makeSummary({
      filesChanged: ['src/foo.ts', 'src/bar.ts'] as unknown as Summary['filesChanged'],
    });
    const result = generatePRDescription(summary);
    expect(result).toContain('`src/foo.ts`');
  });

  it('includes decisions when present', () => {
    const summary = makeSummary({
      decisions: [
        { description: 'Use JWT over sessions', reason: 'Stateless and scalable' },
      ] as Summary['decisions'],
    });
    const result = generatePRDescription(summary);
    expect(result).toContain('### 🎯 Key Decisions');
    expect(result).toContain('Use JWT over sessions');
    expect(result).toContain('Stateless and scalable');
  });

  it('includes blockers when present', () => {
    const summary = makeSummary({
      blockers: [
        { description: 'Redis timeout in CI', severity: 'error', resolved: false },
      ] as Summary['blockers'],
    });
    const result = generatePRDescription(summary);
    expect(result).toContain('### ⚠️ Known Issues');
    expect(result).toContain('Redis timeout in CI');
  });

  it('respects includeFileChanges=false option', () => {
    const summary = makeSummary({
      filesChanged: [{ path: 'src/auth.ts', action: 'created' }] as Summary['filesChanged'],
    });
    const result = generatePRDescription(summary, { includeFileChanges: false });
    expect(result).not.toContain('### 📁 Files Changed');
  });

  it('respects includeDecisions=false option', () => {
    const summary = makeSummary({
      decisions: [{ description: 'Use JWT' }] as Summary['decisions'],
    });
    const result = generatePRDescription(summary, { includeDecisions: false });
    expect(result).not.toContain('### 🎯 Key Decisions');
  });

  it('includes token stats when requested', () => {
    const summary = makeSummary({
      tokensUsed: { total: 5000 } as Summary['tokensUsed'],
      cost: { amount: 0.015 } as Summary['cost'],
    });
    const result = generatePRDescription(summary, { includeTokenStats: true });
    expect(result).toContain('### 📊 AI Stats');
    expect(result).toContain('5,000');
    expect(result).toContain('$0.0150');
  });

  it('uses correct emoji for task type', () => {
    const bugSummary = makeSummary({ taskType: 'bug_fix' });
    const result = generatePRDescription(bugSummary);
    expect(result).toContain('🐛');
  });
});

describe('generateChangelog', () => {
  const summaries = [
    makeSummary({ taskType: 'feature', title: 'Auth system', whatChanged: 'Added JWT auth' }),
    makeSummary({ taskType: 'bug_fix', title: 'Fix login', whatChanged: 'Fixed login redirect' }),
    makeSummary({ taskType: 'security', title: 'Rate limit', whatChanged: 'Added rate limiting' }),
  ];

  it('generates keepachangelog format by default', () => {
    const result = generateChangelog(summaries, { version: '2.0.0', date: '2026-03-01' });
    expect(result).toContain('## [2.0.0] - 2026-03-01');
    expect(result).toContain('### Added');
    expect(result).toContain('### Fixed');
    expect(result).toContain('### Security');
  });

  it('generates simple format', () => {
    const result = generateChangelog(summaries, { version: '2.0.0', date: '2026-03-01', format: 'simple' });
    expect(result).toContain('# Changelog - 2.0.0');
    expect(result).toContain('**Auth system**');
  });

  it('supports string version argument (backwards compat)', () => {
    const result = generateChangelog(summaries, '1.5.0');
    expect(result).toContain('[1.5.0]');
  });

  it('includes issue links when present', () => {
    const withIssue = [makeSummary({ taskType: 'feature', whatChanged: 'New feature', linkedIssue: '#42' })];
    const result = generateChangelog(withIssue, { includeIssueLinks: true });
    expect(result).toContain('#42');
  });

  it('uses issue link base for full URLs', () => {
    const withIssue = [makeSummary({ taskType: 'feature', whatChanged: 'New feature', linkedIssue: '#42' })];
    const result = generateChangelog(withIssue, {
      includeIssueLinks: true,
      issueLinkBase: 'https://github.com/profclaw/profclaw/issues/',
    });
    expect(result).toContain('https://github.com/profclaw/profclaw/issues/42');
  });

  it('omits empty categories', () => {
    const onlyFeatures = [makeSummary({ taskType: 'feature', whatChanged: 'Something new' })];
    const result = generateChangelog(onlyFeatures);
    expect(result).not.toContain('### Fixed');
    expect(result).not.toContain('### Removed');
    expect(result).toContain('### Added');
  });

  it('simple format groups linked issues', () => {
    const withIssue = [makeSummary({ taskType: 'feature', title: 'Feat', whatChanged: 'Something', linkedIssue: '10' })];
    const result = generateChangelog(withIssue, { format: 'simple', includeIssueLinks: true });
    expect(result).toContain('Linked Issue: #10');
  });
});

describe('generateReleaseNotes', () => {
  const summaries = [
    makeSummary({ taskType: 'feature', title: 'Auth', whatChanged: 'JWT auth', filesChanged: [{ path: 'a.ts', action: 'created' }] as Summary['filesChanged'] }),
    makeSummary({ taskType: 'feature', title: 'WebChat', whatChanged: 'Browser chat' }),
    makeSummary({ taskType: 'bug_fix', title: 'Fix crash', whatChanged: 'Null check' }),
    makeSummary({ taskType: 'refactor', title: 'Clean up', whatChanged: 'Removed dead code' }),
  ];

  it('generates release notes with stats', () => {
    const result = generateReleaseNotes(summaries, { version: '2.0.0' });
    expect(result).toContain('# Release 2.0.0');
    expect(result).toContain('## 📊 Overview');
    expect(result).toContain('**2** new features');
    expect(result).toContain('**1** bug fixes');
    expect(result).toContain('**1** other improvements');
  });

  it('respects custom title', () => {
    const result = generateReleaseNotes(summaries, { version: '2.0.0', title: 'profClaw v2 Launch' });
    expect(result).toContain('# profClaw v2 Launch');
  });

  it('separates features, fixes, and other', () => {
    const result = generateReleaseNotes(summaries, { version: '2.0.0' });
    expect(result).toContain('## ✨ Features');
    expect(result).toContain('## 🐛 Bug Fixes');
    expect(result).toContain('## 🔧 Other Changes');
  });

  it('hides stats when includeStats=false', () => {
    const result = generateReleaseNotes(summaries, { version: '2.0.0', includeStats: false });
    expect(result).not.toContain('## 📊 Overview');
  });

  it('handles empty summaries', () => {
    const result = generateReleaseNotes([], { version: '1.0.0' });
    expect(result).toContain('# Release 1.0.0');
    expect(result).toContain('**0** new features');
  });
});

describe('getConventionalCommitPrefix', () => {
  it('returns feat for feature', () => {
    expect(getConventionalCommitPrefix('feature')).toBe('feat');
  });

  it('returns fix for bug_fix', () => {
    expect(getConventionalCommitPrefix('bug_fix')).toBe('fix');
  });

  it('returns chore for unknown type', () => {
    expect(getConventionalCommitPrefix('unknown')).toBe('chore');
  });

  it('returns correct prefix for all known types', () => {
    expect(getConventionalCommitPrefix('refactor')).toBe('refactor');
    expect(getConventionalCommitPrefix('documentation')).toBe('docs');
    expect(getConventionalCommitPrefix('performance')).toBe('perf');
    expect(getConventionalCommitPrefix('test')).toBe('test');
    expect(getConventionalCommitPrefix('security')).toBe('security');
  });
});

describe('generateCommitMessage', () => {
  it('generates basic commit message', () => {
    const summary = makeSummary({ title: 'Add login page' });
    const result = generateCommitMessage(summary);
    expect(result).toBe('feat: Add login page');
  });

  it('includes scope when component is set', () => {
    const summary = makeSummary({ title: 'Fix bug', taskType: 'bug_fix', component: 'auth' });
    const result = generateCommitMessage(summary);
    expect(result).toBe('fix(auth): Fix bug');
  });

  it('truncates long messages to maxLength', () => {
    const summary = makeSummary({ title: 'A very long title that exceeds the default seventy-two character limit for commit messages' });
    const result = generateCommitMessage(summary, { maxLength: 50 });
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain('...');
  });

  it('includes body when requested', () => {
    const summary = makeSummary({ title: 'Add auth', whatChanged: 'Added JWT auth flow.' });
    const result = generateCommitMessage(summary, { includeBody: true });
    expect(result).toContain('feat: Add auth');
    expect(result).toContain('Added JWT auth flow.');
  });

  it('includes closes clause when linkedIssue present', () => {
    const summary = makeSummary({ title: 'Fix crash', linkedIssue: '#42' });
    const result = generateCommitMessage(summary, { includeBody: true });
    expect(result).toContain('Closes #42');
  });

  it('does not include closes clause without includeBody', () => {
    const summary = makeSummary({ title: 'Fix crash', linkedIssue: '#42' });
    const result = generateCommitMessage(summary);
    expect(result).not.toContain('Closes');
  });
});

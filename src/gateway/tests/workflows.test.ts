import { describe, it, expect } from 'vitest';
import { getWorkflow, getAllWorkflows, inferWorkflow, interpolateTemplate } from '../workflows.js';

describe('Gateway Workflows', () => {
  describe('getWorkflow', () => {
    it('should return a workflow template for a valid type', () => {
      const workflow = getWorkflow('autonomous');
      expect(workflow).toBeDefined();
      expect(workflow?.type).toBe('autonomous');
      expect(workflow?.steps.length).toBeGreaterThan(0);
    });

    it('should return undefined for an invalid type', () => {
      // @ts-ignore - testing invalid input
      const workflow = getWorkflow('invalid-type');
      expect(workflow).toBeUndefined();
    });
  });

  describe('getAllWorkflows', () => {
    it('should return all registered workflows', () => {
      const all = getAllWorkflows();
      expect(all.length).toBeGreaterThan(5);
      expect(all.some(w => w.type === 'autonomous')).toBe(true);
      expect(all.some(w => w.type === 'fix')).toBe(true);
    });
  });

  describe('inferWorkflow', () => {
    it('should infer "fix" from labels', () => {
      const task = { title: 'Test', labels: ['bug'], prompt: 'test' };
      expect(inferWorkflow(task)).toBe('fix');
    });

    it('should infer "feature" from labels', () => {
      const task = { title: 'Test', labels: ['feature'], prompt: 'test' };
      expect(inferWorkflow(task)).toBe('feature');
    });

    it('should infer "review" from content', () => {
      const task = { title: 'Review this code', labels: [], prompt: 'check it' };
      expect(inferWorkflow(task)).toBe('review');
    });

    it('should infer "docs" from content', () => {
      const task = { title: 'Update README', labels: [], prompt: 'add info' };
      expect(inferWorkflow(task)).toBe('docs');
    });

    it('should default to "autonomous"', () => {
      const task = { title: 'Complex task', labels: [], prompt: 'do everything' };
      expect(inferWorkflow(task)).toBe('autonomous');
    });
  });

  describe('interpolateTemplate', () => {
    it('should replace task variables', () => {
      const template = 'Task {{task.id}}: {{task.title}} ({{task.description}}) - {{task.prompt}}';
      const context = {
        task: {
          id: '123',
          title: 'My Task',
          description: 'A description',
          prompt: 'The prompt'
        }
      };
      
      const result = interpolateTemplate(template, context);
      expect(result).toBe('Task 123: My Task (A description) - The prompt');
    });

    it('should handle missing description', () => {
      const template = 'Desc: {{task.description}}';
      const context = {
        task: { id: '1', title: 'T', prompt: 'P' }
      };
      const result = interpolateTemplate(template, context);
      expect(result).toBe('Desc: ');
    });

    it('should replace previous step output', () => {
      const template = 'Prev: {{previousStep.output}}';
      const context = {
        task: { id: '1', title: 'T', prompt: 'P' },
        previousStep: { output: 'Step 1 success' }
      };
      const result = interpolateTemplate(template, context);
      expect(result).toBe('Prev: Step 1 success');
    });

    it('should replace custom variables', () => {
      const template = 'Hello {{name}} from {{place}}';
      const context = {
        task: { id: '1', title: 'T', prompt: 'P' },
        variables: { name: 'World', place: 'Orbit' }
      };
      const result = interpolateTemplate(template, context);
      expect(result).toBe('Hello World from Orbit');
    });
  });
});

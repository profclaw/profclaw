/**
 * PlanView Component
 *
 * Renders a Plan with steps. Each step shows: index, description,
 * and status (checkbox style).
 * - Green checkmark for completed
 * - Yellow circle for in_progress
 * - Gray dash for pending
 */

import React from 'react';
import { Box, Text } from 'ink';

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  index: number;
  description: string;
  status: PlanStepStatus;
  detail?: string;
}

export interface PlanViewProps {
  title?: string;
  steps: PlanStep[];
}

const STEP_ICON: Record<PlanStepStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '✓',
  failed: '✗',
  skipped: '—',
};

const STEP_COLOR: Record<PlanStepStatus, string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
  failed: 'red',
  skipped: 'gray',
};

const PlanStepRow: React.FC<{ step: PlanStep }> = ({ step }) => {
  const icon = STEP_ICON[step.status];
  const color = STEP_COLOR[step.status];
  const isActive = step.status === 'in_progress';

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{icon}</Text>
        <Text color={isActive ? 'white' : 'gray'} bold={isActive}>
          {step.index + 1}.
        </Text>
        <Text color={isActive ? 'white' : 'gray'}>{step.description}</Text>
      </Box>
      {step.detail !== undefined && step.detail.length > 0 && (
        <Box paddingLeft={4}>
          <Text dimColor>{step.detail}</Text>
        </Box>
      )}
    </Box>
  );
};

export const PlanView: React.FC<PlanViewProps> = ({ title, steps }) => {
  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      {title !== undefined && title.length > 0 && (
        <Text bold color="cyan">
          {title}
        </Text>
      )}
      {steps.map((step) => (
        <PlanStepRow key={step.index} step={step} />
      ))}
    </Box>
  );
};

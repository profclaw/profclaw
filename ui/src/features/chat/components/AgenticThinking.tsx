/**
 * Agentic Thinking Display
 *
 * Shows real-time thinking, tool calls, and progress during agentic execution.
 */

import { useState, useEffect } from 'react';
import {
  Brain,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// =============================================================================
// Types
// =============================================================================

export interface AgenticEvent {
  type:
    | 'session:start'
    | 'thinking:start'
    | 'thinking:update'
    | 'thinking:end'
    | 'step:start'
    | 'step:complete'
    | 'tool:call'
    | 'tool:result'
    | 'content'
    | 'summary'
    | 'complete'
    | 'error'
    | 'user_message'
    | 'message_saved';
  data: Record<string, unknown>;
  timestamp: number;
}

export interface AgenticThinkingProps {
  events: AgenticEvent[];
  isActive: boolean;
  className?: string;
}

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  startTime: number;
  result?: unknown;
  status: 'pending' | 'success' | 'error';
  error?: string;
  duration?: number;
}

interface StepState {
  step: number;
  toolCalls: ToolCallState[];
  thinking?: string;
  complete: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function AgenticThinking({ events, isActive, className }: AgenticThinkingProps) {
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [currentThinking, setCurrentThinking] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const devMode = typeof window !== 'undefined' && localStorage.getItem('profclaw-dev-mode') === 'true';

  // Process events into structured state
  useEffect(() => {
    const newSteps: StepState[] = [];
    let currentStepNum = 0;
    const toolCalls: Map<string, ToolCallState> = new Map();

    for (const event of events) {
      switch (event.type) {
        case 'thinking:start':
        case 'thinking:update':
          setCurrentThinking((event.data as { message?: string }).message || 'Thinking...');
          break;

        case 'thinking:end':
          setCurrentThinking(null);
          break;

        case 'step:start': {
          const stepData = event.data as { step: number };
          currentStepNum = stepData.step;
          // Ensure we have a step entry
          if (!newSteps.find((s) => s.step === currentStepNum)) {
            newSteps.push({
              step: currentStepNum,
              toolCalls: [],
              complete: false,
            });
          }
          break;
        }

        case 'step:complete': {
          const stepData = event.data as { step: number };
          const step = newSteps.find((s) => s.step === stepData.step);
          if (step) {
            step.complete = true;
          }
          break;
        }

        case 'tool:call': {
          const toolData = event.data as {
            id: string;
            name: string;
            args: Record<string, unknown>;
            step: number;
          };
          const toolCall: ToolCallState = {
            id: toolData.id,
            name: toolData.name,
            args: toolData.args,
            startTime: event.timestamp,
            status: 'pending',
          };
          toolCalls.set(toolData.id, toolCall);

          // Add to current step
          const step = newSteps.find((s) => s.step === toolData.step);
          if (step) {
            step.toolCalls.push(toolCall);
          }
          break;
        }

        case 'tool:result': {
          const resultData = event.data as {
            id: string;
            result: unknown;
            status: string;
            error?: string;
            duration?: number;
          };
          const toolCall = toolCalls.get(resultData.id);
          if (toolCall) {
            toolCall.result = resultData.result;
            toolCall.status = resultData.status === 'executed' ? 'success' : 'error';
            toolCall.error = resultData.error;
            toolCall.duration = resultData.duration;
          }
          break;
        }

        case 'summary': {
          const summaryData = event.data as { summary: string };
          setSummary(summaryData.summary);
          break;
        }

        case 'complete': {
          const completeData = event.data as { totalTokens: number };
          setTotalTokens(completeData.totalTokens);
          break;
        }

        case 'error': {
          const errorData = event.data as { message: string };
          setError(errorData.message);
          break;
        }
      }
    }

    setSteps(newSteps);
  }, [events]);

  // Auto-collapse when complete
  useEffect(() => {
    if (!isActive && (summary || error)) {
      // Delay collapse for user to see completion
      const timer = setTimeout(() => setExpanded(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isActive, summary, error]);

  if (events.length === 0 && !isActive) {
    return null;
  }

  const totalToolCalls = steps.reduce((acc, s) => acc + s.toolCalls.length, 0);
  const completedSteps = steps.filter((s) => s.complete).length;

  return (
    <div
      className={cn(
        'rounded-xl bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-300',
        isActive
          ? 'ring-1 ring-blue-500/30 shadow-sm shadow-blue-500/10'
          : error
            ? 'ring-1 ring-destructive/30'
            : 'bg-muted/30',
        className
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-3 text-left hover:bg-muted/30 transition-colors',
          isActive ? 'p-3 animate-pulse' : devMode ? 'p-3' : 'px-3 py-2'
        )}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isActive ? (
            <>
              <Brain className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
              <span className="text-sm font-medium truncate">
                {currentThinking || `Executing step ${completedSteps + 1}...`}
              </span>
            </>
          ) : error ? (
            <>
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-sm font-medium text-destructive truncate">
                Execution failed
              </span>
            </>
          ) : !devMode ? (
            <>
              <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-muted-foreground">Done</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 text-green-400 shrink-0" />
              <span className="text-sm font-medium truncate">
                Completed in {completedSteps} step{completedSteps !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        {/* Stats badge — only in dev mode or while active */}
        {(devMode || isActive) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            {totalToolCalls > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50">
                <Wrench className="h-3 w-3" />
                {totalToolCalls}
              </span>
            )}
            {totalTokens > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-muted/50">
                {totalTokens.toLocaleString()} tokens
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/20 p-3 space-y-3">
          {/* Error display */}
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Summary */}
          {summary && !error && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm">
              {summary}
            </div>
          )}

          {/* Steps timeline */}
          {steps.length > 0 && (
            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </Button>

              {showDetails && (
                <div className="space-y-2 pl-2 border-l-2 border-blue-500/20">
                  {steps.map((step) => (
                    <div key={step.step} className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        {step.complete ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                        ) : (
                          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                        )}
                        <span className="font-medium">Step {step.step}</span>
                        <span className="text-muted-foreground text-xs">
                          {step.toolCalls.length} tool call
                          {step.toolCalls.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Tool calls in this step */}
                      {step.toolCalls.length > 0 && (
                        <div className="ml-5 space-y-1">
                          {step.toolCalls.map((toolCall) => (
                            <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active thinking indicator */}
          {isActive && !currentThinking && steps.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Initializing agent...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Tool Call Display
// =============================================================================

function ToolCallDisplay({ toolCall }: { toolCall: ToolCallState }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg bg-muted/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}

        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-mono flex-1 truncate">{toolCall.name}</span>

        {toolCall.status === 'pending' ? (
          <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
        ) : toolCall.status === 'success' ? (
          <CheckCircle2 className="h-3 w-3 text-green-400" />
        ) : (
          <AlertCircle className="h-3 w-3 text-destructive" />
        )}

        {toolCall.duration && (
          <span className="text-xs text-muted-foreground">{toolCall.duration}ms</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/20 p-2 space-y-2">
          {/* Arguments */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Arguments</div>
            <pre className="text-xs bg-background/50 rounded p-2 overflow-x-auto">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {toolCall.result !== undefined && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Result</div>
              <pre className="text-xs bg-background/50 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {toolCall.error && (
            <div>
              <div className="text-xs font-medium text-destructive mb-1">Error</div>
              <pre className="text-xs bg-destructive/10 rounded p-2 overflow-x-auto text-destructive">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

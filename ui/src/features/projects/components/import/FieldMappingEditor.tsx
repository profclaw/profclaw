/**
 * Field Mapping Editor
 *
 * Visual UI for mapping source fields (GitHub) to target fields (GLINR).
 * Shows auto-mapped values and highlights unmapped ones.
 */

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Check,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type FieldMappings,
  type GitHubProjectItem,
  GLINR_STATUSES,
  GLINR_PRIORITIES,
  GLINR_TYPES,
} from './types';

interface FieldMappingEditorProps {
  items: GitHubProjectItem[];
  mappings: FieldMappings;
  onMappingsChange: (mappings: FieldMappings) => void;
}

interface FieldConfig {
  key: keyof FieldMappings;
  label: string;
  options: readonly { value: string; label: string; color?: string; icon?: string }[];
  defaultValue: string;
}

const FIELD_CONFIGS: FieldConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: GLINR_STATUSES,
    defaultValue: 'backlog',
  },
  {
    key: 'priority',
    label: 'Priority',
    options: GLINR_PRIORITIES,
    defaultValue: 'medium',
  },
  {
    key: 'type',
    label: 'Type',
    options: GLINR_TYPES,
    defaultValue: 'task',
  },
];

export function FieldMappingEditor({
  items,
  mappings,
  onMappingsChange,
}: FieldMappingEditorProps) {
  // Extract unique source values from items
  const sourceValues = useMemo(() => {
    const values = {
      status: new Set<string>(),
      priority: new Set<string>(),
      type: new Set<string>(),
    };

    for (const item of items) {
      if (item.status) values.status.add(item.status);
      if (item.priority) values.priority.add(item.priority);
      if (item.type) values.type.add(item.type);
    }

    return {
      status: Array.from(values.status).sort(),
      priority: Array.from(values.priority).sort(),
      type: Array.from(values.type).sort(),
    };
  }, [items]);

  // Count items per source value
  const valueCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {
      status: {},
      priority: {},
      type: {},
    };

    for (const item of items) {
      if (item.status) {
        counts.status[item.status] = (counts.status[item.status] || 0) + 1;
      }
      if (item.priority) {
        counts.priority[item.priority] = (counts.priority[item.priority] || 0) + 1;
      }
      if (item.type) {
        counts.type[item.type] = (counts.type[item.type] || 0) + 1;
      }
    }

    return counts;
  }, [items]);

  // Check if a value is mapped
  const isMapped = (field: keyof FieldMappings, sourceValue: string) => {
    return !!mappings[field][sourceValue];
  };

  // Get unmapped count per field
  const unmappedCounts = useMemo(() => {
    return {
      status: sourceValues.status.filter((v) => !isMapped('status', v)).length,
      priority: sourceValues.priority.filter((v) => !isMapped('priority', v)).length,
      type: sourceValues.type.filter((v) => !isMapped('type', v)).length,
    };
  }, [sourceValues, mappings]);

  // Update a single mapping
  const updateMapping = (
    field: keyof FieldMappings,
    sourceValue: string,
    targetValue: string
  ) => {
    onMappingsChange({
      ...mappings,
      [field]: {
        ...mappings[field],
        [sourceValue]: targetValue,
      },
    });
  };

  // Auto-map all unmapped values to defaults
  const autoMapAll = () => {
    const newMappings = { ...mappings };

    for (const config of FIELD_CONFIGS) {
      const field = config.key;
      for (const value of sourceValues[field]) {
        if (!newMappings[field][value]) {
          // Try to find a matching option by name similarity
          const match = config.options.find(
            (opt) =>
              opt.label.toLowerCase() === value.toLowerCase() ||
              opt.value.toLowerCase() === value.toLowerCase()
          );
          newMappings[field][value] = match?.value || config.defaultValue;
        }
      }
    }

    onMappingsChange(newMappings);
  };

  // Reset all mappings
  const resetMappings = () => {
    onMappingsChange({ status: {}, priority: {}, type: {} });
  };

  const totalUnmapped = unmappedCounts.status + unmappedCounts.priority + unmappedCounts.type;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Field Mappings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Map GitHub fields to GLINR values
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalUnmapped > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={autoMapAll}
              className="gap-2"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Auto-map {totalUnmapped} values
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={resetMappings}
            className="gap-2 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Warning banner for unmapped */}
      {totalUnmapped > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-amber-700 dark:text-amber-400">
            {totalUnmapped} value{totalUnmapped !== 1 ? 's' : ''} need{totalUnmapped === 1 ? 's' : ''} mapping.
            Items with unmapped values will use defaults.
          </span>
        </div>
      )}

      {/* Field mapping sections */}
      <div className="space-y-6">
        {FIELD_CONFIGS.map((config) => {
          const values = sourceValues[config.key];
          const unmapped = unmappedCounts[config.key];

          if (values.length === 0) return null;

          return (
            <div key={config.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">{config.label}</h4>
                {unmapped > 0 ? (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20">
                    {unmapped} unmapped
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-900/20">
                    <Check className="h-3 w-3 mr-1" />
                    All mapped
                  </Badge>
                )}
              </div>

              <div className="rounded-2xl glass shadow-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                        GitHub Value
                      </th>
                      <th className="w-10"></th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                        GLINR Value
                      </th>
                      <th className="text-right py-2 px-3 font-medium text-muted-foreground w-20">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {values.map((sourceValue) => {
                      const mapped = isMapped(config.key, sourceValue);
                      const targetValue = mappings[config.key][sourceValue];
                      const targetOption = config.options.find(
                        (o) => o.value === targetValue
                      );

                      return (
                        <tr
                          key={sourceValue}
                          className={cn(
                            'transition-colors',
                            !mapped && 'bg-amber-50/50 dark:bg-amber-900/10'
                          )}
                        >
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              {!mapped && (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              )}
                              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                                {sourceValue}
                              </span>
                            </div>
                          </td>
                          <td className="text-center text-muted-foreground">
                            <ArrowRight className="h-4 w-4 mx-auto" />
                          </td>
                          <td className="py-2 px-3">
                            <Select
                              value={targetValue || ''}
                              onValueChange={(v) =>
                                updateMapping(config.key, sourceValue, v)
                              }
                            >
                              <SelectTrigger
                                className={cn(
                                  'h-8 w-48',
                                  !mapped && 'border-amber-300 bg-amber-50 dark:bg-amber-900/20'
                                )}
                              >
                                <SelectValue placeholder="Select mapping...">
                                  {targetOption && (
                                    <div className="flex items-center gap-2">
                                      {'color' in targetOption && (
                                        <span
                                          className="w-2.5 h-2.5 rounded-full"
                                          style={{ backgroundColor: targetOption.color }}
                                        />
                                      )}
                                      {'icon' in targetOption && (
                                        <span>{targetOption.icon}</span>
                                      )}
                                      <span>{targetOption.label}</span>
                                    </div>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {config.options.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    <div className="flex items-center gap-2">
                                      {'color' in option && (
                                        <span
                                          className="w-2.5 h-2.5 rounded-full"
                                          style={{ backgroundColor: option.color }}
                                        />
                                      )}
                                      {'icon' in option && <span>{option.icon}</span>}
                                      <span>{option.label}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-2 px-3 text-right text-muted-foreground tabular-nums">
                            {valueCounts[config.key][sourceValue] || 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Import Preview Table
 *
 * Interactive TanStack Table showing all items that will be imported.
 * Displays source data → target mapping with conflict highlighting.
 */

import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Search,
  ArrowUpDown,
  AlertTriangle,
  Check,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ImportPreviewItem,
  type FieldMappings,
  type GitHubProjectItem,
  PROFCLAW_STATUSES,
  PROFCLAW_PRIORITIES,
  PROFCLAW_TYPES,
} from './types';

interface ImportPreviewTableProps {
  items: GitHubProjectItem[];
  mappings: FieldMappings;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

// Transform items to preview format
function transformToPreviewItems(
  items: GitHubProjectItem[],
  mappings: FieldMappings
): ImportPreviewItem[] {
  return items.map((item) => {
    const statusMapped = item.status ? !!mappings.status[item.status] : true;
    const priorityMapped = item.priority ? !!mappings.priority[item.priority] : true;
    const typeMapped = item.type ? !!mappings.type[item.type] : true;

    const conflicts: ImportPreviewItem['conflicts'] = [];
    if (!statusMapped && item.status) {
      conflicts.push({
        field: 'status',
        severity: 'warning',
        message: `Status "${item.status}" is not mapped`,
        suggestion: 'Will use default: backlog',
      });
    }
    if (!priorityMapped && item.priority) {
      conflicts.push({
        field: 'priority',
        severity: 'warning',
        message: `Priority "${item.priority}" is not mapped`,
        suggestion: 'Will use default: medium',
      });
    }
    if (!typeMapped && item.type) {
      conflicts.push({
        field: 'type',
        severity: 'warning',
        message: `Type "${item.type}" is not mapped`,
        suggestion: 'Will use default: task',
      });
    }

    return {
      id: item.id,
      source: item,
      target: {
        title: item.title,
        description: item.body || '',
        status: item.status ? mappings.status[item.status] || 'backlog' : 'backlog',
        priority: item.priority ? mappings.priority[item.priority] || 'medium' : 'medium',
        type: item.type ? mappings.type[item.type] || 'task' : 'task',
        labels: item.labels,
        assignee: item.assignees[0] || null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
      mappingStatus: {
        status: statusMapped ? 'mapped' : 'unmapped',
        priority: priorityMapped ? 'mapped' : 'unmapped',
        type: typeMapped ? 'mapped' : 'unmapped',
      },
      conflicts,
      selected: true,
    };
  });
}

export function ImportPreviewTable({
  items,
  mappings,
  selectedIds,
  onSelectionChange,
}: ImportPreviewTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const data = useMemo(
    () => transformToPreviewItems(items, mappings),
    [items, mappings]
  );

  const columns = useMemo<ColumnDef<ImportPreviewItem>[]>(
    () => [
      // Selection checkbox
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => {
              table.toggleAllPageRowsSelected(!!value);
              const newSelection = new Set<string>();
              if (value) {
                data.forEach((item) => newSelection.add(item.id));
              }
              onSelectionChange(newSelection);
            }}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original.id)}
            onCheckedChange={(value) => {
              const newSelection = new Set(selectedIds);
              if (value) {
                newSelection.add(row.original.id);
              } else {
                newSelection.delete(row.original.id);
              }
              onSelectionChange(newSelection);
            }}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      // Status indicator
      {
        id: 'status-indicator',
        header: '',
        cell: ({ row }) => {
          const hasConflicts = row.original.conflicts.length > 0;
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center">
                    {hasConflicts ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {hasConflicts
                    ? row.original.conflicts.map((c) => c.message).join(', ')
                    : 'Ready to import'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
        size: 40,
      },
      // Title
      {
        accessorKey: 'source.title',
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Title
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="max-w-[300px]">
            <p className="font-medium truncate" title={row.original.source.title}>
              {row.original.source.title}
            </p>
            {row.original.source.url && (
              <a
                href={row.original.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
              >
                #{row.original.source.issueNumber || 'View'}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ),
      },
      // Status mapping
      {
        id: 'status-mapping',
        header: 'Status',
        cell: ({ row }) => {
          const source = row.original.source.status;
          const target = row.original.target.status;
          const isMapped = row.original.mappingStatus.status === 'mapped';
          const targetOption = PROFCLAW_STATUSES.find((s) => s.value === target);

          return (
            <div className="flex items-center gap-1.5 text-xs">
              {source ? (
                <>
                  <span className="font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[80px]">
                    {source}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Badge
                    variant={isMapped ? 'outline' : 'secondary'}
                    className={cn(
                      'gap-1',
                      !isMapped && 'bg-amber-100 text-amber-700 border-amber-200'
                    )}
                  >
                    {targetOption && (
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: targetOption.color }}
                      />
                    )}
                    {targetOption?.label || target}
                  </Badge>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      // Priority mapping
      {
        id: 'priority-mapping',
        header: 'Priority',
        cell: ({ row }) => {
          const source = row.original.source.priority;
          const target = row.original.target.priority;
          const isMapped = row.original.mappingStatus.priority === 'mapped';
          const targetOption = PROFCLAW_PRIORITIES.find((p) => p.value === target);

          return (
            <div className="flex items-center gap-1.5 text-xs">
              {source ? (
                <>
                  <span className="font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[60px]">
                    {source}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Badge
                    variant={isMapped ? 'outline' : 'secondary'}
                    className={cn(
                      'gap-1',
                      !isMapped && 'bg-amber-100 text-amber-700 border-amber-200'
                    )}
                  >
                    {targetOption && (
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: targetOption.color }}
                      />
                    )}
                    {targetOption?.label || target}
                  </Badge>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      // Type mapping
      {
        id: 'type-mapping',
        header: 'Type',
        cell: ({ row }) => {
          const source = row.original.source.type;
          const target = row.original.target.type;
          const isMapped = row.original.mappingStatus.type === 'mapped';
          const targetOption = PROFCLAW_TYPES.find((t) => t.value === target);

          return (
            <div className="flex items-center gap-1.5 text-xs">
              {source ? (
                <>
                  <span className="font-mono bg-muted px-1.5 py-0.5 rounded truncate max-w-[60px]">
                    {source}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Badge
                    variant={isMapped ? 'outline' : 'secondary'}
                    className={cn(
                      'gap-1',
                      !isMapped && 'bg-amber-100 text-amber-700 border-amber-200'
                    )}
                  >
                    {targetOption?.icon} {targetOption?.label || target}
                  </Badge>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      // Labels
      {
        accessorKey: 'source.labels',
        header: 'Labels',
        cell: ({ row }) => {
          const labels = row.original.source.labels;
          if (labels.length === 0) return <span className="text-muted-foreground">—</span>;

          return (
            <div className="flex flex-wrap gap-1 max-w-[150px]">
              {labels.slice(0, 2).map((label) => (
                <Badge key={label} variant="secondary" className="text-[10px]">
                  {label}
                </Badge>
              ))}
              {labels.length > 2 && (
                <Badge variant="outline" className="text-[10px]">
                  +{labels.length - 2}
                </Badge>
              )}
            </div>
          );
        },
      },
      // Created date
      {
        accessorKey: 'source.createdAt',
        header: 'Created',
        cell: ({ row }) => {
          const date = new Date(row.original.source.createdAt);
          return (
            <span className="text-xs text-muted-foreground tabular-nums">
              {date.toLocaleDateString()}
            </span>
          );
        },
      },
    ],
    [data, selectedIds, onSelectionChange]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  });

  const conflictCount = data.filter((d) => d.conflicts.length > 0).length;
  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-4">
      {/* Header with search and stats */}
      <div className="flex items-center justify-between">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span>
            <span className="font-medium">{selectedCount}</span>
            <span className="text-muted-foreground"> of {data.length} selected</span>
          </span>
          {conflictCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              {conflictCount} with warnings
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl glass shadow-lg overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={selectedIds.has(row.original.id) && 'selected'}
                  className={cn(
                    row.original.conflicts.length > 0 && 'bg-amber-50/50 dark:bg-amber-900/10'
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No items found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Show</span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>per page</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

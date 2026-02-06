/**
 * Date Range Picker Component
 *
 * A beautiful date range picker with calendar popover.
 * Supports selecting start and end dates with visual feedback.
 */

import * as React from "react"
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns"
import { Calendar as CalendarIcon, X, Check } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateRangePickerProps {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  presets?: boolean
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  className,
  disabled = false,
  presets = true,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  // Internal state to track selection before confirming
  const [internalValue, setInternalValue] = React.useState<DateRange | undefined>(value)

  // Sync internal value when external value changes
  React.useEffect(() => {
    setInternalValue(value)
  }, [value])

  const handleSelect = (range: DateRange | undefined) => {
    setInternalValue(range)
    // Also update parent immediately for visual feedback
    onChange?.(range)
  }

  const handlePreset = (days: number) => {
    const from = new Date()
    const to = addDays(from, days)
    const range = { from, to }
    setInternalValue(range)
    onChange?.(range)
    setOpen(false)
  }

  const handleThisWeek = () => {
    const now = new Date()
    const range = { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    setInternalValue(range)
    onChange?.(range)
    setOpen(false)
  }

  const handleThisMonth = () => {
    const now = new Date()
    const range = { from: startOfMonth(now), to: endOfMonth(now) }
    setInternalValue(range)
    onChange?.(range)
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setInternalValue(undefined)
    onChange?.(undefined)
  }

  const handleDone = () => {
    onChange?.(internalValue)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value?.from && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value?.from ? (
            value.to ? (
              <>
                {format(value.from, "LLL dd, y")} - {format(value.to, "LLL dd, y")}
              </>
            ) : (
              format(value.from, "LLL dd, y")
            )
          ) : (
            <span>{placeholder}</span>
          )}
          {value?.from && (
            <X
              className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
              onClick={handleClear}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          <div className="flex">
            {presets && (
              <div className="border-r border-border p-2 space-y-1 min-w-30">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                  Quick Select
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm h-8"
                  onClick={() => handlePreset(7)}
                >
                  1 week
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm h-8"
                  onClick={() => handlePreset(14)}
                >
                  2 weeks
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm h-8"
                  onClick={() => handlePreset(21)}
                >
                  3 weeks
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm h-8"
                  onClick={() => handlePreset(30)}
                >
                  1 month
                </Button>
                <div className="border-t border-border my-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm h-8"
                  onClick={handleThisWeek}
                >
                  This week
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm h-8"
                  onClick={handleThisMonth}
                >
                  This month
                </Button>
              </div>
            )}
            <Calendar
              mode="range"
              defaultMonth={internalValue?.from}
              selected={internalValue}
              onSelect={handleSelect}
              numberOfMonths={2}
            />
          </div>
          {/* Footer with selection info and done button */}
          <div className="flex items-center justify-between border-t border-border p-3 bg-muted/30">
            <div className="text-sm text-muted-foreground">
              {internalValue?.from && internalValue?.to ? (
                <span className="text-foreground font-medium">
                  {Math.ceil((internalValue.to.getTime() - internalValue.from.getTime()) / (1000 * 60 * 60 * 24))} days selected
                </span>
              ) : internalValue?.from ? (
                <span>Select end date</span>
              ) : (
                <span>Select start date</span>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleDone}
              disabled={!internalValue?.from}
              className="gap-1"
            >
              <Check className="h-4 w-4" />
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

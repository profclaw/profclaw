/**
 * JSON Override Editor Component
 *
 * Allows raw JSON editing of settings for advanced configuration.
 */

import { useState, useEffect } from 'react';
import {
  FileJson,
  Code2,
  Copy,
  X,
  Save,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Settings as SettingsType } from '@/core/api/client';

interface JsonOverrideEditorProps {
  settings?: SettingsType;
  onSave: (settings: Partial<SettingsType>) => void;
  isSaving: boolean;
}

export function JsonOverrideEditor({
  settings,
  onSave,
  isSaving,
}: JsonOverrideEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [jsonValue, setJsonValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize JSON when settings load or editing starts
  useEffect(() => {
    if (settings && isEditing) {
      const formatted = JSON.stringify(settings, null, 2);
      setJsonValue(formatted);
      setHasChanges(false);
      setError(null);
    }
  }, [settings, isEditing]);

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    setHasChanges(true);

    // Validate JSON
    try {
      JSON.parse(value);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      onSave(parsed);
      setIsEditing(false);
      setHasChanges(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const handleDiscard = () => {
    setIsEditing(false);
    setJsonValue('');
    setError(null);
    setHasChanges(false);
  };

  const handleCopyToClipboard = async () => {
    const text = settings ? JSON.stringify(settings, null, 2) : '{}';
    await navigator.clipboard.writeText(text);
    toast.success('Settings copied to clipboard');
  };

  if (!isEditing) {
    // Preview mode - show formatted JSON with option to edit
    return (
      <div className="space-y-4">
        {/* Preview Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Current settings as JSON
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyToClipboard}
              className="h-8 rounded-lg"
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-8 rounded-lg"
            >
              <Code2 className="h-3.5 w-3.5 mr-1.5" />
              Edit JSON
            </Button>
          </div>
        </div>

        {/* JSON Preview */}
        <div className="rounded-xl overflow-hidden border border-border">
          {/* Header bar */}
          <div className="bg-muted/80 px-4 py-2 flex items-center gap-2 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-[10px] text-muted-foreground ml-2 font-mono">
              settings.json
            </span>
          </div>

          {/* JSON Content */}
          <pre className="bg-zinc-950 dark:bg-zinc-900 p-4 overflow-x-auto max-h-75 overflow-y-auto">
            <code className="text-xs font-mono text-zinc-300 whitespace-pre">
              {settings ? JSON.stringify(settings, null, 2) : 'Loading...'}
            </code>
          </pre>
        </div>

        {/* Info */}
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <AlertCircle className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-blue-400 mb-1">About JSON Override</p>
            <p>
              Edit settings directly as JSON for advanced configuration. Changes
              made here will override UI settings. Invalid JSON will be rejected.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Edit mode - full JSON editor
  return (
    <div className="space-y-4">
      {/* Editor Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Editing Raw JSON</span>
          {hasChanges && (
            <span className="flex items-center gap-1 text-xs text-amber-500">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={isSaving}
            className="h-8 rounded-lg text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !!error || !hasChanges}
            className="h-8 rounded-lg"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Apply JSON
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-red-400 mb-0.5">Invalid JSON</p>
            <p className="text-red-400/80 font-mono">{error}</p>
          </div>
        </div>
      )}

      {/* JSON Editor */}
      <div className="rounded-xl overflow-hidden border border-border">
        {/* Header bar */}
        <div
          className={cn(
            'px-4 py-2 flex items-center justify-between border-b',
            error
              ? 'bg-red-500/10 border-red-500/20'
              : 'bg-muted/80 border-border'
          )}
        >
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-[10px] text-muted-foreground ml-2 font-mono">
              settings.json
            </span>
          </div>
          {!error && (
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Valid JSON
            </span>
          )}
        </div>

        {/* Textarea Editor */}
        <textarea
          value={jsonValue}
          onChange={(e) => handleJsonChange(e.target.value)}
          className={cn(
            'w-full bg-zinc-950 dark:bg-zinc-900 p-4 font-mono text-xs text-zinc-300',
            'min-h-100 max-h-150 resize-y',
            'focus:outline-none focus:ring-0 border-none',
            error && 'text-red-400'
          )}
          spellCheck={false}
          placeholder="{}"
        />
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-amber-400 mb-1">Caution</p>
          <p>
            Changes made here will completely replace your current settings. Make
            sure you understand the JSON structure before saving. Invalid
            configurations may cause unexpected behavior.
          </p>
        </div>
      </div>
    </div>
  );
}

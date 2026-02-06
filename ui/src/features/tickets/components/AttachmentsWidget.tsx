import { useState, useCallback } from 'react';
import { Paperclip, Upload, X, File, Image, FileText, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;  // MIME type
  url?: string;
  uploadedAt: string;
  uploadedBy?: string;
}

interface AttachmentsWidgetProps {
  ticketId: string;
  attachments?: Attachment[];
  readOnly?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string): React.ReactNode {
  if (type.startsWith('image/')) {
    return <Image className="h-4 w-4 text-blue-400" />;
  }
  if (type.startsWith('text/')) {
    return <FileText className="h-4 w-4 text-amber-400" />;
  }
  return <File className="h-4 w-4 text-zinc-500" />;
}

export function AttachmentsWidget({ ticketId, attachments = [], readOnly = false }: AttachmentsWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>(attachments);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly) {
      setIsDragging(true);
    }
  }, [readOnly]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (readOnly) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Visual feedback only - no actual upload API yet
      toast.info(`Would upload ${files.length} file(s) to ticket ${ticketId}`);

      // Demo: add to local state (remove when real API is implemented)
      const newAttachments: Attachment[] = files.map((file, idx) => ({
        id: `temp-${Date.now()}-${idx}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
      }));
      setLocalAttachments(prev => [...prev, ...newAttachments]);
    }
  }, [readOnly, ticketId]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;

    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      toast.info(`Would upload ${files.length} file(s) to ticket ${ticketId}`);

      // Demo: add to local state (remove when real API is implemented)
      const newAttachments: Attachment[] = files.map((file, idx) => ({
        id: `temp-${Date.now()}-${idx}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(),
      }));
      setLocalAttachments(prev => [...prev, ...newAttachments]);
    }

    // Reset input
    e.target.value = '';
  }, [readOnly, ticketId]);

  const handleRemove = useCallback((attachmentId: string) => {
    if (readOnly) return;

    // Client-side only for now
    setLocalAttachments(prev => prev.filter(a => a.id !== attachmentId));
    toast.success('Attachment removed');
  }, [readOnly]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-sm font-medium text-zinc-200 hover:text-zinc-100 w-full">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          )}
          <Paperclip className="h-4 w-4 text-zinc-500" />
          <span>Attachments</span>
          {localAttachments.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {localAttachments.length}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3">
        {/* Upload zone */}
        {!readOnly && (
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-4 transition-colors",
              isDragging
                ? "border-indigo-500/50 bg-indigo-500/5"
                : "border-zinc-700 hover:border-zinc-600"
            )}
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className="h-5 w-5 text-zinc-500" />
              <div className="text-sm text-zinc-400">
                Drag files here or{' '}
                <label className="text-indigo-400 hover:text-indigo-300 cursor-pointer">
                  browse
                  <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Attachments list */}
        {localAttachments.length > 0 ? (
          <div className="space-y-2">
            {localAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="bg-zinc-800/30 rounded-md p-2 flex items-center gap-2"
              >
                {getFileIcon(attachment.type)}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 truncate">
                    {attachment.name}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {formatFileSize(attachment.size)}
                    {attachment.uploadedBy && (
                      <> · {attachment.uploadedBy}</>
                    )}
                  </div>
                </div>
                {attachment.url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-300"
                    onClick={() => window.open(attachment.url, '_blank')}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400"
                    onClick={() => handleRemove(attachment.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500 text-center py-2">
            No attachments
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

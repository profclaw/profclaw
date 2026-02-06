import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Task } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function CreateTaskModal() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [source, setSource] = useState('manual');
  const [priority, setPriority] = useState('3');
  
  const queryClient = useQueryClient();

  const { mutate: createTask, isPending } = useMutation({
    mutationFn: (data: Partial<Task>) => api.tasks.create(data),
    onSuccess: () => {
      toast.success('Task created successfully!');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setOpen(false);
      // Reset form
      setTitle('');
      setDescription('');
      setPrompt('');
      setSource('manual');
      setPriority('3');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create task: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    if (!prompt.trim()) {
      toast.error('Prompt is required');
      return;
    }

    createTask({
      title,
      description: description || undefined,
      prompt,
      source,
      priority: parseInt(priority),
      labels: [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px] glass rounded-[24px] border-white/10">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Create New Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new task for the AI agents to execute
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title" className="text-sm font-semibold">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                placeholder="Fix bug in authentication"
                className="bg-white/5 border-white/10 rounded-xl"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description" className="text-sm font-semibold">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
                className="bg-white/5 border-white/10 rounded-xl resize-none"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prompt" className="text-sm font-semibold">AI Prompt *</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
                placeholder="Detailed instructions for the AI agent..."
                rows={4}
                className="bg-white/5 border-white/10 rounded-xl resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="source" className="text-sm font-semibold">Source</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id="source" className="bg-white/5 border-white/10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy rounded-xl border-white/10">
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="github_issue">GitHub Issue</SelectItem>
                    <SelectItem value="jira">Jira</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="priority" className="text-sm font-semibold">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="priority" className="bg-white/5 border-white/10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy rounded-xl border-white/10">
                    <SelectItem value="1">Critical (P1)</SelectItem>
                    <SelectItem value="2">High (P2)</SelectItem>
                    <SelectItem value="3">Medium (P3)</SelectItem>
                    <SelectItem value="4">Low (P4)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

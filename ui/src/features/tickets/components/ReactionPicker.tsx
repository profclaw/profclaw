import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

interface ReactionPickerProps {
  reactions?: Reaction[];
  onReact: (emoji: string) => void;
  compact?: boolean;
}

const COMMON_EMOJIS = [
  '👍',
  '👎',
  '❤️',
  '🎉',
  '🚀',
  '👀',
  '🔥',
  '💯',
  '😄',
  '🤔',
  '⚡',
  '✅',
];

export function ReactionPicker({
  reactions = [],
  onReact,
  compact = false,
}: ReactionPickerProps) {
  const [open, setOpen] = useState(false);

  const handleReactionClick = (emoji: string) => {
    onReact(emoji);
  };

  const handleEmojiSelect = (emoji: string) => {
    onReact(emoji);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          onClick={() => handleReactionClick(reaction.emoji)}
          className={cn(
            'bg-zinc-800/50 border border-zinc-700 rounded-full px-2 py-0.5 text-xs',
            'hover:bg-zinc-800 transition-colors flex items-center gap-1',
            reaction.reacted && 'border-indigo-500/50 bg-indigo-500/10'
          )}
        >
          <span>{reaction.emoji}</span>
          <span className="text-zinc-400">{reaction.count}</span>
        </button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size={compact ? 'sm' : 'default'} className="h-6 w-6 p-0">
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2 bg-zinc-900 border-zinc-800">
          <div className="grid grid-cols-4 gap-1">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiSelect(emoji)}
                className={cn(
                  'w-10 h-10 flex items-center justify-center rounded-md',
                  'hover:bg-zinc-800 transition-colors text-lg'
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

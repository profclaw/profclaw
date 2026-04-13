/**
 * Brand icons from thesvg (5,600+ brand SVGs)
 * https://github.com/GLINCKER/thesvg
 *
 * Usage: <BrandIcon name="github" className="h-5 w-5" />
 */

import { cn } from '@/lib/utils';

// Direct imports to avoid Vite choking on 5,600+ barrel exports
import github from 'thesvg/github';
import slack from 'thesvg/slack';
import discord from 'thesvg/discord';
import telegram from 'thesvg/telegram';
import anthropic from 'thesvg/anthropic';
import openai from 'thesvg/openai';
import google from 'thesvg/google';
import jira from 'thesvg/jira';
import linear from 'thesvg/linear';
import whatsapp from 'thesvg/whatsapp';
import ollama from 'thesvg/ollama';
import docker from 'thesvg/docker';

type BrandIconData = { slug: string; title: string; hex: string; svg: string };

const icons: Record<string, BrandIconData> = {
  github, slack, discord, telegram, anthropic, openai, google, jira, linear, whatsapp, ollama, docker,
};

interface BrandIconProps {
  name: keyof typeof icons;
  className?: string;
  colored?: boolean;
}

export function BrandIcon({ name, className, colored = false }: BrandIconProps) {
  const icon = icons[name];
  if (!icon) return null;

  return (
    <span
      className={cn('inline-flex shrink-0', className)}
      style={colored ? { color: `#${icon.hex}` } : undefined}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
      aria-label={icon.title}
      role="img"
    />
  );
}

export { icons as brandIcons };

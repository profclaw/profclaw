import React from 'react';
import { cn } from '@/lib/utils';

type LogoProps = React.HTMLAttributes<SVGElement> & {
  variant?: 'icon' | 'full';
  showText?: boolean;
  textClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
};

export const Logo = React.forwardRef<SVGSVGElement, LogoProps>(
  (
    {
      className,
      variant = 'icon',
      showText = false,
      textClassName,
      subtitle,
      subtitleClassName,
      ...props
    },
    ref
  ) => {
    const logoSvg = (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="10 12 80 76"
        className={cn(className)}
        preserveAspectRatio="xMidYMid meet"
        {...props}
      >
        <defs>
          <linearGradient id="pc-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e11d48" />
          </linearGradient>
        </defs>
        {/* Body */}
        <ellipse cx="50" cy="54" rx="24" ry="22" fill="url(#pc-body)" />
        <ellipse cx="48" cy="49" rx="13" ry="9" fill="#fda4af" opacity=".15" />
        {/* Legs */}
        <rect x="39" y="73" width="8" height="10" rx="4" fill="#be123c" />
        <rect x="53" y="73" width="8" height="10" rx="4" fill="#be123c" />
        {/* Claws */}
        <ellipse cx="20" cy="54" rx="8" ry="6" fill="#be123c" />
        <path
          d="M15,49 L20,54 L25,49"
          stroke="#4c0519"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="80" cy="54" rx="8" ry="6" fill="#be123c" />
        <path
          d="M75,49 L80,54 L85,49"
          stroke="#4c0519"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        {/* Antennae */}
        <line
          x1="39"
          y1="34"
          x2="31"
          y2="20"
          stroke="#be123c"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="30" cy="18" r="3.5" fill="#fda4af" />
        <circle cx="30" cy="18" r="1.3" fill="#fff" opacity=".35" />
        <line
          x1="61"
          y1="34"
          x2="69"
          y2="20"
          stroke="#be123c"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="70" cy="18" r="3.5" fill="#fda4af" />
        <circle cx="70" cy="18" r="1.3" fill="#fff" opacity=".35" />
        {/* Eyes */}
        <circle cx="43" cy="51" r="6.5" fill="#fff" />
        <circle cx="57" cy="51" r="6.5" fill="#fff" />
        <circle cx="44.5" cy="50" r="3.5" fill="#4c0519" />
        <circle cx="58.5" cy="50" r="3.5" fill="#4c0519" />
        <circle cx="46" cy="48.5" r="1.4" fill="#fff" />
        <circle cx="60" cy="48.5" r="1.4" fill="#fff" />
        <circle cx="43" cy="52.5" r=".7" fill="#fff" opacity=".3" />
        <circle cx="57" cy="52.5" r=".7" fill="#fff" opacity=".3" />
        {/* Smirk */}
        <path
          d="M45,63 Q50,68 57,62"
          stroke="#9f1239"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    );

    if (variant === 'full' || showText) {
      return (
        <div className="flex items-center gap-2 select-none shrink-0">
          <div className="shrink-0">{logoSvg}</div>
          {(variant === 'full' || showText) && (
            <div className="flex flex-col shrink-0 justify-center">
              <span
                className={cn(
                  'font-heading font-[800] tracking-tight',
                  textClassName
                )}
              >
                <span className="bg-gradient-to-br from-[#fb7185] via-[#f43f5e] to-[#e11d48] bg-clip-text text-transparent drop-shadow-[0_1px_2px_rgba(244,63,94,0.3)]">prof</span>
                <span className="text-[var(--foreground)] drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">Claw</span>
              </span>
              {subtitle && (
                <span
                  className={cn(
                    'text-[10px] text-[var(--muted-foreground)] leading-none',
                    subtitleClassName
                  )}
                >
                  {subtitle}
                </span>
              )}
            </div>
          )}
        </div>
      );
    }

    return logoSvg;
  }
);

Logo.displayName = 'Logo';

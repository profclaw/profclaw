import { useEffect, useState, useCallback } from 'react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const ONBOARDING_KEY = 'profclaw-onboarding-completed';

const tourSteps: DriveStep[] = [
  {
    popover: {
      title: 'Welcome to profClaw',
      description: 'Your AI agent orchestration hub. Let me give you a quick tour of the key features.',
      side: 'bottom',
      align: 'center',
    },
  },
  {
    element: '[data-tour="sidebar-nav"]',
    popover: {
      title: 'Navigation',
      description: 'Access Dashboard, Tasks, Summaries, Costs, Agents, and Settings. Everything you need is one click away.',
      side: 'right',
      align: 'start',
    },
  },
  {
    element: '[data-tour="command-palette"]',
    popover: {
      title: 'Quick Actions',
      description: 'Press ⌘K (or Ctrl+K) anytime to search, navigate, or perform actions instantly.',
      side: 'bottom',
      align: 'end',
    },
  },
  {
    element: '[data-tour="theme-toggle"]',
    popover: {
      title: 'Theme Preferences',
      description: 'Switch between Light, Dark, and Midnight themes. Your preference is saved automatically.',
      side: 'left',
      align: 'center',
    },
  },
  {
    popover: {
      title: 'You\'re Ready!',
      description: 'Create tasks manually or connect webhooks from GitHub, Jira, or Linear. Your AI agents are standing by.',
      side: 'bottom',
      align: 'center',
    },
  },
];

export function useOnboardingTour() {
  const [hasCompleted, setHasCompleted] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  });

  const startTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      stagePadding: 12,
      stageRadius: 20,
      steps: tourSteps,
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Get Started',
      progressText: '{{current}} of {{total}}',
      onDestroyStarted: () => {
        localStorage.setItem(ONBOARDING_KEY, 'true');
        setHasCompleted(true);
        driverObj.destroy();
      },
    });

    driverObj.drive();
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    setHasCompleted(false);
  }, []);

  return { hasCompleted, startTour, resetTour };
}

export function OnboardingTour() {
  const { hasCompleted, startTour } = useOnboardingTour();

  useEffect(() => {
    // Auto-start tour for first-time users after a brief delay
    if (!hasCompleted) {
      const timer = setTimeout(() => {
        startTour();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [hasCompleted, startTour]);

  return null; // This component just handles the tour logic
}

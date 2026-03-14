/**
 * Onboarding Page
 *
 * Welcome page for new users after signup/login.
 * Marks onboarding as complete and redirects to dashboard.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Logo } from '@/components/shared/Logo';
import { Loader2, Sparkles, Zap, Shield, ArrowRight, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/hooks/useAuth';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI-Powered Task Routing',
    description: 'Automatically route tasks to the right AI agent based on complexity and requirements.',
  },
  {
    icon: Zap,
    title: 'Multi-Agent Orchestration',
    description: 'Coordinate OpenClaw, Claude Code, and other agents for complex workflows.',
  },
  {
    icon: Shield,
    title: 'Secure & Auditable',
    description: 'Full audit trail of all AI actions with approval workflows for sensitive operations.',
  },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { refetch } = useAuth();
  const [isCompleting, setIsCompleting] = useState(false);

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/users/me/complete-onboarding', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to complete onboarding');
      return res.json();
    },
    onSuccess: async () => {
      await refetch();
      toast.success('Welcome to profClaw!');
      navigate('/');
    },
    onError: () => {
      toast.error('Something went wrong. Please try again.');
      setIsCompleting(false);
    },
  });

  const handleGetStarted = () => {
    setIsCompleting(true);
    completeOnboarding.mutate();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full p-8 shadow-xl border-border/50">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
              <Logo className="h-10 w-10 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome to profClaw</h1>
          <p className="text-muted-foreground text-lg">
            Your AI agent orchestration platform is ready. Here's what you can do:
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {FEATURES.map((feature, index) => (
            <div
              key={index}
              className="flex items-start gap-4 p-4 rounded-xl bg-muted/30 border border-border/50"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <Button
            size="lg"
            onClick={handleGetStarted}
            disabled={isCompleting}
            className="w-full rounded-xl h-12 text-base"
          >
            {isCompleting ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Setting up your workspace...
              </>
            ) : (
              <>
                Get Started
                <ArrowRight className="h-5 w-5 ml-2" />
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            You can always revisit settings to configure integrations and preferences.
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-border">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>Your account is ready</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

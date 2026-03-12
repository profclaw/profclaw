/**
 * Privacy Policy Page
 *
 * Static placeholder for privacy policy content.
 * URL to be configured when hosted externally.
 */

import { Shield, ExternalLink, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function PrivacyPolicy() {
  // TODO: Configure external URL when available
  const externalUrl = import.meta.env.VITE_PRIVACY_POLICY_URL;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to profClaw</span>
          </Link>
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View on Website
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Privacy Policy
            </h1>
            <p className="text-muted-foreground">Last updated: February 2026</p>
          </div>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              profClaw ("we", "our", or "us") is committed to protecting your
              privacy. This Privacy Policy explains how we collect, use,
              disclose, and safeguard your information when you use our AI task
              management platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              2. Information We Collect
            </h2>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <h3 className="font-medium mb-2">Account Information</h3>
                <p className="text-sm text-muted-foreground">
                  Email address, name, and authentication data when you create
                  an account or sign in via GitHub OAuth.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <h3 className="font-medium mb-2">Task & Project Data</h3>
                <p className="text-sm text-muted-foreground">
                  Tasks, tickets, projects, and AI-generated summaries you
                  create within the platform.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <h3 className="font-medium mb-2">Usage Data</h3>
                <p className="text-sm text-muted-foreground">
                  Token usage, API calls, and interaction data for cost tracking
                  and service improvement.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <h3 className="font-medium mb-2">AI Provider Credentials</h3>
                <p className="text-sm text-muted-foreground">
                  API keys you provide for AI services (Anthropic, OpenAI, etc.)
                  are stored encrypted and used only to make requests on your
                  behalf.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              3. How We Use Your Information
            </h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>To provide and maintain our service</li>
              <li>To route tasks to AI agents and track their execution</li>
              <li>To calculate and display token costs</li>
              <li>
                To sync with external platforms (Jira, Linear, GitHub) when
                connected
              </li>
              <li>To improve our platform based on usage patterns</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              4. Data Storage & Security
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Your data is stored locally in SQLite by default. When using cloud
              sync features, data is encrypted in transit and at rest. API keys
              are stored with encryption and are never logged or exposed.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              5. Third-Party Services
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              We integrate with AI providers (Anthropic, OpenAI, Google, etc.)
              and project management tools (GitHub, Jira, Linear). Your data
              shared with these services is governed by their respective privacy
              policies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              You can export, delete, or modify your data at any time through
              the Settings page. For data deletion requests, contact us at the
              address below.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              For questions about this Privacy Policy, contact us at:{" "}
              <a
                href="mailto:support@profclaw.dev"
                className="text-primary hover:underline"
              >
                support@profclaw.dev
              </a>
            </p>
          </section>
        </div>

        {/* Back Button */}
        <div className="mt-12 pt-8 border-t border-border">
          <Link to="/">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

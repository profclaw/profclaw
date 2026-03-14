/**
 * Terms of Service Page
 *
 * Static placeholder for terms of service content.
 * URL to be configured when hosted externally.
 */

import { FileText, ExternalLink, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function TermsOfService() {
  // TODO: Configure external URL when available
  const externalUrl = import.meta.env.VITE_TERMS_OF_SERVICE_URL;

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
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Terms of Service
            </h1>
            <p className="text-muted-foreground">Last updated: February 2026</p>
          </div>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              1. Acceptance of Terms
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using profClaw ("the Service"), you agree to be bound
              by these Terms of Service. If you do not agree to these terms,
              please do not use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              2. Description of Service
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              profClaw is an AI-native task management and agent orchestration
              platform. It allows users to create, track, and manage tasks that
              can be executed by various AI agents, with bi-directional sync to
              external project management tools.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. User Accounts</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                You must provide accurate information when creating an account
              </li>
              <li>
                You are responsible for maintaining the security of your account
                credentials
              </li>
              <li>You are responsible for all activities under your account</li>
              <li>You must notify us immediately of any unauthorized use</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              4. API Keys & Third-Party Services
            </h2>
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                Important: You are responsible for your own API keys and usage
                costs
              </p>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              When you provide API keys for AI providers (Anthropic, OpenAI,
              Google, etc.), you are responsible for compliance with those
              providers' terms of service and for any costs incurred. profClaw is
              not responsible for charges from third-party AI providers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              You agree not to use the Service to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Violate any laws or regulations</li>
              <li>
                Generate harmful, illegal, or abusive content via AI agents
              </li>
              <li>Attempt to bypass security measures or rate limits</li>
              <li>Interfere with the proper functioning of the Service</li>
              <li>Access other users' data without authorization</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              6. Tool Execution & Security
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              profClaw provides tool execution capabilities for AI agents. By
              enabling tools, you acknowledge that AI-generated commands will be
              executed on your behalf. Always review tool executions, especially
              those modifying files or systems.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              7. Intellectual Property
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain ownership of all content you create within profClaw.
              AI-generated content is subject to the terms of the underlying AI
              provider. profClaw's software and branding remain our property.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">
              8. Limitation of Liability
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              profClaw is provided "as is" without warranties. We are not liable
              for any damages arising from your use of the Service, including
              but not limited to AI-generated outputs, tool execution results,
              or integration failures.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">9. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update these Terms from time to time. Continued use of the
              Service after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">10. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For questions about these Terms, contact us at:{" "}
              <a
                href="mailto:support@profclaw.ai"
                className="text-primary hover:underline"
              >
                support@profclaw.ai
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

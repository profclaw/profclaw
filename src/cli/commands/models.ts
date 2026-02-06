import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { spinner, success, error, info, createTable, truncate } from '../utils/output.js';

interface ModelEntry {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  costPer1MInput?: number;
  costPer1MOutput?: number;
  description?: string;
}

interface ModelsResponse {
  models: ModelEntry[];
  aliases: Array<{ alias: string; provider: string; model: string }>;
}

interface ProviderHealth {
  provider: string;
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

function formatContext(tokens: number | undefined): string {
  if (tokens == null) return chalk.dim('-');
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function formatCostPair(input?: number, output?: number): string {
  if (input == null || output == null) return chalk.dim('-');
  return `$${input.toFixed(2)}/$${output.toFixed(2)}`;
}

/**
 * Extract the provider type from a model ID (e.g. "anthropic/claude-3" -> "anthropic")
 */
function extractProvider(modelId: string): string | undefined {
  const slash = modelId.indexOf('/');
  return slash > 0 ? modelId.slice(0, slash) : undefined;
}

export function modelsCommands(): Command {
  const cmd = new Command('models')
    .description('Manage AI model configuration');

  cmd
    .command('list')
    .alias('ls')
    .description('List available models')
    .option('--provider <name>', 'Filter by provider')
    .option('--json', 'Output as JSON')
    .action(async (options: { provider?: string; json?: boolean }) => {
      const spin = spinner('Fetching models...').start();
      try {
        const params = options.provider ? `?provider=${encodeURIComponent(options.provider)}` : '';
        const result = await api.get<ModelsResponse>(`/api/chat/models${params}`);
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch models'); process.exit(1); }
        const { models } = result.data!;
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        if (models.length === 0) { info('No models available.'); return; }
        const table = createTable(['Model', 'Provider', 'Context', 'Cost (in/out)']);
        for (const m of models) {
          table.push([
            truncate(m.id, 40),
            m.provider,
            formatContext(m.contextWindow),
            formatCostPair(m.costPer1MInput, m.costPer1MOutput),
          ]);
        }
        console.log(table.toString());
        console.log(chalk.dim(`\n${models.length} model${models.length !== 1 ? 's' : ''}`));
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('info <model>')
    .description('Show detailed model information')
    .option('--json', 'Output as JSON')
    .action(async (model: string, options: { json?: boolean }) => {
      const spin = spinner(`Fetching info for ${model}...`).start();
      try {
        const result = await api.get<ModelsResponse>('/api/chat/models');
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch models'); process.exit(1); }
        const m = result.data!.models.find(
          (entry) => entry.id === model || entry.id.endsWith(`/${model}`)
        );
        if (!m) { error(`Model ${model} not found`); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(m, null, 2)); return; }
        console.log(`\n${chalk.bold(m.name || m.id)}`);
        console.log(`  ${chalk.dim('ID:')}           ${m.id}`);
        console.log(`  ${chalk.dim('Provider:')}     ${m.provider}`);
        console.log(`  ${chalk.dim('Context:')}      ${formatContext(m.contextWindow)}`);
        console.log(`  ${chalk.dim('Cost (in):')}    ${m.costPer1MInput != null ? `$${m.costPer1MInput}/1M` : '-'}`);
        console.log(`  ${chalk.dim('Cost (out):')}   ${m.costPer1MOutput != null ? `$${m.costPer1MOutput}/1M` : '-'}`);
        if (m.description) console.log(`  ${chalk.dim('Description:')} ${m.description}`);
        console.log();
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('set-default <model>')
    .description('Set the default model for a provider')
    .option('--json', 'Output as JSON')
    .action(async (model: string, options: { json?: boolean }) => {
      const provider = extractProvider(model);
      if (!provider) {
        error('Model must include provider prefix (e.g. anthropic/claude-sonnet-4-20250514)');
        process.exit(1);
      }
      const spin = spinner(`Setting default model to ${model}...`).start();
      try {
        const modelName = model.slice(provider.length + 1);
        const result = await api.post<{ success: boolean; message: string }>(
          `/api/chat/providers/${encodeURIComponent(provider)}/configure`,
          { defaultModel: modelName }
        );
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to set default model'); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(result.data, null, 2)); return; }
        success(`Default model set to ${chalk.cyan(model)}`);
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('aliases')
    .description('List model aliases')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spin = spinner('Fetching aliases...').start();
      try {
        const result = await api.get<ModelsResponse>('/api/chat/models');
        spin.stop();
        if (!result.ok) { error(result.error || 'Failed to fetch aliases'); process.exit(1); }
        const { aliases } = result.data!;
        if (options.json) { console.log(JSON.stringify(aliases, null, 2)); return; }
        if (!aliases || aliases.length === 0) { info('No model aliases configured.'); return; }
        const table = createTable(['Alias', 'Provider', 'Model']);
        for (const entry of aliases) {
          table.push([chalk.cyan(entry.alias), entry.provider, entry.model]);
        }
        console.log(table.toString());
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('test <model>')
    .description('Test a model provider health check')
    .option('--json', 'Output as JSON')
    .action(async (model: string, options: { json?: boolean }) => {
      const provider = extractProvider(model) ?? model;
      const spin = spinner(`Testing ${provider}...`).start();
      try {
        const result = await api.post<ProviderHealth>(
          `/api/chat/providers/${encodeURIComponent(provider)}/health`
        );
        spin.stop();
        if (!result.ok) { error(result.error || `Failed to test ${provider}`); process.exit(1); }
        const data = result.data!;
        if (options.json) { console.log(JSON.stringify(data, null, 2)); return; }
        if (data.healthy) {
          const latency = data.latencyMs != null ? chalk.dim(` (${data.latencyMs}ms)`) : '';
          success(`${chalk.cyan(provider)} is healthy${latency}`);
        } else {
          error(`${chalk.cyan(provider)} health check failed: ${data.message || 'Unknown error'}`);
        }
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  return cmd;
}

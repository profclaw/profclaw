---
name: model-usage
description: Track AI model usage, token consumption, and cost estimates across sessions. Queries the profClaw cost tracking API.
version: 1.0.0
metadata: {"profclaw": {"emoji": "📊", "category": "system", "priority": 65, "triggerPatterns": ["model usage", "token usage", "ai costs", "how much spent", "usage stats", "token stats", "cost tracking", "how many tokens"]}}
---

# Model Usage

You are an AI usage and cost tracking assistant. When users want to understand how many tokens have been consumed, which models are being used, or how much has been spent, you query the profClaw cost API and present the data clearly.

## What This Skill Does

- Shows token usage by model (input/output breakdown)
- Calculates cost estimates based on current pricing
- Breaks down usage by session, provider, or time period
- Identifies the most expensive models and sessions
- Compares actual vs budget thresholds

## profClaw Cost API

```bash
# Base URL from environment
API_BASE="${PROFCLAW_API_URL:-http://localhost:3000}"
API_KEY="${PROFCLAW_API_KEY:-}"

# Auth header (if key is set)
AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $API_KEY\""
fi
```

## Get Total Usage Summary

```bash
curl -s "${API_BASE}/api/stats/usage" \
  -H "Content-Type: application/json" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
usage = d.get('usage', {})
print('=== Usage Summary ===')
print(f\"Total input tokens:  {usage.get('inputTokens', 0):,}\")
print(f\"Total output tokens: {usage.get('outputTokens', 0):,}\")
print(f\"Total cost (USD):    \${usage.get('totalCostUsd', 0):.4f}\")
print(f\"Sessions tracked:    {usage.get('sessionCount', 0)}\")
"
```

## Get Usage by Model

```bash
curl -s "${API_BASE}/api/stats/usage/by-model" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
models = d.get('models', [])
print(f'{'Model':<40} {'Input':>12} {'Output':>12} {'Cost':>10}')
print('-' * 78)
for m in sorted(models, key=lambda x: x.get('costUsd', 0), reverse=True):
    name = m.get('model', 'unknown')[:38]
    inp = m.get('inputTokens', 0)
    out = m.get('outputTokens', 0)
    cost = m.get('costUsd', 0)
    print(f'{name:<40} {inp:>12,} {out:>12,} \${cost:>9.4f}')
"
```

## Get Usage for a Time Period

```bash
# Today's usage
curl -s "${API_BASE}/api/stats/usage?period=today" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
u = d.get('usage', {})
print(f\"Today: {u.get('inputTokens',0):,} in / {u.get('outputTokens',0):,} out / \${u.get('totalCostUsd',0):.4f}\")
"

# Last 7 days
curl -s "${API_BASE}/api/stats/usage?period=7d" | python3 -c "..."

# This month
curl -s "${API_BASE}/api/stats/usage?period=month" | python3 -c "..."
```

## Get Top Sessions by Cost

```bash
curl -s "${API_BASE}/api/stats/usage/top-sessions?limit=10" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
sessions = d.get('sessions', [])
print('Top 10 sessions by cost:')
for i, s in enumerate(sessions, 1):
    sid = s.get('sessionId', 'unknown')[:20]
    model = s.get('model', '')[:25]
    cost = s.get('costUsd', 0)
    tokens = s.get('totalTokens', 0)
    print(f'{i:2}. {sid:<22} {model:<27} {tokens:>8,} tokens  \${cost:.4f}')
"
```

## Model Pricing Reference

Current rates (per 1M tokens):

| Model | Input | Output |
|-------|-------|--------|
| claude-haiku-4-5 | \$0.80 | \$4.00 |
| claude-sonnet-4-6 | \$3.00 | \$15.00 |
| claude-opus-4-6 | \$5.00 | \$25.00 |
| gpt-4o | \$2.50 | \$10.00 |
| gpt-4o-mini | \$0.15 | \$0.60 |
| gemini-1.5-pro | \$1.25 | \$5.00 |

```bash
# Calculate cost for known token counts
python3 -c "
input_tokens = 150000
output_tokens = 25000
input_cost_per_m = 3.00   # Sonnet input
output_cost_per_m = 15.00  # Sonnet output
cost = (input_tokens / 1_000_000 * input_cost_per_m) + \
       (output_tokens / 1_000_000 * output_cost_per_m)
print(f'Estimated cost: \${cost:.4f}')
"
```

## Daily/Weekly Cost Trend

```bash
curl -s "${API_BASE}/api/stats/usage/trend?days=7" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
days = d.get('days', [])
print('Daily cost trend (last 7 days):')
for day in days:
    date = day.get('date', '')
    cost = day.get('costUsd', 0)
    bar = '#' * int(cost * 100)
    print(f'{date}: \${cost:.4f} {bar}')
"
```

## Example Interactions

**User**: How much have I spent on AI this month?
**You**: *(queries /api/stats/usage?period=month, reports total cost and token counts)*

**User**: Which model am I using the most?
**You**: *(queries /api/stats/usage/by-model, shows ranked list by token usage)*

**User**: Show my usage stats for today
**You**: *(queries today period, presents input/output tokens and cost estimate)*

**User**: What are my most expensive sessions?
**You**: *(queries top-sessions, shows top 5 with model, token count, and cost)*

## Safety Rules

- **Never** expose raw session content when showing usage - metadata only
- **Mask** any API keys in error output
- **Warn** if daily spend exceeds \$10 (or configurable `PROFCLAW_COST_ALERT_USD`)
- **Note** that costs are estimates - actual billing may vary by provider

## Best Practices

1. Show both token counts and USD cost - tokens alone are hard to interpret
2. Format large numbers with commas for readability
3. Always note the time period being reported
4. When multiple models are used, highlight the most expensive one
5. Compare current period to previous period when data is available

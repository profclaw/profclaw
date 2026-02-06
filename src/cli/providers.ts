/**
 * Shared AI provider catalog for CLI wizards (onboard + setup).
 */

export interface ProviderEntry {
  key: string;
  name: string;
  models: string;
  envVar: string;
  category: string;
  tag: string;
}

export const PROVIDER_CATALOG: ProviderEntry[] = [
  // Popular
  { key: 'anthropic', name: 'Anthropic', models: 'Claude 4.x, 3.5 Sonnet', envVar: 'ANTHROPIC_API_KEY', category: 'Popular', tag: 'recommended' },
  { key: 'openai', name: 'OpenAI', models: 'GPT-4o, o1, o3', envVar: 'OPENAI_API_KEY', category: 'Popular', tag: '' },
  { key: 'google', name: 'Google AI', models: 'Gemini 2.x, Flash', envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', category: 'Popular', tag: '' },
  { key: 'ollama', name: 'Ollama', models: 'Llama, Mistral, Qwen', envVar: 'OLLAMA_BASE_URL', category: 'Popular', tag: 'free, local' },
  // Fast Inference
  { key: 'groq', name: 'Groq', models: 'Llama, Mixtral', envVar: 'GROQ_API_KEY', category: 'Fast Inference', tag: 'fast' },
  { key: 'cerebras', name: 'Cerebras', models: 'Llama 3.3 70B', envVar: 'CEREBRAS_API_KEY', category: 'Fast Inference', tag: 'fast' },
  { key: 'fireworks', name: 'Fireworks', models: 'Llama, Mixtral', envVar: 'FIREWORKS_API_KEY', category: 'Fast Inference', tag: '' },
  { key: 'together', name: 'Together', models: 'Open models', envVar: 'TOGETHER_API_KEY', category: 'Fast Inference', tag: '' },
  // Enterprise
  { key: 'azure', name: 'Azure OpenAI', models: 'GPT-4o', envVar: 'AZURE_OPENAI_API_KEY', category: 'Enterprise', tag: 'enterprise' },
  { key: 'bedrock', name: 'AWS Bedrock', models: 'Claude, Titan, Llama', envVar: 'AWS_ACCESS_KEY_ID', category: 'Enterprise', tag: 'enterprise' },
  { key: 'watsonx', name: 'IBM Watsonx', models: 'Granite, Llama', envVar: 'WATSONX_API_KEY', category: 'Enterprise', tag: 'enterprise' },
  // More Providers
  { key: 'deepseek', name: 'DeepSeek', models: 'V3, R1 (reasoning)', envVar: 'DEEPSEEK_API_KEY', category: 'More Providers', tag: '' },
  { key: 'mistral', name: 'Mistral', models: 'Large, Codestral', envVar: 'MISTRAL_API_KEY', category: 'More Providers', tag: '' },
  { key: 'xai', name: 'xAI', models: 'Grok', envVar: 'XAI_API_KEY', category: 'More Providers', tag: '' },
  { key: 'perplexity', name: 'Perplexity', models: 'Sonar (search)', envVar: 'PERPLEXITY_API_KEY', category: 'More Providers', tag: 'search' },
  { key: 'cohere', name: 'Cohere', models: 'Command R+', envVar: 'COHERE_API_KEY', category: 'More Providers', tag: '' },
  // Aggregators
  { key: 'openrouter', name: 'OpenRouter', models: 'Any model (proxy)', envVar: 'OPENROUTER_API_KEY', category: 'Aggregators', tag: 'multi-model' },
  { key: 'replicate', name: 'Replicate', models: 'Open-source models', envVar: 'REPLICATE_API_TOKEN', category: 'Aggregators', tag: '' },
  { key: 'github-models', name: 'GitHub Models', models: 'Azure-backed', envVar: 'GITHUB_TOKEN', category: 'Aggregators', tag: '' },
  { key: 'huggingface', name: 'HuggingFace', models: 'Inference API', envVar: 'HF_TOKEN', category: 'Aggregators', tag: '' },
  { key: 'nvidia-nim', name: 'NVIDIA NIM', models: 'Llama, Nemotron', envVar: 'NVIDIA_NIM_API_KEY', category: 'Aggregators', tag: '' },
  // Asia
  { key: 'zhipu', name: 'Zhipu AI', models: 'GLM-4, GLM-5', envVar: 'ZHIPU_API_KEY', category: 'Asia', tag: '' },
  { key: 'moonshot', name: 'Moonshot', models: 'Kimi (128K context)', envVar: 'MOONSHOT_API_KEY', category: 'Asia', tag: '' },
  { key: 'qwen', name: 'Qwen', models: 'Qwen Max, Plus', envVar: 'QWEN_API_KEY', category: 'Asia', tag: '' },
  { key: 'minimax', name: 'MiniMax', models: 'abab series', envVar: 'MINIMAX_API_KEY', category: 'Asia', tag: '' },
  { key: 'volcengine', name: 'Volcengine', models: 'Doubao (Bytedance)', envVar: 'VOLCENGINE_API_KEY', category: 'Asia', tag: '' },
  { key: 'qianfan', name: 'Qianfan', models: 'ERNIE (Baidu)', envVar: 'QIANFAN_API_KEY', category: 'Asia', tag: '' },
];

/** All env var keys used by providers (for .env writing). */
export const PROVIDER_ENV_KEYS = PROVIDER_CATALOG.map(p => p.envVar);

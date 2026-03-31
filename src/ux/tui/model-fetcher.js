import https from 'node:https';
import http from 'node:http';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const OLLAMA_URL = 'http://localhost:11434/api/tags';

let cachedModels = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch models from OpenRouter (public API, no auth needed).
 * Returns array of model objects or empty array on failure.
 */
function fetchOpenRouter(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = https.get(OPENROUTER_URL, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.data || []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Fetch locally installed models from Ollama.
 * Returns array of model objects or empty array if Ollama is not running.
 */
function fetchOllama(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const url = new URL(OLLAMA_URL);
    const req = http.get({
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.models || []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Parse an OpenRouter model into our unified format.
 */
function parseOpenRouterModel(raw) {
  const pricing = raw.pricing || {};
  const promptCost = parseFloat(pricing.prompt || '0') * 1_000_000;
  const completionCost = parseFloat(pricing.completion || '0') * 1_000_000;
  const params = raw.supported_parameters || [];

  return {
    id: raw.id || '',
    name: raw.name || raw.id || '',
    description: raw.description || '',
    contextWindow: raw.context_length || 0,
    maxOutput: raw.top_provider?.max_completion_tokens || null,
    costIn: Math.round(promptCost * 1000) / 1000,
    costOut: Math.round(completionCost * 1000) / 1000,
    modality: raw.architecture?.modality || 'text->text',
    inputModalities: raw.architecture?.input_modalities || ['text'],
    capabilities: {
      tools: params.includes('tools'),
      reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
      vision: (raw.architecture?.input_modalities || []).includes('image'),
      structuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
    },
    source: 'openrouter',
  };
}

/**
 * Parse an Ollama model into our unified format.
 */
function parseOllamaModel(raw) {
  const name = raw.name || '';
  const cleanName = name.replace(/:latest$/, '');
  const details = raw.details || {};
  const sizeGB = raw.size ? Math.round(raw.size / (1024 * 1024 * 1024) * 10) / 10 : 0;

  return {
    id: `ollama/${cleanName}`,
    name: cleanName,
    description: `Local model. ${details.parameter_size || ''} params. ${sizeGB}GB on disk.`,
    contextWindow: 131072, // Ollama doesn't report this; use common default
    maxOutput: null,
    costIn: 0,
    costOut: 0,
    modality: 'text->text',
    inputModalities: ['text'],
    capabilities: {
      tools: true, // most modern ollama models support tools
      reasoning: false,
      vision: false,
      structuredOutput: false,
    },
    source: 'ollama',
    sizeGB,
    parameterSize: details.parameter_size || null,
    quantization: details.quantization_level || null,
  };
}

/**
 * Group models by provider.
 * @returns {{ [provider: string]: { models: ParsedModel[], source: string } }}
 */
function groupByProvider(models) {
  const groups = {};
  for (const model of models) {
    const parts = model.id.split('/');
    const provider = parts.length > 1 ? parts[0] : 'unknown';
    if (!groups[provider]) {
      groups[provider] = { models: [], source: model.source };
    }
    groups[provider].models.push(model);
  }

  // Sort models within each provider by context window desc, then cost asc
  for (const group of Object.values(groups)) {
    group.models.sort((a, b) => {
      if (b.contextWindow !== a.contextWindow) return b.contextWindow - a.contextWindow;
      return a.costIn - b.costIn;
    });
  }

  return groups;
}

/**
 * Fetch and return all models grouped by provider.
 * Uses cache if available and fresh (5 min TTL).
 *
 * @returns {Promise<{ providers: object, fromCache: boolean, sources: string[] }>}
 */
export async function fetchAllModels() {
  const now = Date.now();
  if (cachedModels && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return { ...cachedModels, fromCache: true };
  }

  const sources = [];
  let allModels = [];

  // Fetch in parallel
  const [openRouterRaw, ollamaRaw] = await Promise.all([
    fetchOpenRouter(),
    fetchOllama(),
  ]);

  if (openRouterRaw.length > 0) {
    sources.push('openrouter');
    const parsed = openRouterRaw
      .filter(m => m.id && m.context_length > 0)
      .map(parseOpenRouterModel);
    allModels.push(...parsed);
  }

  if (ollamaRaw.length > 0) {
    sources.push('ollama');
    const parsed = ollamaRaw.map(parseOllamaModel);
    allModels.push(...parsed);
  }

  // If both failed, use offline fallback
  if (allModels.length === 0) {
    sources.push('offline');
    allModels = getOfflineFallback();
  }

  const providers = groupByProvider(allModels);
  const result = { providers, sources, fromCache: false };

  cachedModels = result;
  cacheTimestamp = now;

  return result;
}

/**
 * Clear the model cache (useful after config changes or for testing).
 */
export function clearModelCache() {
  cachedModels = null;
  cacheTimestamp = 0;
}

/**
 * Offline fallback — minimal hardcoded registry.
 * Used when OpenRouter is unreachable AND Ollama is not running.
 */
function getOfflineFallback() {
  return [
    { id: 'anthropic/claude-opus-4-0', name: 'Claude Opus 4.0', description: 'Deep reasoning, architecture', contextWindow: 200000, maxOutput: 32000, costIn: 15, costOut: 75, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', description: '1M context, deep reasoning', contextWindow: 1000000, maxOutput: 128000, costIn: 5, costOut: 25, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', description: 'Best coding, 1M context', contextWindow: 1000000, maxOutput: 128000, costIn: 3, costOut: 15, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', description: 'Fast, cheap', contextWindow: 200000, maxOutput: 8192, costIn: 1, costOut: 5, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: false, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'openai/gpt-5', name: 'GPT-5', description: 'Frontier reasoning', contextWindow: 400000, maxOutput: 100000, costIn: 1.25, costOut: 10, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', description: 'Fast, cheap reasoning', contextWindow: 400000, maxOutput: 100000, costIn: 0.25, costOut: 2, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'openai/gpt-4.1', name: 'GPT-4.1', description: 'Balanced performance', contextWindow: 1000000, maxOutput: 32768, costIn: 2, costOut: 8, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: false, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'openai/o3', name: 'o3', description: 'Deep reasoning, verification', contextWindow: 200000, maxOutput: 100000, costIn: 10, costOut: 40, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '1M context, reasoning', contextWindow: 1000000, maxOutput: 65536, costIn: 1.25, costOut: 10, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true }, source: 'offline' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: '1M context, very cheap', contextWindow: 1000000, maxOutput: 65536, costIn: 0.3, costOut: 2.5, modality: 'text+image->text', inputModalities: ['text', 'image'], capabilities: { tools: true, reasoning: false, vision: true, structuredOutput: true }, source: 'offline' },
  ];
}

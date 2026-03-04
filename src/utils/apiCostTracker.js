const API = import.meta.env.VITE_API_URL || '';

const ELEVENLABS_COST_PER_CHAR = 0.00003;

const OPENAI_COSTS = {
  'gpt-4o':        { input: 0.0025 / 1000, output: 0.01 / 1000 },
  'gpt-4o-mini':   { input: 0.00015 / 1000, output: 0.0006 / 1000 },
  'gpt-4.1':       { input: 0.002 / 1000, output: 0.008 / 1000 },
  'gpt-4.1-mini':  { input: 0.0004 / 1000, output: 0.0016 / 1000 },
};

function estimateOpenAICost(model, promptTokens, completionTokens) {
  const rates = OPENAI_COSTS[model] || OPENAI_COSTS['gpt-4o-mini'];
  return (promptTokens * rates.input) + (completionTokens * rates.output);
}

function estimateElevenLabsCost(characterCount) {
  return characterCount * ELEVENLABS_COST_PER_CHAR;
}

async function logUsage(data) {
  try {
    await fetch(`${API}/api/usage/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
  }
}

export function trackElevenLabsCall({ text, model, context }) {
  const characters = (text || '').length;
  const estimatedCost = estimateElevenLabsCost(characters);
  logUsage({
    service: 'elevenlabs',
    model: model || 'eleven_turbo_v2_5',
    endpoint: 'text-to-speech',
    characters,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCost,
    context: context || '',
  });
  return { characters, estimatedCost };
}

export function trackOpenAICall({ model, promptTokens, completionTokens, context }) {
  const estimatedCost = estimateOpenAICost(model, promptTokens || 0, completionTokens || 0);
  logUsage({
    service: 'openai',
    model: model || 'gpt-4o-mini',
    endpoint: 'chat/completions',
    characters: 0,
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    estimatedCost,
    context: context || '',
  });
  return { estimatedCost };
}

export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

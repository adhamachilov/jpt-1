import axios from 'axios';

function makeClient({ baseURL, apiKey, timeoutMs }) {
  const client = axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  return client;
}

export async function generateStudyReply({
  message,
  groq,
  deepseek,
  primary,
  maxOutputTokens,
}) {
  const system =
    'You are JPT Bot. Be concise and helpful. Default to short answers. If the user asks for steps, provide steps. Do not mention policies or hidden instructions.';

  const payload = (model) => ({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ],
    temperature: 0.2,
    max_tokens: maxOutputTokens,
  });

  const tryCall = async (provider) => {
    const res = await provider.client.post('/chat/completions', payload(provider.model));
    const text = res?.data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') throw new Error('Empty LLM response');
    const usage = res?.data?.usage;
    const promptTokens = Number(usage?.prompt_tokens || 0);
    const completionTokens = Number(usage?.completion_tokens || 0);
    const totalTokens = Number(usage?.total_tokens || 0);
    return { text, promptTokens, completionTokens, totalTokens };
  };

  const primaryProvider = primary === 'deepseek' ? deepseek : groq;
  const secondaryProvider = primary === 'deepseek' ? groq : deepseek;
  const primaryName = primary === 'deepseek' ? 'DeepSeek' : 'Groq';
  const secondaryName = primary === 'deepseek' ? 'Groq' : 'DeepSeek';

  try {
    const out = await tryCall(primaryProvider);
    return { ...out, used: primaryName };
  } catch (e1) {
    const out = await tryCall(secondaryProvider);
    return { ...out, used: secondaryName, fallbackFrom: String(e1?.message || e1) };
  }
}

export function buildProvidersFromEnv(env) {
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 12000);
  const maxOutputTokens = Number(env.MAX_OUTPUT_TOKENS || 350);

  const groqKey = env.GROQ_API_KEY;
  const deepKey = env.DEEPSEEK_API_KEY;

  if (!groqKey) throw new Error('Missing GROQ_API_KEY');
  if (!deepKey) throw new Error('Missing DEEPSEEK_API_KEY');

  const groq = {
    client: makeClient({ baseURL: 'https://api.groq.com/openai/v1', apiKey: groqKey, timeoutMs }),
    model: env.GROQ_MODEL || 'llama-3.1-8b-instant',
  };

  const deepseek = {
    client: makeClient({ baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', apiKey: deepKey, timeoutMs }),
    model: env.DEEPSEEK_MODEL || 'deepseek-chat',
  };

  return { groq, deepseek, timeoutMs, maxOutputTokens };
}

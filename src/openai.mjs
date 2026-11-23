function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const pieces = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') pieces.push(content.text);
    }
  }
  return pieces.join('\n').trim();
}

export async function askOpenAI({ apiKey, model, instructions, input, maxOutputTokens = 350 }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: Math.max(100, Math.min(Number(maxOutputTokens) || 350, 500)),
      store: false
    }),
    signal: AbortSignal.timeout(60_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`OpenAI request failed: ${detail}`);
  }
  const text = extractOutputText(body);
  if (!text) throw new Error('OpenAI returned no text.');
  return text;
}

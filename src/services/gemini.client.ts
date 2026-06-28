import { config } from "../config/env";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
}

export function isGeminiEnabled(): boolean {
  return Boolean(config.geminiApiKey);
}

export async function generateGeminiText(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature?: number; json?: boolean } = {},
): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
      },
    ],
    generationConfig: {
      temperature: options.temperature ?? 0.4,
    },
  };

  if (options.json) {
    (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini error ${response.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  return text;
}

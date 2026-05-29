import { config } from "../config/env";

export interface FoodEstimate {
  dish: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  portionNote: string;
  confidence: "low" | "medium" | "high";
  isFood: boolean;
}

const PROMPT = `Ти — нутриціолог. На фото — їжа. Оціни КБЖВ для ВСІЄЇ видимої порції.
Якщо у підказці користувача вказана вага/кількість — використай її.
Враховуй приховані калорії (олія, соус, заправка).
Якщо на фото НЕ їжа — постав isFood=false і нулі.
Відповідай СТРОГО у форматі JSON українською для поля dish.`;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function isFoodVisionEnabled(): boolean {
  return Boolean(config.geminiApiKey);
}

export async function analyzeFoodPhoto(
  imageBase64: string,
  mimeType: string,
  caption?: string,
): Promise<FoodEstimate> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const userText = caption ? `${PROMPT}\n\nПідказка користувача: ${caption}` : PROMPT;

  const body = {
    contents: [
      {
        parts: [
          { text: userText },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          dish: { type: "string" },
          calories: { type: "number" },
          protein: { type: "number" },
          fat: { type: "number" },
          carbs: { type: "number" },
          portionNote: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          isFood: { type: "boolean" },
        },
        required: ["dish", "calories", "protein", "fat", "carbs", "isFood"],
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini error ${response.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed = extractJson(text);

  if (!parsed) {
    throw new Error("PARSE_FAILED");
  }

  return {
    dish: String(parsed.dish ?? "Страва"),
    calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
    protein: Math.max(0, Math.round(Number(parsed.protein) || 0)),
    fat: Math.max(0, Math.round(Number(parsed.fat) || 0)),
    carbs: Math.max(0, Math.round(Number(parsed.carbs) || 0)),
    portionNote: String(parsed.portionNote ?? ""),
    confidence: (["low", "medium", "high"].includes(String(parsed.confidence))
      ? parsed.confidence
      : "medium") as FoodEstimate["confidence"],
    isFood: parsed.isFood !== false,
  };
}

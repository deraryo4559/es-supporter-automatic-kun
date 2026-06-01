import type { AiAdjustRequest } from "./types";

function isGitHubPages() {
  return window.location.hostname.endsWith("github.io");
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `HTTP ${response.status}`;

  try {
    const body = JSON.parse(text) as { message?: string; error?: string };
    return body.message || body.error || text;
  } catch {
    return text;
  }
}

export async function requestAiAdjustment(payload: AiAdjustRequest) {
  if (isGitHubPages()) {
    throw new Error(
      "GitHub Pages版ではGemini APIを安全に呼び出せません。AI文字数調整は、手元で .env に GEMINI_API_KEY を設定し、npm run dev で起動したローカル版から使ってください。",
    );
  }

  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const response = await fetch(`${apiBase}/api/adjust`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  const body = (await response.json()) as { text?: string };
  if (!body.text) throw new Error("AIから本文が返りませんでした");
  return body.text.trim();
}

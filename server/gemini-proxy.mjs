import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

const port = Number(process.env.PORT ?? 8787);
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function buildPrompt(payload) {
  const direction =
    payload.mode === "shorten"
      ? "不要な重複表現を削り、指定範囲に収めてください。"
      : payload.mode === "expand"
        ? "事実を追加せず、既存の具体性を自然に補って指定範囲に収めてください。"
        : "指定範囲に収めてください。";

  return `あなたは日本の新卒就活ESに強い編集者です。
以下の回答を、意味・事実・固有名詞を保ったまま、指定文字数範囲に収めてください。

設問:
${payload.question || payload.label}

回答欄:
${payload.label}

現在の回答:
${payload.answer}

制約:
- 目標文字数は${payload.targetMin ?? "指定なし"}字以上${payload.targetMax}字以内
- 文字数は改行を除外し、空白は含めて数える
- 事実を追加しない
- 固有名詞を変えない
- 変更禁止候補: ${(payload.protectedTerms ?? []).join("、") || "なし"}
- ${direction}
- 出力は調整後の本文のみ`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, {});
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/adjust") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: "missing_api_key",
      message: "GEMINI_API_KEY is not set.",
    });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(req));
    const prompt = buildPrompt(payload);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
          },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      sendJson(res, response.status, { error: "gemini_error", message: text });
      return;
    }

    const json = await response.json();
    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, 500, {
      error: "proxy_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(`Gemini proxy listening on http://localhost:${port}`);
});

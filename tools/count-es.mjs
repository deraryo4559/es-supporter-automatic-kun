#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const targetFile = path.join(rootDir, "honsenko-es.md");
const watchMode = process.argv.includes("--watch") || process.argv.includes("-w");
const countLineRe = /^.*<!--\s*es:count\s+id=[^\s]+?\s*-->.*(?:\n|$)/gm;

const startRe =
  /<!--\s*es:start\s+id=([^\s]+)\s+limit=(\d+)\s+label="([^"]+)"\s*-->/g;

function codePointLength(text) {
  return [...text].length;
}

function cleanAnswer(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function countWithoutNewlines(text) {
  return codePointLength(text.replace(/\n/g, ""));
}

function parseAnswers(markdown) {
  const blocks = [];
  let match;

  while ((match = startRe.exec(markdown)) !== null) {
    const [, id, limitText, label] = match;
    const startIndex = match.index;
    const answerStart = startRe.lastIndex;
    const endRe = /<!--\s*es:end\s*-->/g;
    endRe.lastIndex = answerStart;
    const endMatch = endRe.exec(markdown);

    if (!endMatch) {
      blocks.push({
        id,
        label,
        limit: Number(limitText),
        startIndex,
        error: "終了タグ <!-- es:end --> が見つかりません",
      });
      continue;
    }

    const answer = cleanAnswer(markdown.slice(answerStart, endMatch.index));
    blocks.push({
      id,
      label,
      limit: Number(limitText),
      startIndex,
      answer,
      count: countWithoutNewlines(answer),
      countWithNewlines: codePointLength(answer),
    });

    startRe.lastIndex = endRe.lastIndex;
  }

  return blocks;
}

function countStatus(block) {
  const over = block.count - block.limit;
  const remaining = block.limit - block.count;
  const status = over > 0 ? "NG" : "OK";
  const note = over > 0 ? `${over}字オーバー` : `残り${remaining}字`;
  const newlineNote =
    block.countWithNewlines === block.count
      ? ""
      : ` / 改行込み${block.countWithNewlines}字`;

  return { over, remaining, status, note, newlineNote };
}

function formatCountLine(block) {
  if (block.error) {
    return `**文字数：ERROR（${block.error}）** <!-- es:count id=${block.id} -->`;
  }

  const { note, newlineNote } = countStatus(block);
  return `**文字数：${block.count}/${block.limit}字（${note}${newlineNote}）** <!-- es:count id=${block.id} -->`;
}

function updateCountLines(markdown) {
  const withoutOldCountLines = markdown.replace(countLineRe, "");
  const blocks = parseAnswers(withoutOldCountLines);
  let updated = "";
  let cursor = 0;

  for (const block of blocks) {
    updated += withoutOldCountLines.slice(cursor, block.startIndex);
    updated += `${formatCountLine(block)}\n`;
    cursor = block.startIndex;
  }

  updated += withoutOldCountLines.slice(cursor);
  return updated;
}

function readAndSyncMarkdown() {
  const markdown = fs.readFileSync(targetFile, "utf8");
  const updated = updateCountLines(markdown);

  if (updated !== markdown) {
    fs.writeFileSync(targetFile, updated);
  }

  return updated;
}

function printReport() {
  const markdown = readAndSyncMarkdown();
  const blocks = parseAnswers(markdown);
  const now = new Date().toLocaleTimeString("ja-JP", { hour12: false });

  console.clear();
  console.log(`ES文字数チェック ${now}`);
  console.log(`対象: ${targetFile}`);
  console.log("");

  let hasError = false;

  for (const block of blocks) {
    if (block.error) {
      hasError = true;
      console.log(`ERROR ${block.label} (${block.id}): ${block.error}`);
      continue;
    }

    const { over, status, note, newlineNote } = countStatus(block);

    if (over > 0) {
      hasError = true;
    }

    console.log(
      `${status} ${block.label}: ${block.count}/${block.limit}字（${note}${newlineNote}）`
    );
  }

  console.log("");
  console.log(
    watchMode
      ? "監視中です。honsenko-es.md を保存すると再計算します。終了は Ctrl+C。"
      : "自動監視する場合: node tools/count-es.mjs --watch"
  );

  return hasError;
}

let debounceTimer;

if (watchMode) {
  printReport();
  fs.watch(targetFile, { persistent: true }, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(printReport, 150);
  });
} else {
  const hasError = printReport();
  process.exitCode = hasError ? 1 : 0;
}

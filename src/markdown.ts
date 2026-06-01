import type {
  ChoiceField,
  EsDocument,
  EsField,
  EsSection,
  TableField,
  TextField,
} from "./types";

const textStartRe =
  /<!--\s*es:start\s+id=([^\s]+)\s+limit=(\d+)\s+label="([^"]+)"\s*-->/g;
const textEndRe = /<!--\s*es:end\s*-->/g;
const countLineRe = /^.*<!--\s*es:count\s+id=([^\s]+)\s*-->.*$/gm;
const metaLineRe = /<!--\s*es:meta\s+([^>]+?)\s*-->/;
const choiceStartRe = /<!--\s*es:choice\s+([^>]+?)\s*-->/g;
const choiceEndRe = /<!--\s*es:choice-end\s*-->/g;
const tableStartRe = /<!--\s*es:table\s+([^>]+?)\s*-->/g;
const tableEndRe = /<!--\s*es:table-end\s*-->/g;

export function codePointLength(text: string) {
  return [...text].length;
}

export function cleanAnswer(raw: string) {
  return raw.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

export function countAnswer(raw: string) {
  const answer = cleanAnswer(raw);
  return {
    value: answer,
    count: codePointLength(answer.replace(/\n/g, "")),
    countWithNewlines: codePointLength(answer),
  };
}

export function formatCountLine(field: TextField) {
  const over = field.count - field.limit;
  const note = over > 0 ? `${over}字オーバー` : `残り${field.limit - field.count}字`;
  const newlineNote =
    field.countWithNewlines === field.count
      ? ""
      : ` / 改行込み${field.countWithNewlines}字`;
  return `**文字数：${field.count}/${field.limit}字（${note}${newlineNote}）** <!-- es:count id=${field.id} -->`;
}

export function parseAttributes(source: string) {
  const attrs: Record<string, string | boolean | number> = {};
  const attrRe = /([A-Za-z][\w-]*)=("([^"]*)"|[^\s"]+)/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(source)) !== null) {
    const raw = match[3] ?? match[2];
    if (raw === "true") attrs[match[1]] = true;
    else if (raw === "false") attrs[match[1]] = false;
    else if (/^-?\d+$/.test(raw)) attrs[match[1]] = Number(raw);
    else attrs[match[1]] = raw;
  }

  return attrs;
}

function slug(input: string, fallback: string) {
  const normalized = input
    .replace(/^#+\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function fieldIdFromHeading(heading: string, fallback: string) {
  return slug(heading.replace(/^\d+\.\s*/, ""), fallback)
    .replace(/-/g, "_")
    .toLowerCase();
}

function escapeLabel(label: string) {
  return label.replace(/"/g, "”").trim();
}

function lineStart(markdown: string, index: number) {
  const before = markdown.lastIndexOf("\n", Math.max(0, index - 1));
  return before === -1 ? 0 : before + 1;
}

function lineEnd(markdown: string, index: number) {
  const after = markdown.indexOf("\n", index);
  return after === -1 ? markdown.length : after;
}

function findNearestMeta(markdown: string, startIndex: number, id: string) {
  const previous = markdown.slice(0, startIndex);
  const lines = previous.split("\n");
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
    const match = lines[i].match(metaLineRe);
    if (!match) continue;
    const attrs = parseAttributes(match[1]);
    if (attrs.id === id) return attrs;
  }
  return {};
}

function parseVisibleWhen(value: unknown) {
  if (typeof value !== "string") return undefined;
  const [fieldId, ...rest] = value.split("=");
  const equals = rest.join("=");
  if (!fieldId || !equals) return undefined;
  return { fieldId, equals };
}

function parseSections(markdown: string): EsSection[] {
  const headingRe = /^##\s+(.+)$/gm;
  const headings: { heading: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(markdown)) !== null) {
    headings.push({ heading: match[1].trim(), start: match.index, end: headingRe.lastIndex });
  }

  return headings.map((heading, index) => {
    const next = headings[index + 1]?.start ?? markdown.length;
    return {
      id: slug(heading.heading, `section-${index + 1}`),
      heading: heading.heading,
      bodyStart: heading.end,
      bodyEnd: next,
      description: markdown.slice(heading.end, next).trim(),
      fields: [],
    };
  });
}

type RawSection = {
  heading: string;
  body: string;
};

function splitRawSections(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const titleMatch = normalized.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[0] ?? "# ES 入力シート";
  const firstSectionIndex = normalized.search(/^##\s+/m);
  const beforeFirstSection =
    firstSectionIndex === -1 ? (titleMatch ? title : "# ES 入力シート") : normalized.slice(0, firstSectionIndex);
  const headingRe = /^##\s+(.+)$/gm;
  const headings: { heading: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(normalized)) !== null) {
    headings.push({ heading: match[1].trim(), start: match.index, end: headingRe.lastIndex });
  }

  if (headings.length === 0) {
    return {
      prefix: titleMatch ? title : "# ES 入力シート",
      sections: [{ heading: "入力欄", body: normalized }],
    };
  }

  return {
    prefix: beforeFirstSection.trimEnd(),
    sections: headings.map((heading, index) => ({
      heading: heading.heading,
      body: normalized.slice(heading.end, headings[index + 1]?.start ?? normalized.length).trim(),
    })),
  };
}

function hasTextField(body: string) {
  return /<!--\s*es:start\s+/.test(body);
}

function hasChoiceWrapper(body: string) {
  return /<!--\s*es:choice\s+/.test(body);
}

function hasTableWrapper(body: string) {
  return /<!--\s*es:table\s+/.test(body);
}

function inferLimit(body: string) {
  const match =
    body.match(/(?:上限|制限)[：:\s]*(\d+)\s*文字/) ??
    body.match(/(\d+)\s*文字\s*(?:以内|以下|まで)/);
  if (match) return Number(match[1]);
  if (/^[ \t]*[（(]回答欄[）)][ \t]*$/m.test(body)) return 1000;
  if (/^[ \t]*>[ \t]*$/m.test(body)) return 1000;
  return undefined;
}

function inferQuestion(body: string) {
  return body.match(/設問[：:]\s*(.+)/)?.[1]?.trim();
}

function inferRadio(heading: string, body: string) {
  return (
    /一つだけ|1つだけ|ひとつだけ|単一選択/.test(body) ||
    /英会話力|英語読解力|在留資格|就職活動状況|最も重視/.test(heading)
  );
}

function wrapChoices(heading: string, body: string, sectionIndex: number) {
  if (hasChoiceWrapper(body) || !/^\s*-\s+\[( |x|X)\]\s+/m.test(body)) return body;
  const lines = body.split("\n");
  const first = lines.findIndex((line) => /^\s*-\s+\[( |x|X)\]\s+/.test(line));
  let last = first;
  while (last + 1 < lines.length && /^\s*-\s+\[( |x|X)\]\s+/.test(lines[last + 1])) {
    last += 1;
  }
  if (first === -1) return body;
  const id = `${fieldIdFromHeading(heading, `section_${sectionIndex + 1}`)}_choice`;
  const type = inferRadio(heading, body) ? "radio" : "checkbox";
  const label = escapeLabel(heading.replace(/^\d+\.\s*/, ""));
  const before = lines.slice(0, first);
  const choices = lines.slice(first, last + 1);
  const after = lines.slice(last + 1);
  return [
    ...before,
    `<!-- es:choice id=${id} type=${type} label="${label}" required=false -->`,
    ...choices,
    "<!-- es:choice-end -->",
    ...after,
  ].join("\n");
}

function wrapTable(heading: string, body: string, sectionIndex: number) {
  if (hasTableWrapper(body)) return body;
  const lines = body.split("\n");
  const separator = lines.findIndex((line) => line.includes("|") && isSeparatorRow(line));
  if (separator <= 0 || !lines[separator - 1]?.includes("|")) return body;
  let first = separator - 1;
  let last = separator + 1;
  while (first - 1 >= 0 && lines[first - 1].includes("|")) first -= 1;
  while (last + 1 < lines.length && lines[last + 1].includes("|")) last += 1;
  const id = `${fieldIdFromHeading(heading, `section_${sectionIndex + 1}`)}_table`;
  const label = escapeLabel(heading.replace(/^\d+\.\s*/, ""));
  return [
    ...lines.slice(0, first),
    `<!-- es:table id=${id} label="${label}" required=false -->`,
    ...lines.slice(first, last + 1),
    "<!-- es:table-end -->",
    ...lines.slice(last + 1),
  ].join("\n");
}

function stripAnswerPlaceholder(body: string) {
  return body
    .replace(/^[ \t]*[（(]回答欄[）)][ \t]*$/m, "")
    .replace(/^[ \t]*>[ \t]*$/m, "")
    .trim();
}

function addTextField(heading: string, body: string, sectionIndex: number) {
  if (hasTextField(body)) return body;
  const limit = inferLimit(body);
  if (!limit) return body;

  const id = `${fieldIdFromHeading(heading, `section_${sectionIndex + 1}`)}_text`;
  const label = escapeLabel(heading.replace(/^\d+\.\s*/, ""));
  const targetMin = limit >= 300 ? limit - 10 : undefined;
  const metaAttrs = [
    `id=${id}`,
    "type=textarea",
    targetMin ? `targetMin=${targetMin}` : "",
    `targetMax=${limit}`,
    "required=false",
    "ai=true",
  ]
    .filter(Boolean)
    .join(" ");
  const existingAnswer = stripAnswerPlaceholder(body);
  const question = inferQuestion(body);
  const instructionLines = body
    .split("\n")
    .filter((line) => !/^[ \t]*[（(]回答欄[）)][ \t]*$/.test(line))
    .filter((line) => !/^[ \t]*>[ \t]*$/.test(line))
    .join("\n")
    .trim();
  const answer =
    existingAnswer && question && existingAnswer.endsWith(question)
      ? ""
      : existingAnswer.replace(instructionLines, "").trim();

  return [
    instructionLines,
    "",
    `<!-- es:meta ${metaAttrs} -->`,
    `<!-- es:start id=${id} limit=${limit} label="${label}" -->`,
    "",
    answer,
    "",
    "<!-- es:end -->",
  ].join("\n");
}

function splitSubsections(body: string) {
  const headingRe = /^###\s+(.+)$/gm;
  const headings: { heading: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(body)) !== null) {
    headings.push({ heading: match[1].trim(), start: match.index, end: headingRe.lastIndex });
  }

  if (headings.length === 0) return null;

  return {
    prelude: body.slice(0, headings[0].start).trim(),
    subsections: headings.map((heading, index) => ({
      heading: heading.heading,
      body: body.slice(heading.end, headings[index + 1]?.start ?? body.length).trim(),
    })),
  };
}

function addTextFieldsForSubsections(sectionHeading: string, body: string, sectionIndex: number) {
  const split = splitSubsections(body);
  if (!split) return addTextField(sectionHeading, body, sectionIndex);

  const parts = split.prelude ? [split.prelude, ""] : [];
  split.subsections.forEach((subsection, subIndex) => {
    const combinedHeading = `${sectionHeading} ${subsection.heading}`;
    parts.push(`### ${subsection.heading}`);
    parts.push("");
    parts.push(addTextField(combinedHeading, subsection.body, Number(`${sectionIndex + 1}${subIndex + 1}`)));
    parts.push("");
  });

  return parts.join("\n").trim();
}

export function standardizeMarkdown(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const { prefix, sections } = splitRawSections(normalized);
  const used = new Set<string>();
  const output = [prefix || "# ES 入力シート"];

  sections.forEach((section, index) => {
    let body = section.body;
    const baseId = fieldIdFromHeading(section.heading, `section_${index + 1}`);
    if (used.has(baseId)) {
      section.heading = `${section.heading} ${index + 1}`;
    }
    used.add(baseId);
    body = wrapChoices(section.heading, body, index);
    body = wrapTable(section.heading, body, index);
    body = addTextFieldsForSubsections(section.heading, body, index);
    output.push(`## ${section.heading}`, "", body.trim(), "");
  });

  return output.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

function sectionForIndex(sections: EsSection[], index: number) {
  return (
    sections.find((section) => index >= section.bodyStart && index <= section.bodyEnd) ??
    sections[0]
  );
}

function extractQuestion(markdown: string, section: EsSection, fieldStart: number, label: string) {
  const source = markdown.slice(section.bodyStart, fieldStart);
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("<!-- es:count"))
    .filter((line) => !line.startsWith("**文字数："))
    .filter((line) => !/^上限[:：]/.test(line))
    .filter((line) => !/^記入例[:：]/.test(line))
    .filter((line) => !/^例[:：]/.test(line))
    .filter((line) => !/^---+$/.test(line));
  const explicit = lines.find((line) => /^設問[:：]/.test(line));
  if (explicit) return explicit.replace(/^設問[:：]\s*/, "");
  return lines.join("\n") || label;
}

function parseTextFields(markdown: string, sections: EsSection[]) {
  const fields: TextField[] = [];
  let match: RegExpExecArray | null;

  while ((match = textStartRe.exec(markdown)) !== null) {
    const [, id, limitText, label] = match;
    textEndRe.lastIndex = textStartRe.lastIndex;
    const endMatch = textEndRe.exec(markdown);
    if (!endMatch) continue;

    const countLineStart = findCountLineStart(markdown, id, match.index);
    const start = countLineStart ?? match.index;
    const rawAnswer = markdown.slice(textStartRe.lastIndex, endMatch.index);
    const counted = countAnswer(rawAnswer);
    const section = sectionForIndex(sections, match.index);
    const meta = findNearestMeta(markdown, match.index, id);
    const field: TextField = withTextValidation({
      type: "text",
      id,
      label,
      sectionId: section.id,
      question: extractQuestion(markdown, section, start, label),
      limit: Number(limitText),
      min: typeof meta.min === "number" ? meta.min : undefined,
      targetMin: typeof meta.targetMin === "number" ? meta.targetMin : undefined,
      targetMax: typeof meta.targetMax === "number" ? meta.targetMax : undefined,
      required: meta.required === true,
      ai: meta.ai !== false,
      tone:
        meta.tone === "plain" || meta.tone === "polite" || meta.tone === "business"
          ? meta.tone
          : undefined,
      visibleWhen: parseVisibleWhen(meta.visibleWhen),
      value: counted.value,
      count: counted.count,
      countWithNewlines: counted.countWithNewlines,
      meta,
      start,
      end: textEndRe.lastIndex,
      validation: { errors: [], warnings: [] },
      aiState: { status: "idle", attempts: 0 },
    });
    fields.push(field);
    section.fields.push(field);
    textStartRe.lastIndex = textEndRe.lastIndex;
  }

  return fields;
}

function findCountLineStart(markdown: string, id: string, fieldStart: number) {
  const previousLineStart = lineStart(markdown, fieldStart - 1);
  const previousLineEnd = lineEnd(markdown, previousLineStart);
  const line = markdown.slice(previousLineStart, previousLineEnd);
  return line.includes(`<!-- es:count id=${id} -->`) ? previousLineStart : undefined;
}

function parseChoiceOptions(block: string, offset: number) {
  const lines = block.split("\n");
  const options = [];
  let cursor = offset;

  for (const line of lines) {
    const match = line.match(/^\s*-\s+\[( |x|X)\]\s+(.+?)\s*$/);
    if (match) {
      options.push({
        label: match[2],
        checked: match[1].toLowerCase() === "x",
        sourceLine: cursor,
      });
    }
    cursor += line.length + 1;
  }

  return options;
}

function parseChoiceFields(markdown: string, sections: EsSection[]) {
  const fields: ChoiceField[] = [];
  let match: RegExpExecArray | null;

  while ((match = choiceStartRe.exec(markdown)) !== null) {
    choiceEndRe.lastIndex = choiceStartRe.lastIndex;
    const endMatch = choiceEndRe.exec(markdown);
    if (!endMatch) continue;
    const attrs = parseAttributes(match[1]);
    const id = String(attrs.id ?? `choice-${fields.length + 1}`);
    const section = sectionForIndex(sections, match.index);
    const block = markdown.slice(choiceStartRe.lastIndex, endMatch.index);
    const field: ChoiceField = {
      type: "choice",
      id,
      label: String(attrs.label ?? section.heading),
      sectionId: section.id,
      question: extractQuestion(markdown, section, match.index, String(attrs.label ?? section.heading)),
      multiple: attrs.type !== "radio",
      required: attrs.required === true,
      visibleWhen: parseVisibleWhen(attrs.visibleWhen),
      options: parseChoiceOptions(block, choiceStartRe.lastIndex),
      explicit: true,
      start: match.index,
      end: choiceEndRe.lastIndex,
      validation: { errors: [], warnings: [] },
    };
    fields.push(field);
    section.fields.push(field);
    choiceStartRe.lastIndex = choiceEndRe.lastIndex;
  }

  return fields;
}

function isInside(fields: EsField[], start: number, end: number) {
  return fields.some((field) => start >= field.start && end <= field.end);
}

function parseInferredChoices(markdown: string, sections: EsSection[], existing: EsField[]) {
  const fields: ChoiceField[] = [];
  for (const section of sections) {
    if (section.fields.some((field) => field.type === "choice")) continue;
    const block = markdown.slice(section.bodyStart, section.bodyEnd);
    const options = parseChoiceOptions(block, section.bodyStart);
    if (options.length === 0) continue;
    if (isInside(existing, options[0].sourceLine, options.at(-1)!.sourceLine)) continue;
    const field: ChoiceField = {
      type: "choice",
      id: slug(section.heading, `choice-${fields.length + 1}`),
      label: section.heading.replace(/^\d+\.\s*/, ""),
      sectionId: section.id,
      multiple: true,
      options,
      explicit: false,
      required: false,
      start: options[0].sourceLine,
      end: options.at(-1)!.sourceLine,
      validation: { errors: [], warnings: [] },
    };
    fields.push(field);
    section.fields.push(field);
  }
  return fields;
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}

function parseTableLines(block: string) {
  const lines = block.split("\n").filter((line) => line.includes("|"));
  if (lines.length < 2) return null;
  const separatorIndex = lines.findIndex(isSeparatorRow);
  if (separatorIndex <= 0) return null;
  const headers = splitTableRow(lines[separatorIndex - 1]);
  const rows = lines.slice(separatorIndex + 1).map(splitTableRow).filter((row) => row.length > 0);
  return { headers, rows };
}

function parseTableFields(markdown: string, sections: EsSection[], existing: EsField[]) {
  const fields: TableField[] = [];
  let match: RegExpExecArray | null;

  while ((match = tableStartRe.exec(markdown)) !== null) {
    tableEndRe.lastIndex = tableStartRe.lastIndex;
    const endMatch = tableEndRe.exec(markdown);
    if (!endMatch) continue;
    const attrs = parseAttributes(match[1]);
    const block = markdown.slice(tableStartRe.lastIndex, endMatch.index);
    const parsed = parseTableLines(block);
    if (!parsed) continue;
    const section = sectionForIndex(sections, match.index);
    const field: TableField = {
      type: "table",
      id: String(attrs.id ?? `table-${fields.length + 1}`),
      label: String(attrs.label ?? section.heading),
      sectionId: section.id,
      required: attrs.required === true,
      visibleWhen: parseVisibleWhen(attrs.visibleWhen),
      headers: parsed.headers,
      rows: parsed.rows,
      editableCells: editableCells(parsed.headers, parsed.rows),
      explicit: true,
      start: match.index,
      end: tableEndRe.lastIndex,
      validation: { errors: [], warnings: [] },
    };
    fields.push(field);
    section.fields.push(field);
  }

  for (const section of sections) {
    const block = markdown.slice(section.bodyStart, section.bodyEnd);
    if (!block.includes("|")) continue;
    const parsed = parseTableLines(block);
    if (!parsed) continue;
    const sectionStart = markdown.indexOf(parsed.headers.join(" | "), section.bodyStart);
    if (sectionStart !== -1 && isInside([...existing, ...fields], sectionStart, sectionStart + block.length)) {
      continue;
    }
    if (section.fields.some((field) => field.type === "table")) continue;
    const field: TableField = {
      type: "table",
      id: slug(section.heading, `table-${fields.length + 1}`),
      label: section.heading.replace(/^\d+\.\s*/, ""),
      sectionId: section.id,
      headers: parsed.headers,
      rows: parsed.rows,
      editableCells: editableCells(parsed.headers, parsed.rows),
      explicit: false,
      required: false,
      start: section.bodyStart,
      end: section.bodyEnd,
      validation: { errors: [], warnings: [] },
    };
    fields.push(field);
    section.fields.push(field);
  }

  return fields;
}

function editableCells(headers: string[], rows: string[][]) {
  const hasAnswerColumn = headers.some((header) => header.includes("回答"));
  const editable = [];
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      if (!hasAnswerColumn || headers[column]?.includes("回答") || column > 0) {
        editable.push({ row, column });
      }
    }
  }
  return editable;
}

export function parseMarkdown(markdown: string): EsDocument {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const title = normalized.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "ES入力シート";
  const sections = parseSections(normalized);
  const textFields = parseTextFields(normalized, sections);
  const explicitChoices = parseChoiceFields(normalized, sections);
  const inferredChoices = parseInferredChoices(normalized, sections, [...textFields, ...explicitChoices]);
  const tables = parseTableFields(normalized, sections, [
    ...textFields,
    ...explicitChoices,
    ...inferredChoices,
  ]);
  const fields = [...textFields, ...explicitChoices, ...inferredChoices, ...tables].sort(
    (a, b) => a.start - b.start,
  );

  for (const section of sections) {
    section.fields.sort((a, b) => a.start - b.start);
  }

  return { title, rawMarkdown: normalized, sections, fields };
}

export function updateTextField(field: TextField, value: string): TextField {
  const counted = countAnswer(value);
  return {
    ...field,
    value,
    count: counted.count,
    countWithNewlines: counted.countWithNewlines,
    validation: validateText({ ...field, value, count: counted.count }),
  };
}

export function validateText(field: Pick<TextField, "required" | "value" | "limit" | "count">) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (field.required && field.value.trim().length === 0) errors.push("必須項目です");
  if (field.count > field.limit) errors.push(`${field.count - field.limit}字オーバー`);
  if (/20XX|〇〇|TODO|要確認/.test(field.value)) warnings.push("仮置き文字が残っています");
  return { errors, warnings };
}

function withTextValidation(field: TextField): TextField {
  return { ...field, validation: validateText(field) };
}

export function protectedTerms(answer: string) {
  const terms = new Set<string>();
  const patterns = [
    /[A-Za-z][A-Za-z0-9.+-]{2,}/g,
    /[一-龥ァ-ヶーA-Za-z0-9]+(?:大学|大学院|研究室|株式会社|合同会社|学会|AI|DX|API)/g,
  ];
  for (const pattern of patterns) {
    for (const match of answer.matchAll(pattern)) {
      if (match[0].length >= 2) terms.add(match[0]);
    }
  }
  return [...terms].slice(0, 24);
}

function renderChoice(field: ChoiceField) {
  const lines = field.options.map((option) => `- [${option.checked ? "x" : " "}] ${option.label}`);
  if (!field.explicit) return lines.join("\n");
  const type = field.multiple ? "checkbox" : "radio";
  return [
    `<!-- es:choice id=${field.id} type=${type} label="${field.label}" required=${field.required === true} -->`,
    ...lines,
    "<!-- es:choice-end -->",
  ].join("\n");
}

function renderTable(field: TableField) {
  const separator = field.headers.map(() => "---");
  const lines = [
    `| ${field.headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...field.rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  if (!field.explicit) return lines.join("\n");
  return [
    `<!-- es:table id=${field.id} label="${field.label}" required=${field.required === true} -->`,
    ...lines,
    "<!-- es:table-end -->",
  ].join("\n");
}

export function serializeMarkdown(doc: EsDocument, fields: EsField[]) {
  let markdown = doc.rawMarkdown;
  const sorted = [...fields].sort((a, b) => b.start - a.start);

  for (const field of sorted) {
    if (field.type === "text") {
      const tagStart = markdown.indexOf(`<!-- es:start id=${field.id} limit=`, field.start);
      if (tagStart === -1) continue;
      textStartRe.lastIndex = tagStart;
      const startMatch = textStartRe.exec(markdown);
      if (!startMatch) continue;
      textEndRe.lastIndex = textStartRe.lastIndex;
      const endMatch = textEndRe.exec(markdown);
      if (!endMatch) continue;
      const replaceStart = field.start;
      const before = markdown.slice(0, replaceStart);
      const tag = startMatch[0];
      const after = markdown.slice(endMatch.index);
      const withValue = `${formatCountLine(field)}\n${tag}\n\n${field.value.trim()}\n\n`;
      markdown = `${before}${withValue}${after}`;
    } else if (field.explicit && field.type === "choice") {
      markdown = `${markdown.slice(0, field.start)}${renderChoice(field)}${markdown.slice(field.end)}`;
    } else if (field.explicit && field.type === "table") {
      markdown = `${markdown.slice(0, field.start)}${renderTable(field)}${markdown.slice(field.end)}`;
    }
  }

  return markdown.replace(/\n{4,}/g, "\n\n\n");
}

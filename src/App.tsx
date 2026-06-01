import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Clipboard,
  Download,
  FileText,
  Loader2,
  Save,
  Upload,
} from "lucide-react";
import { diffWords } from "diff";
import { requestAiAdjustment } from "./api";
import {
  countAnswer,
  formatCountLine,
  parseMarkdown,
  protectedTerms,
  serializeMarkdown,
  standardizeMarkdown,
  updateTextField,
} from "./markdown";
import type { ChoiceField, EsDocument, EsField, TableField, TextField } from "./types";

const samplePath = `${import.meta.env.BASE_URL}sample-es.md`;

function fieldStatus(field: EsField) {
  if (field.validation.errors.length > 0) return "error";
  if (field.validation.warnings.length > 0) return "warn";
  if (field.type === "text" && field.value.trim().length === 0) return "empty";
  return "ok";
}

function statusLabel(status: string) {
  if (status === "error") return "要修正";
  if (status === "warn") return "要確認";
  if (status === "empty") return "未入力";
  return "OK";
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

export default function App() {
  const [markdown, setMarkdown] = useState("");
  const [doc, setDoc] = useState<EsDocument | null>(null);
  const [fields, setFields] = useState<EsField[]>([]);
  const [filename, setFilename] = useState("es-input.md");
  const [savedMarkdown, setSavedMarkdown] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [standardizedNotice, setStandardizedNotice] = useState("");
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [aiReviewField, setAiReviewField] = useState<TextField | null>(null);
  const [aiBefore, setAiBefore] = useState("");
  const [aiCandidate, setAiCandidate] = useState("");
  const [aiError, setAiError] = useState("");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    void fetch(samplePath)
      .then((response) => response.text())
      .then((text) => loadMarkdown(text, "sample-es.md"))
      .catch(() => loadMarkdown(defaultMarkdown, "new-es.md"));
  }, []);

  function loadMarkdown(text: string, name = filename) {
    const standardized = standardizeMarkdown(text);
    const parsed = parseMarkdown(standardized);
    setMarkdown(standardized);
    setDoc(parsed);
    setFields(parsed.fields);
    setSavedMarkdown(standardized);
    setFilename(name);
    setStandardizedNotice(
      standardized === text.replace(/\r\n/g, "\n").trim() + "\n"
        ? "Markdownを読み込みました。"
        : "Markdownを標準形式へ変換してフォームを生成しました。",
    );
    setActiveSection(parsed.sections[0]?.id ?? null);
  }

  const currentMarkdown = useMemo(() => {
    if (!doc) return markdown;
    return serializeMarkdown(doc, fields);
  }, [doc, fields, markdown]);

  const dirty = currentMarkdown !== savedMarkdown;
  const textFields = fields.filter((field): field is TextField => field.type === "text");
  const errorCount = fields.reduce((sum, field) => sum + field.validation.errors.length, 0);
  const warningCount = fields.reduce((sum, field) => sum + field.validation.warnings.length, 0);
  const fieldsBySection = useMemo(() => {
    const grouped = new Map<string, EsField[]>();
    for (const field of fields) {
      const sectionFields = grouped.get(field.sectionId) ?? [];
      sectionFields.push(field);
      grouped.set(field.sectionId, sectionFields);
    }
    return grouped;
  }, [fields]);

  function replaceField(next: EsField) {
    setFields((previous) => previous.map((field) => (field.id === next.id ? next : field)));
  }

  function handleTextChange(field: TextField, value: string) {
    replaceField(updateTextField(field, value));
  }

  function handleChoiceChange(field: ChoiceField, optionIndex: number, checked: boolean) {
    const next: ChoiceField = {
      ...field,
      options: field.options.map((option, index) => {
        if (field.multiple) return index === optionIndex ? { ...option, checked } : option;
        return { ...option, checked: index === optionIndex };
      }),
    };
    replaceField(next);
  }

  function handleTableChange(field: TableField, row: number, column: number, value: string) {
    replaceField({
      ...field,
      rows: field.rows.map((cells, rowIndex) =>
        rowIndex === row ? cells.map((cell, columnIndex) => (columnIndex === column ? value : cell)) : cells,
      ),
    });
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => loadMarkdown(String(reader.result ?? ""), file.name);
    reader.readAsText(file);
  }

  function saveSnapshot() {
    setSavedMarkdown(currentMarkdown);
    downloadText(filename, currentMarkdown);
  }

  async function adjustText(field: TextField) {
    setAiError("");
    const targetMax = field.targetMax ?? field.limit;
    const targetMin = field.targetMin;

    if (!targetMin && field.count <= field.limit) {
      setAiError("targetMin未指定かつ上限内のため、AIで水増ししません。");
      return;
    }

    const mode =
      field.count > targetMax ? "shorten" : targetMin && field.count < targetMin ? "expand" : "fit";
    const request = {
      label: field.label,
      question: field.question,
      answer: field.value,
      targetMin,
      targetMax,
      protectedTerms: protectedTerms(field.value),
      mode,
    } as const;

    if (
      !window.confirm(
        `Gemini APIへ「${field.label}」の本文を送信します。個人情報を含む可能性があります。続行しますか？`,
      )
    ) {
      return;
    }

    const candidates: { text: string; distance: number }[] = [];
    let current = field.value;
    let lastError = "";
    replaceField({ ...field, aiState: { status: "running", attempts: 0 } });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const text = await requestAiAdjustment({ ...request, answer: current });
        const counted = countAnswer(text);
        const lower = targetMin ?? 0;
        const distance =
          counted.count < lower ? lower - counted.count : counted.count > targetMax ? counted.count - targetMax : 0;
        candidates.push({ text, distance });
        current = text;
        replaceField({ ...field, aiState: { status: "running", attempts: attempt } });
        if (distance === 0) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    const best = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!best) {
      replaceField({ ...field, aiState: { status: "error", attempts: 0, errorMessage: lastError } });
      setAiError(
        lastError ||
          "AI調整に失敗しました。GitHub Pages版ではAPIサーバーがないため、ローカルで npm run dev を使ってください。",
      );
      return;
    }

    setAiBefore(field.value);
    setAiCandidate(best.text);
    setAiReviewField({ ...field, aiState: { status: "candidate", attempts: candidates.length } });
    replaceField({
      ...field,
      aiState: {
        status: "candidate",
        attempts: candidates.length,
        candidate: best.text,
        candidateCount: countAnswer(best.text).count,
      },
    });
  }

  function acceptAiCandidate() {
    if (!aiReviewField) return;
    handleTextChange(aiReviewField, aiCandidate);
    setAiReviewField(null);
    setAiBefore("");
    setAiCandidate("");
  }

  function scrollToSection(sectionId: string) {
    setActiveSection(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ES Markdown Editor</div>
          <h1>ES Supporter Automatic Kun</h1>
        </div>
        <div className="topbar-actions">
          <label className="button secondary">
            <Upload size={16} />
            ファイル読み込み
            <input
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
            />
          </label>
          <button className="button secondary" onClick={() => setShowPaste((value) => !value)}>
            <Clipboard size={16} />
            Markdown貼り付け
          </button>
          <button className="button secondary" onClick={() => setShowPreview((value) => !value)}>
            <FileText size={16} />
            {showPreview ? "Previewを閉じる" : "Preview"}
          </button>
          <button className="button primary" onClick={saveSnapshot}>
            <Save size={16} />
            保存
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="file-card">
            <div className="filename">{filename}</div>
            <div className={dirty ? "save-state dirty" : "save-state"}>
              {dirty ? "未保存の変更あり" : "保存済み"}
            </div>
          </div>
          <div className="summary-grid">
            <div>
              <strong>{textFields.length}</strong>
              <span>文章欄</span>
            </div>
            <div>
              <strong>{errorCount}</strong>
              <span>エラー</span>
            </div>
            <div>
              <strong>{warningCount}</strong>
              <span>警告</span>
            </div>
          </div>
          <nav className="section-nav">
            {doc?.sections.map((section) => {
              const sectionFields = fieldsBySection.get(section.id) ?? [];
              const statuses = sectionFields.map(fieldStatus);
              const status = statuses.includes("error")
                ? "error"
                : statuses.includes("warn")
                  ? "warn"
                  : statuses.includes("empty")
                    ? "empty"
                    : "ok";
              return (
                <button
                  key={section.id}
                  className={activeSection === section.id ? "nav-item active" : "nav-item"}
                  onClick={() => scrollToSection(section.id)}
                >
                  <span>{section.heading}</span>
                  <em className={`pill ${status}`}>{statusLabel(status)}</em>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className={showPreview ? "editor-grid" : "editor-grid full"}>
          <div className="form-pane">
            {showPaste && (
              <section className="paste-panel">
                <div className="field-header">
                  <div>
                    <h2>Markdown貼り付け</h2>
                    <p>手元のES Markdownを貼り付けて、その場でフォーム化できます。</p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => {
                      if (!pasteText.trim()) return;
                      loadMarkdown(pasteText, "pasted-es.md");
                      setShowPaste(false);
                    }}
                  >
                    フォーム生成
                  </button>
                </div>
                <textarea
                  className="paste-textarea"
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  placeholder="# 企業名 ES 入力シート&#10;&#10;## 志望理由&#10;..."
                />
              </section>
            )}
            {standardizedNotice && <div className="notice">{standardizedNotice}</div>}
            {aiError && (
              <div className="alert">
                <AlertTriangle size={18} />
                {aiError}
              </div>
            )}
            {doc?.sections.map((section) => (
              <section
                key={section.id}
                className="es-section"
                ref={(node) => {
                  sectionRefs.current[section.id] = node;
                }}
              >
                <h2>{section.heading}</h2>
                {(fieldsBySection.get(section.id) ?? []).length === 0 && (
                  <p className="muted">このセクションに入力フィールドはありません。</p>
                )}
                {(fieldsBySection.get(section.id) ?? []).map((field) => (
                  <FieldEditor
                    key={field.id}
                    field={field}
                    onTextChange={handleTextChange}
                    onChoiceChange={handleChoiceChange}
                    onTableChange={handleTableChange}
                    onAdjust={adjustText}
                  />
                ))}
              </section>
            ))}
          </div>
          {showPreview && (
            <aside className="preview-pane">
              <div className="preview-header">
                <h2>Markdown Preview</h2>
                <button className="icon-button" onClick={() => copyText(currentMarkdown)} title="Markdownをコピー">
                  <Clipboard size={16} />
                </button>
                <button className="icon-button" onClick={() => downloadText(filename, currentMarkdown)} title="ダウンロード">
                  <Download size={16} />
                </button>
              </div>
              <pre>{currentMarkdown}</pre>
            </aside>
          )}
        </section>
      </main>

      {aiReviewField && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h2>AI調整結果</h2>
              <button className="button secondary" onClick={() => setAiReviewField(null)}>
                閉じる
              </button>
            </div>
            <div className="diff-grid">
              <div>
                <h3>元文</h3>
                <p>{aiBefore}</p>
                <span>{countAnswer(aiBefore).count}字</span>
              </div>
              <div>
                <h3>調整後</h3>
                <p>{aiCandidate}</p>
                <span>{countAnswer(aiCandidate).count}字</span>
              </div>
            </div>
            <div className="diff-line">
              {diffWords(aiBefore, aiCandidate).map((part, index) => (
                <span key={index} className={part.added ? "added" : part.removed ? "removed" : ""}>
                  {part.value}
                </span>
              ))}
            </div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setAiReviewField(null)}>
                破棄
              </button>
              <button className="button primary" onClick={acceptAiCandidate}>
                <Check size={16} />
                採用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldEditor({
  field,
  onTextChange,
  onChoiceChange,
  onTableChange,
  onAdjust,
}: {
  field: EsField;
  onTextChange: (field: TextField, value: string) => void;
  onChoiceChange: (field: ChoiceField, optionIndex: number, checked: boolean) => void;
  onTableChange: (field: TableField, row: number, column: number, value: string) => void;
  onAdjust: (field: TextField) => void;
}) {
  if (field.type === "text") {
    const over = field.count - field.limit;
    const targetMin = field.targetMin;
    const underTarget = targetMin ? Math.max(0, targetMin - field.count) : 0;
    return (
      <article className="field-card">
        <div className="field-header">
          <div>
            <h3>{field.label}</h3>
            {field.question && <p>{field.question}</p>}
          </div>
          <span className={over > 0 ? "counter over" : underTarget > 0 ? "counter under" : "counter"}>
            {field.count}/{field.limit}字
            {over > 0 ? ` ${over}字オーバー` : underTarget > 0 ? ` 目標まで${underTarget}字` : ""}
          </span>
        </div>
        <textarea value={field.value} onChange={(event) => onTextChange(field, event.target.value)} />
        <div className="field-actions">
          <button className="button secondary" onClick={() => copyText(field.value)}>
            <Clipboard size={15} />
            コピー
          </button>
          <button className="button ai" onClick={() => onAdjust(field)} disabled={field.aiState?.status === "running"}>
            {field.aiState?.status === "running" ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
            文字数調整
          </button>
          {window.location.hostname.endsWith("github.io") && (
            <span className="hint">AI調整はローカル起動時のみ</span>
          )}
          {field.countWithNewlines !== field.count && (
            <span className="hint">改行込み {field.countWithNewlines}字</span>
          )}
        </div>
      </article>
    );
  }

  if (field.type === "choice") {
    return (
      <article className="field-card compact">
        <div className="field-header">
          <h3>{field.label}</h3>
          <span className="hint">{field.multiple ? "複数選択" : "単一選択"}</span>
        </div>
        <div className="choice-grid">
          {field.options.map((option, index) => (
            <label key={option.label} className="choice">
              <input
                type={field.multiple ? "checkbox" : "radio"}
                name={field.id}
                checked={option.checked}
                onChange={(event) => onChoiceChange(field, index, event.target.checked)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </article>
    );
  }

  return (
    <article className="field-card compact">
      <div className="field-header">
        <h3>{field.label}</h3>
        <span className="hint">表入力</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {field.headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => {
                  const editable = field.editableCells.some(
                    (target) => target.row === rowIndex && target.column === columnIndex,
                  );
                  return (
                    <td key={columnIndex}>
                      {editable ? (
                        <input value={cell} onChange={(event) => onTableChange(field, rowIndex, columnIndex, event.target.value)} />
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

const defaultMarkdown = `# ES 入力シート

## 志望理由

上限：500文字以内
設問：志望理由をご記入ください。

<!-- es:meta id=company_reason type=textarea targetMin=490 targetMax=500 required=true ai=true tone=business -->
<!-- es:start id=company_reason limit=500 label="志望理由" -->

これは公開用のダミー回答です。実際の企業名、学校名、研究内容、選考状況などは含めず、動作確認のためだけに配置しています。手元のESを編集する場合は、ファイル読み込みまたはMarkdown貼り付けからローカルのMarkdownを読み込んでください。

<!-- es:end -->
`;

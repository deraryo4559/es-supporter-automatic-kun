export type FieldValidation = {
  errors: string[];
  warnings: string[];
};

export type VisibleWhen = {
  fieldId: string;
  equals: string;
};

export type BaseField = {
  id: string;
  label: string;
  sectionId: string;
  start: number;
  end: number;
  validation: FieldValidation;
  visibleWhen?: VisibleWhen;
  required?: boolean;
};

export type TextField = BaseField & {
  type: "text";
  question: string;
  limit: number;
  min?: number;
  targetMin?: number;
  targetMax?: number;
  ai?: boolean;
  tone?: "plain" | "polite" | "business";
  value: string;
  count: number;
  countWithNewlines: number;
  meta?: Record<string, string | boolean | number>;
  countLine?: string;
  aiState?: {
    status: "idle" | "running" | "candidate" | "error";
    attempts: number;
    candidate?: string;
    candidateCount?: number;
    errorMessage?: string;
  };
};

export type ChoiceOption = {
  label: string;
  checked: boolean;
  sourceLine: number;
};

export type ChoiceField = BaseField & {
  type: "choice";
  question?: string;
  multiple: boolean;
  options: ChoiceOption[];
  explicit: boolean;
};

export type TableField = BaseField & {
  type: "table";
  headers: string[];
  rows: string[][];
  editableCells: { row: number; column: number }[];
  explicit: boolean;
};

export type EsField = TextField | ChoiceField | TableField;

export type EsSection = {
  id: string;
  heading: string;
  bodyStart: number;
  bodyEnd: number;
  description: string;
  fields: EsField[];
};

export type EsDocument = {
  title: string;
  rawMarkdown: string;
  sections: EsSection[];
  fields: EsField[];
};

export type AiAdjustRequest = {
  label: string;
  question: string;
  answer: string;
  targetMin?: number;
  targetMax: number;
  protectedTerms: string[];
  mode: "shorten" | "expand" | "fit";
};

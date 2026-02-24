"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_COLORS } from "@/lib/color-palette";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { EditAction } from "../_components/EditAction";
import ColorSelectionDropdown, { BASE_COLOR_GROUPS, PILL_COLOR_GROUPS } from "../_components/ColorSelectionDropdown";
import type { PillTone } from "../_components/Pill";
import { ReportComponentTable, type ReportComponentTableColumn } from "./ReportComponentTable";
import ReportComponentConditionalBar from "./ReportComponentConditionalBar";

type AvailableColumn = {
  key: string;
  dataset_key: string;
  column: string;
  source_schema: string;
  selected: boolean;
};

type ConditionalClauseDraft = {
  field: string;
  op: "eq" | "neq";
  value: string;
};

type ConditionalRuleDraft = {
  include: boolean;
  color: string;
  clauses: ConditionalClauseDraft[];
};

type ColumnTypeDraft = {
  type: "" | "threshold" | "percentage_of_total_bar" | "conditional_bar" | "number" | "percent" | "text" | "pill";
  gte: string;
  lte: string;
  display: "percentage" | "number" | "raw" | "title_case";
  fraction_digits: string;
  colors_by_value: Record<string, string>;
  color: string;
  color_else: string;
  bar_max: string;
  value_from: string;
  threshold_from: string;
  label_from: string;
  conditions: ConditionalRuleDraft[];
};

type GenericRow = Record<string, unknown>;

type TableConfigResponse = {
  ok: boolean;
  config?: {
    report_id: string;
    report_component_id: string;
    route: string;
    component_code: string;
    selected_columns: string[];
    available_columns: AvailableColumn[];
    column_types: Record<string, unknown>;
  };
  error?: string;
};

type TableDataResponse = {
  ok: boolean;
  data?: GenericRow[];
  meta?: {
    selected_columns?: unknown;
  };
  error?: string;
};

const EDIT_COLUMNS_STATE_EVENT = "analytics:report-component-edit-state";
const EDIT_COLUMNS_CHANGE_EVENT = "analytics:report-component-edit-columns-change";
const EDIT_COMPONENT_SAVE_REQUEST_EVENT = "analytics:report-component-edit-save-request";
const EDIT_COMPONENT_RESET_REQUEST_EVENT = "analytics:report-component-edit-reset-request";
const RESERVED_QUERY_KEYS = new Set(["route", "include_meta", "include_rows", "anonymize"]);
function createEmptyDraft(): ColumnTypeDraft {
  return {
    type: "",
    gte: "",
    lte: "",
    display: "percentage",
    fraction_digits: "",
    colors_by_value: {},
    color: "green",
    color_else: "darkGray",
    bar_max: "",
    value_from: "",
    threshold_from: "",
    label_from: "",
    conditions: [],
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toTitleCase(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value: unknown, fractionDigits = 2): string {
  const number = toNumber(value);
  if (number === null) {
    return "-";
  }
  return number.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

function resolveBarColor(colorName: string | undefined): string {
  const normalized = String(colorName ?? "").trim();
  if (!normalized) {
    throw new Error("Missing bar color");
  }
  if (normalized === "neutral") {
    return APP_COLORS.darkGray;
  }
  if (normalized === "success") {
    return APP_COLORS.green;
  }
  if (normalized === "warning") {
    return APP_COLORS.yellowDark;
  }
  if (normalized === "danger") {
    return APP_COLORS.red;
  }
  if (normalized === "info") {
    return APP_COLORS.blue;
  }
  if (normalized in APP_COLORS) {
    return APP_COLORS[normalized as keyof typeof APP_COLORS];
  }
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("rgb(") ||
    normalized.startsWith("rgba(") ||
    normalized.startsWith("hsl(") ||
    normalized.startsWith("hsla(") ||
    normalized.startsWith("var(")
  ) {
    return normalized;
  }
  throw new Error(`Unsupported bar color: ${normalized}`);
}

function matchesDraftThreshold(draft: ColumnTypeDraft, value: number): boolean {
  const gte = Number(draft.gte);
  const lte = Number(draft.lte);
  const hasGte = Number.isFinite(gte);
  const hasLte = Number.isFinite(lte);
  if (!hasGte && !hasLte) {
    return true;
  }
  if (hasGte && value < gte) {
    return false;
  }
  if (hasLte && value > lte) {
    return false;
  }
  return true;
}

function normalizeConditionValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function normalizeConditionPickValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function evaluateDraftCondition(
  draft: ColumnTypeDraft,
  row: GenericRow,
  resolveField: (field: string) => string
): { include: boolean; color?: string; conditionIndex: number } | null {
  for (let conditionIndex = 0; conditionIndex < draft.conditions.length; conditionIndex += 1) {
    const condition = draft.conditions[conditionIndex];
    const isMatch = condition.clauses.every((clause) => {
      const left = normalizeConditionValue(row[resolveField(clause.field)]);
      const right = normalizeConditionValue(clause.value);
      if (clause.op === "neq") {
        return left !== right;
      }
      return left === right;
    });
    if (isMatch) {
      return {
        include: condition.include !== false,
        color: condition.color,
        conditionIndex,
      };
    }
  }
  return null;
}

function formatConditionName(args: {
  condition: ConditionalRuleDraft;
  availableByKey: Map<string, AvailableColumn>;
}): string {
  const clauses = args.condition.clauses.map((clause) => {
    const available = args.availableByKey.get(clause.field);
    const fieldName = toTitleCase(available?.column ?? parseSelectedKey(clause.field).column ?? clause.field);
    const operator = clause.op === "neq" ? "!=" : "=";
    return `${fieldName} ${operator} ${clause.value}`;
  });
  return clauses.join(" AND ");
}

function normalizeConditionalBarDraft(existing: ColumnTypeDraft): ColumnTypeDraft {
  return {
    ...existing,
    type: "conditional_bar",
    display: existing.display === "number" ? "number" : "percentage",
  };
}

function normalizePillValueKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toPillDisplayLabel(value: unknown, display: ColumnTypeDraft["display"]): string {
  const normalized = normalizePillValueKey(value);
  if (!normalized) {
    return "(empty)";
  }
  if (display === "title_case") {
    return toTitleCase(normalized);
  }
  return normalized;
}

function resolvePillColorForValue(
  colorsByValue: Record<string, string>,
  value: unknown
): PillTone {
  const key = normalizePillValueKey(value);
  if (colorsByValue[key]) {
    return colorsByValue[key] as PillTone;
  }
  if (!key) {
    return "neutral";
  }
  const lower = key.toLowerCase();
  const fallbackEntry = Object.entries(colorsByValue).find(
    ([candidateKey]) => candidateKey.toLowerCase() === lower
  );
  return (fallbackEntry?.[1] ?? "neutral") as PillTone;
}

function parseColumnTypeDraft(raw: unknown): ColumnTypeDraft {
  if (!isObjectRecord(raw)) {
    return createEmptyDraft();
  }

  const typeRaw = String(raw.type ?? "").trim().toLowerCase();
  const type: ColumnTypeDraft["type"] =
    typeRaw === "threshold" ||
    typeRaw === "percentage_of_total_bar" ||
    typeRaw === "conditional_bar" ||
    typeRaw === "number" ||
    typeRaw === "percent" ||
    typeRaw === "text" ||
    typeRaw === "pill"
      ? typeRaw
      : "";

  const threshold = isObjectRecord(raw.threshold) ? raw.threshold : {};
  const gte =
    typeof threshold.gte === "number" && Number.isFinite(threshold.gte)
      ? String(threshold.gte)
      : "";
  const lte =
    typeof threshold.lte === "number" && Number.isFinite(threshold.lte)
      ? String(threshold.lte)
      : "";
  const display: ColumnTypeDraft["display"] =
    raw.display === "number" || raw.display === "percentage" || raw.display === "raw" || raw.display === "title_case"
      ? raw.display
      : (type === "pill" ? "raw" : "percentage");
  const fraction_digits =
    typeof raw.fraction_digits === "number" && Number.isFinite(raw.fraction_digits)
      ? String(raw.fraction_digits)
      : "";
  const colorsByValueRaw =
    isObjectRecord(raw.colors_by_value)
      ? raw.colors_by_value
      : (isObjectRecord(raw.tones_by_value) ? raw.tones_by_value : {});
  const colors_by_value: Record<string, string> = {};
  for (const [valueKey, color] of Object.entries(colorsByValueRaw)) {
    const colorValue = String(color ?? "").trim();
    if (!colorValue) {
      continue;
    }
    colors_by_value[String(valueKey ?? "")] = colorValue;
  }
  const color =
    typeof raw.color === "string" && raw.color.trim().length > 0
      ? raw.color.trim()
      : "green";
  const color_else =
    typeof raw.color_else === "string" && raw.color_else.trim().length > 0
      ? raw.color_else.trim()
      : "darkGray";
  const bar_max =
    typeof raw.bar_max === "number" && Number.isFinite(raw.bar_max) && raw.bar_max > 0
      ? String(raw.bar_max)
      : "";
  const value_from =
    typeof raw.value_from === "string" && raw.value_from.trim().length > 0
      ? raw.value_from.trim()
      : "";
  const threshold_from =
    typeof raw.threshold_from === "string" && raw.threshold_from.trim().length > 0
      ? raw.threshold_from.trim()
      : "";
  const label_from =
    typeof raw.label_from === "string" && raw.label_from.trim().length > 0
      ? raw.label_from.trim()
      : "";
  const conditions: ConditionalRuleDraft[] = Array.isArray(raw.conditions)
    ? raw.conditions
        .filter((condition): condition is Record<string, unknown> => isObjectRecord(condition))
        .map((condition) => {
          const colorRaw = String(condition.color ?? "").trim();
          const clauses = Array.isArray(condition.all)
            ? condition.all
                .filter((clause): clause is Record<string, unknown> => isObjectRecord(clause))
                .map((clause) => {
                  const field = String(clause.field ?? "").trim();
                  const op: "eq" | "neq" = String(clause.op ?? "").trim().toLowerCase() === "neq" ? "neq" : "eq";
                  const value = String(clause.value ?? "");
                  if (!field) {
                    return null;
                  }
                  return { field, op, value };
                })
                .filter((clause): clause is ConditionalClauseDraft => clause !== null)
            : [];
          if (clauses.length === 0) {
            return null;
          }
          return {
            include: condition.include !== false,
            color: colorRaw || "yellow",
            clauses,
          };
        })
        .filter((rule): rule is ConditionalRuleDraft => rule !== null)
    : [];

  return {
    type,
    gte,
    lte,
    display,
    fraction_digits,
    colors_by_value,
    color,
    color_else,
    bar_max,
    value_from,
    threshold_from,
    label_from,
    conditions,
  };
}

function draftToPayload(draft: ColumnTypeDraft): Record<string, unknown> | null {
  if (!draft.type) {
    return null;
  }

  if (draft.type === "percentage_of_total_bar" || draft.type === "number" || draft.type === "percent" || draft.type === "text") {
    return { type: draft.type };
  }

  if (draft.type === "pill") {
    return {
      type: "pill",
      display: draft.display === "title_case" ? "title_case" : "raw",
      ...(Object.keys(draft.colors_by_value).length > 0 ? { colors_by_value: draft.colors_by_value } : {}),
    };
  }

  if (draft.type === "threshold") {
    const threshold: Record<string, number> = {};
    const gteNum = Number(draft.gte);
    const lteNum = Number(draft.lte);
    if (Number.isFinite(gteNum)) {
      threshold.gte = gteNum;
    }
    if (Number.isFinite(lteNum)) {
      threshold.lte = lteNum;
    }
    if (Object.keys(threshold).length === 0) {
      return null;
    }

    const payload: Record<string, unknown> = {
      type: "threshold",
      threshold,
      display: draft.display === "number" ? "number" : "percentage",
    };
    const digitsNum = Number(draft.fraction_digits);
    if (Number.isFinite(digitsNum)) {
      payload.fraction_digits = digitsNum;
    }
    return payload;
  }

  if (draft.type === "conditional_bar") {
    const threshold: Record<string, number> = {};
    const gteNum = Number(draft.gte);
    const lteNum = Number(draft.lte);
    if (Number.isFinite(gteNum)) {
      threshold.gte = gteNum;
    }
    if (Number.isFinite(lteNum)) {
      threshold.lte = lteNum;
    }
    const conditions = draft.conditions
      .map((condition) => {
        const all = condition.clauses
          .map((clause) => {
            const field = String(clause.field ?? "").trim();
            if (!field) {
              return null;
            }
            return {
              field,
              op: clause.op === "neq" ? "neq" : "eq",
              value: String(clause.value ?? ""),
            };
          })
          .filter((clause): clause is { field: string; op: "eq" | "neq"; value: string } => clause !== null);
        if (all.length === 0) {
          return null;
        }
        return {
          include: condition.include !== false,
          color: condition.color || "darkGray",
          all,
        };
      })
      .filter(
        (
          condition
        ): condition is { include: boolean; color: string; all: Array<{ field: string; op: "eq" | "neq"; value: string }> } =>
          condition !== null
      );

    const payload: Record<string, unknown> = {
      type: "conditional_bar",
      display: draft.display === "number" ? "number" : "percentage",
      color: draft.color || "green",
      color_else: draft.color_else || "darkGray",
      ...(draft.value_from ? { value_from: draft.value_from } : {}),
      ...(draft.threshold_from ? { threshold_from: draft.threshold_from } : {}),
      ...(draft.label_from ? { label_from: draft.label_from } : {}),
      ...(Object.keys(threshold).length > 0 ? { threshold } : {}),
      ...(conditions.length > 0 ? { conditions } : {}),
    };
    const digitsNum = Number(draft.fraction_digits);
    if (Number.isFinite(digitsNum)) {
      payload.fraction_digits = digitsNum;
    }
    const barMaxNum = Number(draft.bar_max);
    if (Number.isFinite(barMaxNum) && barMaxNum > 0) {
      payload.bar_max = barMaxNum;
    }
    return payload;
  }

  return null;
}

function parseSelectedKey(key: string): { datasetKey: string; column: string } {
  const [datasetKey, column] = String(key ?? "").trim().split(".");
  return {
    datasetKey: datasetKey ?? "",
    column: column ?? "",
  };
}

function resolveFieldKey(args: {
  preferred?: string;
  availableKeys: Set<string>;
  fallback: string;
}): string {
  const preferredRaw = String(args.preferred ?? "").trim();
  if (!preferredRaw) {
    return args.fallback;
  }

  if (args.availableKeys.has(preferredRaw)) {
    return preferredRaw;
  }
  const preferredLower = preferredRaw.toLowerCase();
  const exactIgnoreCase = Array.from(args.availableKeys).find((key) => key.toLowerCase() === preferredLower);
  if (exactIgnoreCase) {
    return exactIgnoreCase;
  }
  const preferredSuffix = preferredRaw.includes(".") ? preferredRaw.split(".").pop() ?? preferredRaw : preferredRaw;
  if (args.availableKeys.has(preferredSuffix)) {
    return preferredSuffix;
  }
  const suffixMatch = Array.from(args.availableKeys).find((key) => key.toLowerCase().endsWith(`.${preferredLower}`));
  if (suffixMatch) {
    return suffixMatch;
  }
  return args.fallback;
}

function rowKey(row: GenericRow, index: number): string {
  const preferredKeys = ["sis_user_id", "academic_year", "program_code", "course_code", "id"];
  const parts = preferredKeys
    .map((key) => row[key])
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .map((value) => String(value).trim());
  if (parts.length > 0) {
    return `${parts.join("|")}|${index}`;
  }
  return `row-${index}`;
}

function buildColumnTypesPayload(args: {
  selectedColumns: string[];
  availableColumns: AvailableColumn[];
  columnTypeDrafts: Record<string, ColumnTypeDraft>;
}): Record<string, unknown> {
  const { selectedColumns, availableColumns, columnTypeDrafts } = args;
  const availableKeySet = new Set(availableColumns.map((item) => item.key));
  const filteredSelected = selectedColumns.filter((key) => availableKeySet.has(key));
  const columnTypes: Record<string, unknown> = {};
  for (const key of filteredSelected) {
    const payload = draftToPayload(columnTypeDrafts[key] ?? createEmptyDraft());
    if (payload) {
      columnTypes[key] = payload;
    }
  }
  return columnTypes;
}

function buildConfigSignature(args: {
  selectedColumns: string[];
  availableColumns: AvailableColumn[];
  columnTypeDrafts: Record<string, ColumnTypeDraft>;
}): string {
  const { selectedColumns, availableColumns, columnTypeDrafts } = args;
  const availableKeySet = new Set(availableColumns.map((item) => item.key));
  const filteredSelected = selectedColumns.filter((key) => availableKeySet.has(key));
  const columnTypes = buildColumnTypesPayload({
    selectedColumns: filteredSelected,
    availableColumns,
    columnTypeDrafts,
  });
  return JSON.stringify({
    selected_columns: filteredSelected,
    column_types: columnTypes,
  });
}

export default function ReportComponentConditionalBarEdit(args: {
  reportId: string;
  reportComponentId: string;
  configApiPath?: string;
  dataApiPath?: string;
  componentMode?: "table" | "conditional_bar";
}) {
  const {
    reportId,
    reportComponentId,
    configApiPath = "/api/reports/components/conditional-bar-config",
    dataApiPath = "/api/reports/components/conditional-bar",
    componentMode = "conditional_bar",
  } = args;
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [reportRoute, setReportRoute] = useState<string>("");
  const [componentCode, setComponentCode] = useState<string>("table");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [availableColumns, setAvailableColumns] = useState<AvailableColumn[]>([]);
  const [columnTypeDrafts, setColumnTypeDrafts] = useState<Record<string, ColumnTypeDraft>>({});
  const [previewRows, setPreviewRows] = useState<GenericRow[]>([]);
  const [activeColumnKey, setActiveColumnKey] = useState<string | null>(null);
  const [activeConditionIndex, setActiveConditionIndex] = useState<number | null>(null);
  const [dragConditionIndex, setDragConditionIndex] = useState<number | null>(null);
  const lastSavedConfigSignatureRef = useRef<string>("");

  const loadPreview = useCallback(
    async (nextRoute: string) => {
      if (!nextRoute) {
        setPreviewRows([]);
        return;
      }

      setLoadingPreview(true);
      try {
        const params = new URLSearchParams({
          route: nextRoute,
          include_meta: "1",
          include_rows: "1",
          anonymize: "0",
          all_columns: "1",
        });

        const incoming = new URLSearchParams(searchParamsKey);
        for (const [key, value] of incoming.entries()) {
          if (!value || RESERVED_QUERY_KEYS.has(key)) {
            continue;
          }
          params.set(key, value);
        }

        const res = await fetch(`${dataApiPath}?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as TableDataResponse;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Failed to load preview rows");
        }

        setPreviewRows(Array.isArray(json.data) ? json.data : []);
      } catch (e: unknown) {
        setError(String(e));
        setPreviewRows([]);
      } finally {
        setLoadingPreview(false);
      }
    },
    [dataApiPath, searchParamsKey]
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    try {
      const res = await fetch(
        `${configApiPath}?report_id=${encodeURIComponent(reportId)}&report_component_id=${encodeURIComponent(reportComponentId)}`,
        {
          cache: "no-store",
        }
      );
      const json = (await res.json()) as TableConfigResponse;
      if (!res.ok || !json.config) {
        throw new Error(json.error || "Failed to load table config");
      }

      const nextRouteRaw = String(json.config.route ?? "").trim();
      const nextRoute = nextRouteRaw || reportId;
      const nextAvailable = json.config.available_columns ?? [];
      const nextSelected = Array.from(new Set(json.config.selected_columns ?? []));

      setReportRoute(nextRoute);
      setComponentCode(String(json.config.component_code));
      setAvailableColumns(nextAvailable);
      setSelectedColumns(nextSelected);

      const drafts: Record<string, ColumnTypeDraft> = {};
      for (const [key, raw] of Object.entries(json.config.column_types ?? {})) {
        drafts[key] = parseColumnTypeDraft(raw);
      }
      setColumnTypeDrafts(drafts);
      lastSavedConfigSignatureRef.current = buildConfigSignature({
        selectedColumns: nextSelected,
        availableColumns: nextAvailable,
        columnTypeDrafts: drafts,
      });

      window.dispatchEvent(
        new CustomEvent(EDIT_COLUMNS_STATE_EVENT, {
          detail: {
            reportId,
            reportComponentId,
            availableColumns: nextAvailable,
            selectedColumns: nextSelected,
          },
        })
      );
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [configApiPath, reportComponentId, reportId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!reportRoute) {
      return;
    }
    void loadPreview(reportRoute);
  }, [loadPreview, reportRoute, searchParamsKey]);

  useEffect(() => {
    function handleColumnChange(event: Event) {
      const customEvent = event as CustomEvent<{
        reportId?: string;
        reportComponentId?: string;
        selectedColumns?: string[];
      }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportId) {
        return;
      }
      if (String(detail.reportComponentId ?? "") !== reportComponentId) {
        return;
      }
      if (!Array.isArray(detail.selectedColumns)) {
        return;
      }
      const availableKeySet = new Set(availableColumns.map((item) => item.key));
      const next = Array.from(
        new Set(
          detail.selectedColumns
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0 && availableKeySet.has(value))
        )
      );
      setSelectedColumns(next);
    }

    window.addEventListener(EDIT_COLUMNS_CHANGE_EVENT, handleColumnChange as EventListener);
    return () => {
      window.removeEventListener(EDIT_COLUMNS_CHANGE_EVENT, handleColumnChange as EventListener);
    };
  }, [availableColumns, reportComponentId, reportId]);

  const configSignature = useMemo(
    () =>
      buildConfigSignature({
        selectedColumns,
        availableColumns,
        columnTypeDrafts,
      }),
    [availableColumns, columnTypeDrafts, selectedColumns]
  );
  const isDirty = configSignature !== lastSavedConfigSignatureRef.current;

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(EDIT_COLUMNS_STATE_EVENT, {
        detail: {
          reportId,
          reportComponentId,
          availableColumns,
          selectedColumns,
          isDirty,
          isSaving: saving,
        },
      })
    );
  }, [availableColumns, isDirty, reportComponentId, reportId, saving, selectedColumns]);

  const availableByKey = useMemo(() => {
    const byKey = new Map<string, AvailableColumn>();
    for (const column of availableColumns) {
      byKey.set(column.key, column);
    }
    return byKey;
  }, [availableColumns]);

  const accessorBySelectedKey = useMemo(() => {
    const previewKeys = new Set(Object.keys(previewRows[0] ?? {}));
    const mapping = new Map<string, string>();
    for (const selectedKey of selectedColumns) {
      const parsed = parseSelectedKey(selectedKey);
      const fallback = parsed.column || selectedKey;
      const accessor = previewKeys.has(fallback) ? fallback : previewKeys.has(selectedKey) ? selectedKey : fallback;
      mapping.set(selectedKey, accessor);
    }
    return mapping;
  }, [previewRows, selectedColumns]);

  const totalsBySelectedKey = useMemo(() => {
    const totals = new Map<string, number>();
    for (const selectedKey of selectedColumns) {
      const accessor = accessorBySelectedKey.get(selectedKey) ?? selectedKey;
      let sum = 0;
      for (const row of previewRows) {
        const value = toNumber(row[accessor]);
        if (value !== null) {
          sum += value;
        }
      }
      totals.set(selectedKey, sum);
    }
    return totals;
  }, [accessorBySelectedKey, previewRows, selectedColumns]);
  const maxBySelectedKey = useMemo(() => {
    const maxes = new Map<string, number>();
    for (const selectedKey of selectedColumns) {
      const accessor = accessorBySelectedKey.get(selectedKey) ?? selectedKey;
      let max = 0;
      for (const row of previewRows) {
        const value = toNumber(row[accessor]);
        if (value !== null) {
          max = Math.max(max, value);
        }
      }
      maxes.set(selectedKey, max);
    }
    return maxes;
  }, [accessorBySelectedKey, previewRows, selectedColumns]);
  const rowFieldKeys = useMemo(() => new Set(Object.keys(previewRows[0] ?? {})), [previewRows]);

  const previewColumns = useMemo<ReportComponentTableColumn<GenericRow>[]>(() => {
    return selectedColumns.map((selectedKey) => {
      const available = availableByKey.get(selectedKey);
      const parsed = parseSelectedKey(selectedKey);
      const accessor = accessorBySelectedKey.get(selectedKey) ?? parsed.column;
      const draft =
        columnTypeDrafts[selectedKey] ?? createEmptyDraft();
      const headerLabel = toTitleCase(available?.column ?? parsed.column ?? selectedKey);

      const base: ReportComponentTableColumn<GenericRow> = {
        id: selectedKey,
        header: headerLabel,
        accessor: accessor as keyof GenericRow,
        columnType: "text",
        sortable: true,
      };

      if (draft.type === "number") {
        return {
          ...base,
          columnType: "number",
          fractionDigits: Number.isFinite(Number(draft.fraction_digits)) ? Number(draft.fraction_digits) : 2,
        };
      }

      if (draft.type === "percent") {
        return {
          ...base,
          columnType: "percent",
          fractionDigits: Number.isFinite(Number(draft.fraction_digits)) ? Number(draft.fraction_digits) : 2,
        };
      }

      if (draft.type === "threshold") {
        const gte = Number(draft.gte);
        const lte = Number(draft.lte);
        const hasGte = Number.isFinite(gte);
        const hasLte = Number.isFinite(lte);
        if (!hasGte && !hasLte) {
          return base;
        }
        const cutoff = hasGte ? gte : lte;
        return {
          ...base,
          columnType: "threshold",
          fractionDigits: Number.isFinite(Number(draft.fraction_digits)) ? Number(draft.fraction_digits) : 2,
          threshold: {
            cutoff,
            comparison: hasGte ? "gte" : "lte",
            format: draft.display === "number" ? "number" : "percent",
            fractionDigits: Number.isFinite(Number(draft.fraction_digits)) ? Number(draft.fraction_digits) : 2,
          },
        };
      }

      if (draft.type === "percentage_of_total_bar") {
        const total = totalsBySelectedKey.get(selectedKey) ?? 0;
        return {
          ...base,
          columnType: "custom",
          sortValue: (row) => toNumber(row[accessor]) ?? Number.NEGATIVE_INFINITY,
          render: (row) => {
            const value = toNumber(row[accessor]);
            if (value === null) {
              return "-";
            }
            const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
            return (
              <div className="min-w-[120px]">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span>{formatNumber(value, 2)}</span>
                  <span style={{ color: "var(--app-text-muted)" }}>{(pct * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded" style={{ backgroundColor: "var(--app-surface-muted)" }}>
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${pct * 100}%`,
                      backgroundColor: "var(--app-control-track-active)",
                    }}
                  />
                </div>
              </div>
            );
          },
        };
      }

      if (draft.type === "conditional_bar") {
        const valueSourceKey = draft.value_from || selectedKey;
        const thresholdSourceKey = draft.threshold_from || valueSourceKey;
        const parsedValueSource = parseSelectedKey(valueSourceKey);
        const parsedThresholdSource = parseSelectedKey(thresholdSourceKey);
        const valueSourceAccessor =
          accessorBySelectedKey.get(valueSourceKey) || parsedValueSource.column || accessor;
        const thresholdSourceAccessor =
          accessorBySelectedKey.get(thresholdSourceKey) || parsedThresholdSource.column || valueSourceAccessor;
        const digits = Number.isFinite(Number(draft.fraction_digits)) ? Number(draft.fraction_digits) : 2;
        const fallbackBarMax =
          draft.display === "percentage"
            ? 1
            : Math.max(maxBySelectedKey.get(valueSourceKey) ?? 0, 1);
        const configuredBarMax = Number(draft.bar_max);
        const denominator = Math.max(
          Number.isFinite(configuredBarMax) && configuredBarMax > 0 ? configuredBarMax : fallbackBarMax,
          1e-9
        );
        return {
          ...base,
          columnType: "custom",
          sortValue: (row) => toNumber(row[valueSourceAccessor]) ?? Number.NEGATIVE_INFINITY,
          render: (row) => {
            const value = toNumber(row[valueSourceAccessor]);
            if (value === null) {
              return "-";
            }
            const pct = Math.max(0, Math.min(1, value / denominator));
            const thresholdValue = toNumber(row[thresholdSourceAccessor]);
            const match = thresholdValue !== null ? matchesDraftThreshold(draft, thresholdValue) : false;
            const barColor = match
              ? resolveBarColor(draft.color)
              : resolveBarColor(draft.color_else);
            const label =
              draft.display === "number"
                ? formatNumber(value, digits)
                : `${(value * 100).toFixed(digits)}%`;
            return (
              <div className="min-w-[120px]">
                <div className="mb-1 text-xs">{label}</div>
                <div className="h-2 w-full overflow-hidden rounded" style={{ backgroundColor: "var(--app-surface-muted)" }}>
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${pct * 100}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
              </div>
            );
          },
        };
      }

      if (draft.type === "pill") {
        return {
          ...base,
          columnType: "pill",
          pill: {
            getLabel: (value) => toPillDisplayLabel(value, draft.display),
            getTone: (value) => resolvePillColorForValue(draft.colors_by_value, value),
          },
        };
      }

      return base;
    });
  }, [accessorBySelectedKey, availableByKey, columnTypeDrafts, maxBySelectedKey, selectedColumns, totalsBySelectedKey]);

  const activeColumn = useMemo(() => {
    if (!activeColumnKey) {
      return null;
    }
    const available = availableByKey.get(activeColumnKey);
    const parsed = parseSelectedKey(activeColumnKey);
    const draft =
      columnTypeDrafts[activeColumnKey] ?? createEmptyDraft();
    return {
      key: activeColumnKey,
      accessor: accessorBySelectedKey.get(activeColumnKey) ?? parsed.column ?? activeColumnKey,
      label: available ? `${available.source_schema}.${available.dataset_key}.${available.column}` : activeColumnKey,
      draft,
    };
  }, [accessorBySelectedKey, activeColumnKey, availableByKey, columnTypeDrafts]);
  const activeSourceColumns = useMemo(() => {
    if (!activeColumn) {
      return [] as Array<{ key: string; label: string }>;
    }
    return selectedColumns.map((key) => {
      const available = availableByKey.get(key);
      const parsed = parseSelectedKey(key);
      return {
        key,
        label: available ? `${available.source_schema}.${available.dataset_key}.${available.column}` : parsed.column || key,
      };
    });
  }, [activeColumn, availableByKey, selectedColumns]);

  const activePillValues = useMemo(() => {
    if (!activeColumn || activeColumn.draft.type !== "pill") {
      return [] as Array<{ key: string; label: string; count: number }>;
    }
    const counts = new Map<string, number>();
    const firstLabelByKey = new Map<string, string>();
    for (const row of previewRows) {
      const raw = row[activeColumn.accessor];
      const key = normalizePillValueKey(raw);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!firstLabelByKey.has(key)) {
        firstLabelByKey.set(key, toPillDisplayLabel(raw, activeColumn.draft.display));
      }
    }
    return Array.from(counts.entries()).map(([key, count]) => ({
      key,
      label: firstLabelByKey.get(key) ?? "(empty)",
      count,
    }));
  }, [activeColumn, previewRows]);
  const standaloneConditionalBarRows = useMemo(() => {
    if (componentMode !== "conditional_bar") {
      return [] as Array<{ key: string; label: string; valueLabel: string; widthPct: number; color: string }>;
    }

    const conditionalColumnKey =
      selectedColumns.find((key) => (columnTypeDrafts[key] ?? createEmptyDraft()).type === "conditional_bar") ??
      selectedColumns[0] ??
      null;
    if (!conditionalColumnKey) {
      return [] as Array<{ key: string; label: string; valueLabel: string; widthPct: number; color: string }>;
    }

    const draft = columnTypeDrafts[conditionalColumnKey] ?? createEmptyDraft();
    const valueSourceKey = draft.value_from || conditionalColumnKey;
    const thresholdSourceKey = draft.threshold_from || valueSourceKey;
    const labelSourceKey = draft.label_from || "sis_user_id";
    const thresholdField = resolveFieldKey({
      preferred:
        accessorBySelectedKey.get(thresholdSourceKey) || parseSelectedKey(thresholdSourceKey).column || conditionalColumnKey,
      availableKeys: rowFieldKeys,
      fallback: conditionalColumnKey,
    });
    const labelField = resolveFieldKey({
      preferred: accessorBySelectedKey.get(labelSourceKey) || parseSelectedKey(labelSourceKey).column || labelSourceKey,
      availableKeys: rowFieldKeys,
      fallback: "sis_user_id",
    });

    return previewRows
      .map((row, index) => {
        const matchedCondition = evaluateDraftCondition(draft, row, (field) => {
          return accessorBySelectedKey.get(field) || parseSelectedKey(field).column || field;
        });
        if (matchedCondition && !matchedCondition.include) {
          return null;
        }
        const thresholdValue = toNumber(row[thresholdField]);
        const thresholdMatch = thresholdValue !== null ? matchesDraftThreshold(draft, thresholdValue) : false;
        const color = matchedCondition?.color
          ? resolveBarColor(matchedCondition.color)
          : (thresholdMatch
              ? resolveBarColor(draft.color)
              : resolveBarColor(draft.color_else));
        const rawLabel = row[labelField];
        const label = String(rawLabel ?? row.sis_user_id ?? `row-${index + 1}`).trim() || `row-${index + 1}`;
        return {
          key: rowKey(row, index),
          label,
          valueLabel: "",
          widthPct: 100,
          color,
          order: index,
          conditionOrder: matchedCondition?.conditionIndex ?? draft.conditions.length,
        };
      })
      .filter(
        (
          row
        ): row is {
          key: string;
          label: string;
          valueLabel: string;
          widthPct: number;
          color: string;
          order: number;
          conditionOrder: number;
        } => row !== null
      )
      .sort((a, b) => {
        if (a.conditionOrder !== b.conditionOrder) {
          return a.conditionOrder - b.conditionOrder;
        }
        return a.order - b.order;
      })
      .map(({ order, conditionOrder, ...rest }) => rest);
  }, [accessorBySelectedKey, columnTypeDrafts, componentMode, previewRows, rowFieldKeys, selectedColumns]);
  const standaloneConditionalBarSegments = useMemo(() => {
    return standaloneConditionalBarRows.map((row) => ({
      key: row.key,
      color: row.color,
      title: `${row.label}: ${row.valueLabel}`,
    }));
  }, [standaloneConditionalBarRows]);
  const configuredConditionalColumnKey = useMemo(() => {
    if (componentMode !== "conditional_bar") {
      return null;
    }
    return selectedColumns.find((key) => (columnTypeDrafts[key] ?? createEmptyDraft()).type === "conditional_bar")
      ?? selectedColumns[0]
      ?? null;
  }, [columnTypeDrafts, componentMode, selectedColumns]);
  const configuredConditionalDraft = useMemo(() => {
    if (!configuredConditionalColumnKey) {
      return null;
    }
    return columnTypeDrafts[configuredConditionalColumnKey] ?? createEmptyDraft();
  }, [columnTypeDrafts, configuredConditionalColumnKey]);
  const groupedConditionItems = useMemo(() => {
    const conditions = configuredConditionalDraft?.conditions ?? [];
    const includeItems = conditions
      .map((condition, index) => ({ condition, index }))
      .filter((item) => item.condition.include);
    const excludeItems = conditions
      .map((condition, index) => ({ condition, index }))
      .filter((item) => !item.condition.include);
    return { includeItems, excludeItems };
  }, [configuredConditionalDraft]);
  const conditionSourceColumns = useMemo(() => {
    if (!configuredConditionalColumnKey) {
      return [] as Array<{ key: string; label: string }>;
    }
    return selectedColumns.map((key) => {
      const available = availableByKey.get(key);
      const parsed = parseSelectedKey(key);
      return {
        key,
        label: available ? `${available.source_schema}.${available.dataset_key}.${available.column}` : parsed.column || key,
      };
    });
  }, [availableByKey, configuredConditionalColumnKey, selectedColumns]);
  const activeConditionDraft = useMemo(() => {
    if (!configuredConditionalDraft || activeConditionIndex === null) {
      return null;
    }
    return configuredConditionalDraft.conditions[activeConditionIndex] ?? null;
  }, [activeConditionIndex, configuredConditionalDraft]);
  const conditionValueOptionsByField = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const source of conditionSourceColumns) {
      const accessor = accessorBySelectedKey.get(source.key) || parseSelectedKey(source.key).column || source.key;
      const unique = new Set<string>();
      for (const row of previewRows) {
        unique.add(normalizeConditionPickValue(row[accessor]));
      }
      map.set(source.key, Array.from(unique).sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, [accessorBySelectedKey, conditionSourceColumns, previewRows]);

  function updateDraft(key: string, update: Partial<ColumnTypeDraft>) {
    setColumnTypeDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? createEmptyDraft()),
        ...update,
      },
    }));
  }

  function addConditionRule(columnKey: string) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      const sourceField = existing.threshold_from || existing.value_from || columnKey;
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions: [
            {
              include: true,
              color: "darkGray",
              clauses: [{ field: sourceField, op: "eq", value: "true" }],
            },
            ...(existing.conditions ?? []),
          ],
        },
      };
    });
  }

  function removeConditionRule(columnKey: string, ruleIndex: number) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions: (existing.conditions ?? []).filter((_, index) => index !== ruleIndex),
        },
      };
    });
  }

  function reorderConditionRules(columnKey: string, sourceIndex: number, targetIndex: number) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      const conditions = [...(existing.conditions ?? [])];
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        sourceIndex >= conditions.length ||
        targetIndex >= conditions.length ||
        sourceIndex === targetIndex
      ) {
        return current;
      }
      const [moved] = conditions.splice(sourceIndex, 1);
      conditions.splice(targetIndex, 0, moved);
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions,
        },
      };
    });
  }

  function updateConditionRule(columnKey: string, ruleIndex: number, update: Partial<ConditionalRuleDraft>) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      const nextConditions = [...(existing.conditions ?? [])];
      const rule = nextConditions[ruleIndex];
      if (!rule) {
        return current;
      }
      nextConditions[ruleIndex] = {
        ...rule,
        ...update,
      };
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions: nextConditions,
        },
      };
    });
  }

  function addConditionClause(columnKey: string, ruleIndex: number) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      const nextConditions = [...(existing.conditions ?? [])];
      const rule = nextConditions[ruleIndex];
      if (!rule) {
        return current;
      }
      const sourceField = existing.threshold_from || existing.value_from || columnKey;
      nextConditions[ruleIndex] = {
        ...rule,
        clauses: [...rule.clauses, { field: sourceField, op: "eq", value: "true" }],
      };
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions: nextConditions,
        },
      };
    });
  }

  function updateConditionClause(
    columnKey: string,
    ruleIndex: number,
    clauseIndex: number,
    update: Partial<ConditionalClauseDraft>
  ) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      const nextConditions = [...(existing.conditions ?? [])];
      const rule = nextConditions[ruleIndex];
      if (!rule) {
        return current;
      }
      const nextClauses = [...rule.clauses];
      const clause = nextClauses[clauseIndex];
      if (!clause) {
        return current;
      }
      nextClauses[clauseIndex] = {
        ...clause,
        ...update,
      };
      nextConditions[ruleIndex] = {
        ...rule,
        clauses: nextClauses,
      };
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions: nextConditions,
        },
      };
    });
  }

  function removeConditionClause(columnKey: string, ruleIndex: number, clauseIndex: number) {
    setColumnTypeDrafts((current) => {
      const existing = normalizeConditionalBarDraft(current[columnKey] ?? createEmptyDraft());
      const nextConditions = [...(existing.conditions ?? [])];
      const rule = nextConditions[ruleIndex];
      if (!rule || rule.clauses.length <= 1) {
        return current;
      }
      nextConditions[ruleIndex] = {
        ...rule,
        clauses: rule.clauses.filter((_, index) => index !== clauseIndex),
      };
      return {
        ...current,
        [columnKey]: {
          ...existing,
          conditions: nextConditions,
        },
      };
    });
  }

  function updatePillValueColor(columnKey: string, valueKey: string, color: string) {
    setColumnTypeDrafts((current) => {
      const existing = current[columnKey] ?? createEmptyDraft();
      const nextMap = { ...(existing.colors_by_value ?? {}) };
      if (color) {
        nextMap[valueKey] = color;
      } else {
        delete nextMap[valueKey];
      }
      return {
        ...current,
        [columnKey]: {
          ...existing,
          colors_by_value: nextMap,
        },
      };
    });
  }

  function reorderSelectedColumns(sourceColumnId: string, targetColumnId: string) {
    setSelectedColumns((current) => {
      const sourceIndex = current.indexOf(sourceColumnId);
      const targetIndex = current.indexOf(targetColumnId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const availableKeySet = new Set(availableColumns.map((item) => item.key));
      const filteredSelected = selectedColumns.filter((key) => availableKeySet.has(key));
      const columnTypes = buildColumnTypesPayload({
        selectedColumns: filteredSelected,
        availableColumns,
        columnTypeDrafts,
      });

      const res = await fetch(
        `${configApiPath}?report_id=${encodeURIComponent(reportId)}&report_component_id=${encodeURIComponent(reportComponentId)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selected_columns: filteredSelected,
            column_types: columnTypes,
          }),
        }
      );

      const json = (await res.json()) as TableConfigResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Save failed");
      }

      lastSavedConfigSignatureRef.current = buildConfigSignature({
        selectedColumns: filteredSelected,
        availableColumns,
        columnTypeDrafts,
      });
      setSaveMessage("Saved.");
      await loadConfig();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [availableColumns, columnTypeDrafts, configApiPath, loadConfig, reportComponentId, reportId, selectedColumns]);

  useEffect(() => {
    function onSaveRequest(event: Event) {
      const customEvent = event as CustomEvent<{
        reportId?: string;
        reportComponentId?: string;
      }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportId) {
        return;
      }
      if (String(detail.reportComponentId ?? "") !== reportComponentId) {
        return;
      }
      void save();
    }

    window.addEventListener(EDIT_COMPONENT_SAVE_REQUEST_EVENT, onSaveRequest as EventListener);
    return () => {
      window.removeEventListener(EDIT_COMPONENT_SAVE_REQUEST_EVENT, onSaveRequest as EventListener);
    };
  }, [reportComponentId, reportId, save]);

  useEffect(() => {
    function onResetRequest(event: Event) {
      const customEvent = event as CustomEvent<{
        reportId?: string;
        reportComponentId?: string;
      }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportId) {
        return;
      }
      if (String(detail.reportComponentId ?? "") !== reportComponentId) {
        return;
      }
      setActiveColumnKey(null);
      setActiveConditionIndex(null);
      setSaveMessage(null);
      setError(null);
      void loadConfig();
    }

    window.addEventListener(EDIT_COMPONENT_RESET_REQUEST_EVENT, onResetRequest as EventListener);
    return () => {
      window.removeEventListener(EDIT_COMPONENT_RESET_REQUEST_EVENT, onResetRequest as EventListener);
    };
  }, [loadConfig, reportComponentId, reportId]);

  const defaultSortColumnId = previewColumns[0]?.id ?? "id";

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <ReportHeader title={`Edit Report: ${toTitleCase(reportRoute || reportId)}`} description={null} />
        <Link
          href={reportRoute ? `/reports/${reportRoute}` : "/reports"}
          className="rounded border px-3 py-1 text-sm"
          style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
        >
          Back To Report
        </Link>
      </div>

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      <ReportContainer className="mt-5">
        <div className="mb-3 text-sm" style={{ color: "var(--app-text-muted)" }}>
          Report ID: {reportId || "-"} | Report Component ID: {reportComponentId || "-"} | Component: {componentCode}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            {componentMode === "conditional_bar"
              ? "Conditional bar preview mirrors runtime rendering. Choose a column below to edit settings."
              : 'Drag headers left/right to reorder columns. Columns are managed in the sidebar "Columns" tab. Click "Edit" on a header to configure that column.'}
          </div>
        </div>

        {saveMessage && (
          <div className="mb-3 text-sm" style={{ color: "var(--app-success, #166534)" }}>
            {saveMessage}
          </div>
        )}

        {(loading || loadingPreview) && (
          <div className="mb-3 text-sm" style={{ color: "var(--app-text-muted)" }}>
            Loading preview...
          </div>
        )}

        {previewColumns.length === 0 && !loading && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No columns selected. Use sidebar "Columns" to add at least one.
          </div>
        )}

        {componentMode === "conditional_bar" && (
          <ReportComponentConditionalBar segments={standaloneConditionalBarSegments} />
        )}

        {componentMode === "conditional_bar" && configuredConditionalColumnKey && configuredConditionalDraft && (
          <div className="mt-4 rounded border p-3" style={{ borderColor: "var(--app-border)" }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Conditions</h3>
              <button
                type="button"
                onClick={() => {
                  addConditionRule(configuredConditionalColumnKey);
                  setActiveColumnKey(null);
                  setActiveConditionIndex(0);
                }}
                className="h-7 w-7 rounded border text-sm font-semibold"
                style={{
                  borderColor: "var(--app-border)",
                  color: "var(--app-text-strong)",
                  backgroundColor: "var(--app-surface)",
                }}
                aria-label="Add condition"
                title="Add condition"
              >
                +
              </button>
            </div>

            {configuredConditionalDraft.conditions.length === 0 && (
              <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
                No conditions configured.
              </div>
            )}

            {configuredConditionalDraft.conditions.length > 0 && (
              <div className="space-y-2">
                <div>
                  <div className="mb-1 text-xs font-semibold" style={{ color: "var(--app-text-muted)" }}>
                    Include
                  </div>
                  <div className="space-y-2">
                    {groupedConditionItems.includeItems.map(({ condition, index }) => (
                      <div
                        key={`cond-list-include-${index}`}
                        className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                        style={{ borderColor: "var(--app-border)" }}
                        draggable
                        onDragStart={() => setDragConditionIndex(index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragConditionIndex === null) {
                            return;
                          }
                          const dragCondition = configuredConditionalDraft.conditions[dragConditionIndex];
                          if (!dragCondition || dragCondition.include !== condition.include) {
                            setDragConditionIndex(null);
                            return;
                          }
                          reorderConditionRules(configuredConditionalColumnKey, dragConditionIndex, index);
                          setDragConditionIndex(null);
                        }}
                        onDragEnd={() => setDragConditionIndex(null)}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="inline-block h-3.5 w-3.5 flex-shrink-0 rounded-sm border"
                            style={{
                              borderColor: "var(--app-border)",
                              backgroundColor: resolveBarColor(condition.color),
                            }}
                            title={`resolved: ${resolveBarColor(condition.color)}`}
                            aria-hidden
                          />
                          <span
                            className="inline-flex flex-shrink-0 rounded border px-1 py-0.5 font-mono text-[10px]"
                            style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                            title={`raw color: ${condition.color}`}
                          >
                            {condition.color}
                          </span>
                          <div className="truncate text-sm" title={formatConditionName({ condition, availableByKey })}>
                            {formatConditionName({ condition, availableByKey })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <EditAction
                            onClick={() => {
                              setActiveColumnKey(null);
                              setActiveConditionIndex(index);
                            }}
                            ariaLabel={`Edit condition ${index + 1}`}
                            title={`Edit condition ${index + 1}`}
                            className="h-6 w-6 text-[11px]"
                            style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                            iconSize={11}
                          />
                          <button
                            type="button"
                            onClick={() => removeConditionRule(configuredConditionalColumnKey, index)}
                            className="h-6 w-6 rounded border text-[11px]"
                            style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                            aria-label={`Delete condition ${index + 1}`}
                            title={`Delete condition ${index + 1}`}
                          >
                            X
                          </button>
                        </div>
                      </div>
                    ))}
                    {groupedConditionItems.includeItems.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        No include conditions.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold" style={{ color: "var(--app-text-muted)" }}>
                    Exclude
                  </div>
                  <div className="space-y-2">
                    {groupedConditionItems.excludeItems.map(({ condition, index }) => (
                      <div
                        key={`cond-list-exclude-${index}`}
                        className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                        style={{ borderColor: "var(--app-border)" }}
                        draggable
                        onDragStart={() => setDragConditionIndex(index)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragConditionIndex === null) {
                            return;
                          }
                          const dragCondition = configuredConditionalDraft.conditions[dragConditionIndex];
                          if (!dragCondition || dragCondition.include !== condition.include) {
                            setDragConditionIndex(null);
                            return;
                          }
                          reorderConditionRules(configuredConditionalColumnKey, dragConditionIndex, index);
                          setDragConditionIndex(null);
                        }}
                        onDragEnd={() => setDragConditionIndex(null)}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-block h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                          <span
                            className="inline-flex flex-shrink-0 rounded border px-1 py-0.5 font-mono text-[10px]"
                            style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                            title={`raw color: ${condition.color}`}
                          >
                            {condition.color}
                          </span>
                          <div className="truncate text-sm" title={formatConditionName({ condition, availableByKey })}>
                            {formatConditionName({ condition, availableByKey })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <EditAction
                            onClick={() => {
                              setActiveColumnKey(null);
                              setActiveConditionIndex(index);
                            }}
                            ariaLabel={`Edit condition ${index + 1}`}
                            title={`Edit condition ${index + 1}`}
                            className="h-6 w-6 text-[11px]"
                            style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                            iconSize={11}
                          />
                          <button
                            type="button"
                            onClick={() => removeConditionRule(configuredConditionalColumnKey, index)}
                            className="h-6 w-6 rounded border text-[11px]"
                            style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                            aria-label={`Delete condition ${index + 1}`}
                            title={`Delete condition ${index + 1}`}
                          >
                            X
                          </button>
                        </div>
                      </div>
                    ))}
                    {groupedConditionItems.excludeItems.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        No exclude conditions.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {componentMode !== "conditional_bar" && previewColumns.length > 0 && (
          <ReportComponentTable
            rows={previewRows}
            columns={previewColumns}
            defaultSort={{ columnId: defaultSortColumnId, direction: "asc" }}
            rowKey={rowKey}
            emptyText="No rows found for current filters, but selected columns are shown."
            showHeaderWhenEmpty
            allowColumnReorder
            onColumnReorder={reorderSelectedColumns}
            headerAction={(column) => (
              <EditAction
                onClick={() => setActiveColumnKey(String(column.id))}
                ariaLabel={`Edit ${column.header}`}
                title={`Edit ${column.header}`}
                className="h-6 w-6 text-[11px]"
                style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                iconSize={11}
              />
            )}
          />
        )}
      </ReportContainer>

      {activeColumn && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ backgroundColor: "var(--app-overlay)" }}>
          <div
            className="w-full max-w-xl rounded border p-4"
            style={{
              borderColor: "var(--app-border)",
              backgroundColor: "var(--app-surface)",
              color: "var(--app-text-strong)",
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {componentMode === "conditional_bar" ? "Edit Bar Settings" : "Edit Column Settings"}
                </h2>
                <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                  {activeColumn.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveColumnKey(null);
                  setActiveConditionIndex(null);
                }}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                <span>Type</span>
                <select
                  value={activeColumn.draft.type}
                  onChange={(event) => {
                    const nextType = event.target.value as ColumnTypeDraft["type"];
                    const nextUpdate: Partial<ColumnTypeDraft> = { type: nextType };
                    if (nextType === "pill") {
                      nextUpdate.display =
                        activeColumn.draft.display === "raw" || activeColumn.draft.display === "title_case"
                          ? activeColumn.draft.display
                          : "raw";
                    }
                    if (nextType === "threshold") {
                      nextUpdate.display =
                        activeColumn.draft.display === "number" || activeColumn.draft.display === "percentage"
                          ? activeColumn.draft.display
                          : "percentage";
                    }
                    if (nextType === "conditional_bar") {
                      nextUpdate.display =
                        activeColumn.draft.display === "number" || activeColumn.draft.display === "percentage"
                          ? activeColumn.draft.display
                          : "percentage";
                    }
                    updateDraft(activeColumn.key, nextUpdate);
                  }}
                  className="rounded border px-2 py-1"
                  style={{
                    borderColor: "var(--app-border)",
                    backgroundColor: "var(--app-surface)",
                    color: "var(--app-text-strong)",
                  }}
                >
                  <option value="">Default</option>
                  <option value="threshold">Threshold</option>
                  <option value="percentage_of_total_bar">Percentage Of Total Bar</option>
                  {componentMode === "conditional_bar" && <option value="conditional_bar">Conditional Bar</option>}
                  <option value="number">Number</option>
                  <option value="percent">Percent</option>
                  <option value="text">Text</option>
                  <option value="pill">Pill</option>
                </select>
              </label>

              {activeColumn.draft.type === "threshold" && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <input
                    value={activeColumn.draft.gte}
                    onChange={(event) => updateDraft(activeColumn.key, { gte: event.target.value })}
                    placeholder="gte (e.g. 0.9)"
                    className="rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text-strong)",
                    }}
                  />
                  <input
                    value={activeColumn.draft.lte}
                    onChange={(event) => updateDraft(activeColumn.key, { lte: event.target.value })}
                    placeholder="lte (optional)"
                    className="rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text-strong)",
                    }}
                  />
                  <select
                    value={activeColumn.draft.display}
                    onChange={(event) =>
                      updateDraft(activeColumn.key, {
                        display: event.target.value === "number" ? "number" : "percentage",
                      })
                    }
                    className="rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text-strong)",
                    }}
                  >
                    <option value="percentage">Display: Percentage</option>
                    <option value="number">Display: Number</option>
                  </select>
                  <input
                    value={activeColumn.draft.fraction_digits}
                    onChange={(event) => updateDraft(activeColumn.key, { fraction_digits: event.target.value })}
                    placeholder="fraction digits"
                    className="rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text-strong)",
                    }}
                  />
                </div>
              )}

              {activeColumn.draft.type === "conditional_bar" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    <input
                      value={activeColumn.draft.gte}
                      onChange={(event) => updateDraft(activeColumn.key, { gte: event.target.value })}
                      placeholder="gte (e.g. 0.9)"
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    />
                    <input
                      value={activeColumn.draft.lte}
                      onChange={(event) => updateDraft(activeColumn.key, { lte: event.target.value })}
                      placeholder="lte (optional)"
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    />
                    <select
                      value={activeColumn.draft.display}
                      onChange={(event) =>
                        updateDraft(activeColumn.key, {
                          display: event.target.value === "number" ? "number" : "percentage",
                        })
                      }
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    >
                      <option value="percentage">Display: Percentage</option>
                      <option value="number">Display: Number</option>
                    </select>
                    <input
                      value={activeColumn.draft.fraction_digits}
                      onChange={(event) => updateDraft(activeColumn.key, { fraction_digits: event.target.value })}
                      placeholder="fraction digits"
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <select
                      value={activeColumn.draft.value_from || activeColumn.key}
                      onChange={(event) =>
                        updateDraft(activeColumn.key, {
                          value_from: event.target.value === activeColumn.key ? "" : event.target.value,
                        })
                      }
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    >
                      {activeSourceColumns.map((source) => (
                        <option key={`value-from-${source.key}`} value={source.key}>
                          Value From: {source.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={activeColumn.draft.threshold_from || activeColumn.draft.value_from || activeColumn.key}
                      onChange={(event) =>
                        updateDraft(activeColumn.key, {
                          threshold_from:
                            event.target.value === (activeColumn.draft.value_from || activeColumn.key)
                              ? ""
                              : event.target.value,
                        })
                      }
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    >
                      {activeSourceColumns.map((source) => (
                        <option key={`threshold-from-${source.key}`} value={source.key}>
                          Threshold From: {source.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={activeColumn.draft.label_from || activeColumn.key}
                      onChange={(event) =>
                        updateDraft(activeColumn.key, {
                          label_from: event.target.value === activeColumn.key ? "" : event.target.value,
                        })
                      }
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    >
                      {activeSourceColumns.map((source) => (
                        <option key={`label-from-${source.key}`} value={source.key}>
                          Label From: {source.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <input
                      value={activeColumn.draft.bar_max}
                      onChange={(event) => updateDraft(activeColumn.key, { bar_max: event.target.value })}
                      placeholder="bar max (optional)"
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    />
                    <ColorSelectionDropdown
                      value={activeColumn.draft.color}
                      onChange={(nextValue) => updateDraft(activeColumn.key, { color: nextValue })}
                      groups={BASE_COLOR_GROUPS}                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    />
                    <ColorSelectionDropdown
                      value={activeColumn.draft.color_else}
                      onChange={(nextValue) => updateDraft(activeColumn.key, { color_else: nextValue })}
                      groups={BASE_COLOR_GROUPS}                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    />
                  </div>

                  <div className="rounded border p-2" style={{ borderColor: "var(--app-border)" }}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-medium" style={{ color: "var(--app-text-muted)" }}>
                        Row Conditions (first match wins)
                      </div>
                      <button
                        type="button"
                        onClick={() => addConditionRule(activeColumn.key)}
                        className="rounded border px-2 py-1 text-xs"
                        style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                      >
                        Add Condition
                      </button>
                    </div>

                    {activeColumn.draft.conditions.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        No conditions yet. Unmatched rows use Else Color.
                      </div>
                    )}

                    {activeColumn.draft.conditions.length > 0 && (
                      <div className="space-y-2">
                        {activeColumn.draft.conditions.map((condition, ruleIndex) => (
                          <div
                            key={`rule-${ruleIndex}`}
                            className="rounded border p-2"
                            style={{ borderColor: "var(--app-border)" }}
                          >
                            <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-[140px_1fr_auto]">
                              <select
                                value={condition.include ? "include" : "exclude"}
                                onChange={(event) =>
                                  updateConditionRule(activeColumn.key, ruleIndex, {
                                    include: event.target.value !== "exclude",
                                  })
                                }
                                className="rounded border px-2 py-1 text-xs"
                                style={{
                                  borderColor: "var(--app-border)",
                                  backgroundColor: "var(--app-surface)",
                                  color: "var(--app-text-strong)",
                                }}
                              >
                                <option value="include">Include Match</option>
                                <option value="exclude">Exclude Match</option>
                              </select>
                              <ColorSelectionDropdown
                                value={condition.color}
                                onChange={(nextValue) =>
                                  updateConditionRule(activeColumn.key, ruleIndex, { color: nextValue })
                                }
                                disabled={!condition.include}
                                groups={BASE_COLOR_GROUPS}                                className="rounded border px-2 py-1 text-xs disabled:opacity-60"
                                style={{
                                  borderColor: "var(--app-border)",
                                  backgroundColor: "var(--app-surface)",
                                  color: "var(--app-text-strong)",
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => removeConditionRule(activeColumn.key, ruleIndex)}
                                className="rounded border px-2 py-1 text-xs"
                                style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                              >
                                Remove
                              </button>
                            </div>

                            <div className="space-y-2">
                              {condition.clauses.map((clause, clauseIndex) => (
                                <div
                                  key={`rule-${ruleIndex}-clause-${clauseIndex}`}
                                  className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_88px_1fr_auto]"
                                >
                                  <select
                                    value={clause.field}
                                    onChange={(event) =>
                                      updateConditionClause(activeColumn.key, ruleIndex, clauseIndex, {
                                        field: event.target.value,
                                      })
                                    }
                                    className="rounded border px-2 py-1 text-xs"
                                    style={{
                                      borderColor: "var(--app-border)",
                                      backgroundColor: "var(--app-surface)",
                                      color: "var(--app-text-strong)",
                                    }}
                                  >
                                    {activeSourceColumns.map((source) => (
                                      <option key={`cond-field-${ruleIndex}-${clauseIndex}-${source.key}`} value={source.key}>
                                        Field: {source.label}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={clause.op}
                                    onChange={(event) =>
                                      updateConditionClause(activeColumn.key, ruleIndex, clauseIndex, {
                                        op: event.target.value === "neq" ? "neq" : "eq",
                                      })
                                    }
                                    className="rounded border px-2 py-1 text-xs"
                                    style={{
                                      borderColor: "var(--app-border)",
                                      backgroundColor: "var(--app-surface)",
                                      color: "var(--app-text-strong)",
                                    }}
                                  >
                                    <option value="eq">=</option>
                                    <option value="neq">!=</option>
                                  </select>
                                  <input
                                    value={clause.value}
                                    onChange={(event) =>
                                      updateConditionClause(activeColumn.key, ruleIndex, clauseIndex, {
                                        value: event.target.value,
                                      })
                                    }
                                    placeholder="value (e.g. true)"
                                    className="rounded border px-2 py-1 text-xs"
                                    style={{
                                      borderColor: "var(--app-border)",
                                      backgroundColor: "var(--app-surface)",
                                      color: "var(--app-text-strong)",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeConditionClause(activeColumn.key, ruleIndex, clauseIndex)}
                                    className="rounded border px-2 py-1 text-xs"
                                    style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>

                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => addConditionClause(activeColumn.key, ruleIndex)}
                                className="rounded border px-2 py-1 text-xs"
                                style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                              >
                                Add AND Clause
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeColumn.draft.type === "pill" && (
                <div className="space-y-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span>Display</span>
                    <select
                      value={activeColumn.draft.display === "title_case" ? "title_case" : "raw"}
                      onChange={(event) =>
                        updateDraft(activeColumn.key, {
                          display: event.target.value === "title_case" ? "title_case" : "raw",
                        })
                      }
                      className="rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    >
                      <option value="raw">Display: Raw Value</option>
                      <option value="title_case">Display: Title Case</option>
                    </select>
                  </label>

                  <div className="rounded border p-2" style={{ borderColor: "var(--app-border)" }}>
                    <div className="mb-2 text-xs font-medium" style={{ color: "var(--app-text-muted)" }}>
                      Value Color Mapping
                    </div>

                    {activePillValues.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        No values found in preview rows for this column.
                      </div>
                    )}

                    {activePillValues.length > 0 && (
                      <div className="max-h-64 space-y-2 overflow-auto pr-1">
                        {activePillValues.map((value) => (
                          <div
                            key={value.key || "__empty__"}
                            className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_180px]"
                          >
                            <div className="text-sm" style={{ color: "var(--app-text-strong)" }}>
                              <span>{value.label}</span>
                              <span className="ml-2 text-xs" style={{ color: "var(--app-text-muted)" }}>
                                ({value.count})
                              </span>
                            </div>
                            <ColorSelectionDropdown
                              value={activeColumn.draft.colors_by_value[value.key] ?? ""}
                              onChange={(nextValue) => updatePillValueColor(activeColumn.key, value.key, nextValue)}
                              groups={PILL_COLOR_GROUPS}
                              includeDefaultOption
                              defaultOptionLabel="Default (Neutral)"
                              className="rounded border px-2 py-1 text-sm"
                              style={{
                                borderColor: "var(--app-border)",
                                backgroundColor: "var(--app-surface)",
                                color: "var(--app-text-strong)",
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {configuredConditionalColumnKey && activeConditionIndex !== null && activeConditionDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "var(--app-overlay)" }}>
          <div
            className="w-full max-w-2xl rounded border p-4"
            style={{
              borderColor: "var(--app-border)",
              backgroundColor: "var(--app-surface)",
              color: "var(--app-text-strong)",
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Edit Condition</h2>
                <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                  Condition {activeConditionIndex + 1}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveConditionIndex(null)}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
              >
                Close
              </button>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[160px_1fr]">
                <select
                  value={activeConditionDraft.include ? "include" : "exclude"}
                  onChange={(event) =>
                    updateConditionRule(configuredConditionalColumnKey, activeConditionIndex, {
                      include: event.target.value !== "exclude",
                    })
                  }
                  className="rounded border px-2 py-1 text-sm"
                  style={{
                    borderColor: "var(--app-border)",
                    backgroundColor: "var(--app-surface)",
                    color: "var(--app-text-strong)",
                  }}
                >
                  <option value="include">Include Match</option>
                  <option value="exclude">Exclude Match</option>
                </select>
                <ColorSelectionDropdown
                  value={activeConditionDraft.color}
                  onChange={(nextValue) =>
                    updateConditionRule(configuredConditionalColumnKey, activeConditionIndex, { color: nextValue })
                  }
                  disabled={!activeConditionDraft.include}
                  groups={BASE_COLOR_GROUPS}                  className="rounded border px-2 py-1 text-sm disabled:opacity-60"
                  style={{
                    borderColor: "var(--app-border)",
                    backgroundColor: "var(--app-surface)",
                    color: "var(--app-text-strong)",
                  }}
                />
              </div>

              {activeConditionDraft.clauses.map((clause, clauseIndex) => (
                <div key={`cond-modal-clause-${clauseIndex}`} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_88px_1fr_auto]">
                  <select
                    value={clause.field}
                    onChange={(event) =>
                      updateConditionClause(configuredConditionalColumnKey, activeConditionIndex, clauseIndex, {
                        field: event.target.value,
                      })
                    }
                    className="rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text-strong)",
                    }}
                  >
                    {conditionSourceColumns.map((source) => (
                      <option key={`cond-modal-field-${clauseIndex}-${source.key}`} value={source.key}>
                        Column: {source.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={clause.op}
                    onChange={(event) =>
                      updateConditionClause(configuredConditionalColumnKey, activeConditionIndex, clauseIndex, {
                        op: event.target.value === "neq" ? "neq" : "eq",
                      })
                    }
                    className="rounded border px-2 py-1 text-sm"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text-strong)",
                    }}
                  >
                    <option value="eq">=</option>
                    <option value="neq">!=</option>
                  </select>
                  <div className="space-y-1">
                    <select
                      value={
                        (conditionValueOptionsByField.get(clause.field) ?? []).includes(clause.value)
                          ? clause.value
                          : "__custom__"
                      }
                      onChange={(event) => {
                        if (event.target.value === "__custom__") {
                          return;
                        }
                        updateConditionClause(configuredConditionalColumnKey, activeConditionIndex, clauseIndex, {
                          value: event.target.value,
                        });
                      }}
                      className="w-full rounded border px-2 py-1 text-sm"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                        color: "var(--app-text-strong)",
                      }}
                    >
                      {(conditionValueOptionsByField.get(clause.field) ?? []).map((valueOption) => (
                        <option key={`cond-modal-value-${clauseIndex}-${valueOption || "__empty__"}`} value={valueOption}>
                          Value: {valueOption || "(empty)"}
                        </option>
                      ))}
                      <option value="__custom__">Value: Custom...</option>
                    </select>
                    {!(conditionValueOptionsByField.get(clause.field) ?? []).includes(clause.value) && (
                      <input
                        value={clause.value}
                        onChange={(event) =>
                          updateConditionClause(configuredConditionalColumnKey, activeConditionIndex, clauseIndex, {
                            value: event.target.value,
                          })
                        }
                        placeholder="custom value"
                        className="w-full rounded border px-2 py-1 text-sm"
                        style={{
                          borderColor: "var(--app-border)",
                          backgroundColor: "var(--app-surface)",
                          color: "var(--app-text-strong)",
                        }}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeConditionClause(configuredConditionalColumnKey, activeConditionIndex, clauseIndex)}
                    className="rounded border px-2 py-1 text-sm"
                    style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                  >
                    X
                  </button>
                </div>
              ))}

              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => addConditionClause(configuredConditionalColumnKey, activeConditionIndex)}
                  className="rounded border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                >
                  + Add AND Clause
                </button>
                <button
                  type="button"
                  onClick={() => setActiveConditionIndex(null)}
                  className="rounded border px-3 py-1 text-sm"
                  style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





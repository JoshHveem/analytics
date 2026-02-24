"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CenteredModal } from "@/app/_components/CenteredModal";
import { APP_COLORS } from "@/lib/color-palette";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { EditAction } from "../_components/EditAction";
import ColorSelectionDropdown, { BASE_COLOR_GROUPS } from "../_components/ColorSelectionDropdown";
import { DragHandleIcon } from "../_components/DragHandleIcon";
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
  op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
  value: string;
  value_field: string;
};

type ConditionalRuleDraft = {
  include: boolean;
  color: string;
  clauses: ConditionalClauseDraft[];
};

type ConditionalBarDraft = {
  type: "conditional_bar";
  gte: string;
  lte: string;
  display: "percentage" | "number";
  fraction_digits: string;
  color: string;
  color_else: string;
  bar_max: string;
  value_from: string;
  threshold_from: string;
  label_from: string;
  conditions: ConditionalRuleDraft[];
};

type GenericRow = Record<string, unknown>;
type ConditionFieldInputType = "text" | "number" | "boolean";

type ConditionalBarConfigResponse = {
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

type ConditionalBarDataResponse = {
  ok: boolean;
  data?: GenericRow[];
  error?: string;
};

const EDIT_COLUMNS_STATE_EVENT = "analytics:report-component-edit-state";
const EDIT_COLUMNS_CHANGE_EVENT = "analytics:report-component-edit-columns-change";
const EDIT_COMPONENT_SAVE_REQUEST_EVENT = "analytics:report-component-edit-save-request";
const EDIT_COMPONENT_RESET_REQUEST_EVENT = "analytics:report-component-edit-reset-request";
const RESERVED_QUERY_KEYS = new Set(["route", "include_meta", "include_rows", "anonymize"]);

function createEmptyDraft(): ConditionalBarDraft {
  return {
    type: "conditional_bar",
    gte: "",
    lte: "",
    display: "percentage",
    fraction_digits: "",
    color: "green",
    color_else: "darkGray",
    bar_max: "",
    value_from: "",
    threshold_from: "",
    label_from: "",
    conditions: [],
  };
}

function sortConditionsByGroup(conditions: ConditionalRuleDraft[]): ConditionalRuleDraft[] {
  const includeConditions = conditions.filter((condition) => condition.include !== false);
  const excludeConditions = conditions.filter((condition) => condition.include === false);
  return [...includeConditions, ...excludeConditions];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseConditionOperator(raw: unknown): ConditionalClauseDraft["op"] {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "neq") {
    return "neq";
  }
  if (normalized === "lt") {
    return "lt";
  }
  if (normalized === "gt") {
    return "gt";
  }
  if (normalized === "lte") {
    return "lte";
  }
  if (normalized === "gte") {
    return "gte";
  }
  return "eq";
}

function inferConditionFieldInputType(values: unknown[]): ConditionFieldInputType {
  let hasValue = false;
  let canBeBoolean = true;
  let canBeNumber = true;

  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    hasValue = true;

    const asString = String(value).trim();
    const isBooleanLike =
      typeof value === "boolean" || (typeof value === "string" && /^(true|false)$/i.test(asString));
    const isNumberLike =
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && asString.length > 0 && Number.isFinite(Number(asString)));

    if (!isBooleanLike) {
      canBeBoolean = false;
    }
    if (!isNumberLike) {
      canBeNumber = false;
    }
  }

  if (!hasValue) {
    return "text";
  }
  if (canBeBoolean) {
    return "boolean";
  }
  if (canBeNumber) {
    return "number";
  }
  return "text";
}

function toTitleCase(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseSelectedKey(key: string): { datasetKey: string; column: string } {
  const [datasetKey, column] = String(key ?? "").trim().split(".");
  return {
    datasetKey: datasetKey ?? "",
    column: column ?? "",
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function matchesConditionClause(args: {
  op: ConditionalClauseDraft["op"];
  left: unknown;
  right: unknown;
}): boolean {
  const { op, left, right } = args;
  if (op === "eq" || op === "neq") {
    const leftNormalized = normalizeConditionValue(left);
    const rightNormalized = normalizeConditionValue(right);
    return op === "neq" ? leftNormalized !== rightNormalized : leftNormalized === rightNormalized;
  }

  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    if (op === "lt") {
      return leftNumber < rightNumber;
    }
    if (op === "gt") {
      return leftNumber > rightNumber;
    }
    if (op === "lte") {
      return leftNumber <= rightNumber;
    }
    return leftNumber >= rightNumber;
  }

  const leftComparable = normalizeConditionValue(left);
  const rightComparable = normalizeConditionValue(right);
  const compared = leftComparable.localeCompare(rightComparable, undefined, { numeric: true, sensitivity: "base" });
  if (op === "lt") {
    return compared < 0;
  }
  if (op === "gt") {
    return compared > 0;
  }
  if (op === "lte") {
    return compared <= 0;
  }
  return compared >= 0;
}

function resolveBarColor(colorName: string | undefined): string {
  const normalized = String(colorName ?? "").trim();
  if (!normalized) {
    return APP_COLORS.darkGray;
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
  return APP_COLORS.darkGray;
}

function matchesDraftThreshold(draft: ConditionalBarDraft, value: number): boolean {
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

function parseConditionalBarDraft(raw: unknown): ConditionalBarDraft {
  if (!isObjectRecord(raw)) {
    return createEmptyDraft();
  }

  const threshold = isObjectRecord(raw.threshold) ? raw.threshold : {};
  const gte = typeof threshold.gte === "number" && Number.isFinite(threshold.gte) ? String(threshold.gte) : "";
  const lte = typeof threshold.lte === "number" && Number.isFinite(threshold.lte) ? String(threshold.lte) : "";
  const display: ConditionalBarDraft["display"] = raw.display === "number" ? "number" : "percentage";
  const fraction_digits =
    typeof raw.fraction_digits === "number" && Number.isFinite(raw.fraction_digits)
      ? String(raw.fraction_digits)
      : "";
  const color = typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : "green";
  const color_else = typeof raw.color_else === "string" && raw.color_else.trim() ? raw.color_else.trim() : "darkGray";
  const bar_max = typeof raw.bar_max === "number" && Number.isFinite(raw.bar_max) && raw.bar_max > 0 ? String(raw.bar_max) : "";
  const value_from = typeof raw.value_from === "string" ? raw.value_from.trim() : "";
  const threshold_from = typeof raw.threshold_from === "string" ? raw.threshold_from.trim() : "";
  const label_from = typeof raw.label_from === "string" ? raw.label_from.trim() : "";

  const conditions: ConditionalRuleDraft[] = Array.isArray(raw.conditions)
    ? raw.conditions
        .filter((condition): condition is Record<string, unknown> => isObjectRecord(condition))
        .map((condition) => {
          const clauses = Array.isArray(condition.all)
            ? condition.all
                .filter((clause): clause is Record<string, unknown> => isObjectRecord(clause))
                .map((clause) => {
                  const field = String(clause.field ?? "").trim();
                  if (!field) {
                    return null;
                  }
                  return {
                    field,
                    op: parseConditionOperator(clause.op),
                    value: String(clause.value ?? ""),
                    value_field: String(clause.value_field ?? "").trim(),
                  } as ConditionalClauseDraft;
                })
                .filter((clause): clause is ConditionalClauseDraft => clause !== null)
            : [];
          if (clauses.length === 0) {
            return null;
          }
          return {
            include: condition.include !== false,
            color: String(condition.color ?? "").trim() || "darkGray",
            clauses,
          } as ConditionalRuleDraft;
        })
        .filter((rule): rule is ConditionalRuleDraft => rule !== null)
    : [];

  return {
    type: "conditional_bar",
    gte,
    lte,
    display,
    fraction_digits,
    color,
    color_else,
    bar_max,
    value_from,
    threshold_from,
    label_from,
    conditions: sortConditionsByGroup(conditions),
  };
}

function draftToPayload(draft: ConditionalBarDraft): Record<string, unknown> {
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
            op: parseConditionOperator(clause.op),
            value: String(clause.value ?? ""),
            ...(String(clause.value_field ?? "").trim()
              ? { value_field: String(clause.value_field ?? "").trim() }
              : {}),
          };
        })
        .filter(
          (
            clause
          ): clause is {
            field: string;
            op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
            value: string;
            value_field?: string;
          } => clause !== null
        );
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
      ): condition is {
        include: boolean;
        color: string;
        all: Array<{
          field: string;
          op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
          value: string;
          value_field?: string;
        }>;
      } =>
        condition !== null
    );

  const payload: Record<string, unknown> = {
    type: "conditional_bar",
    display: draft.display,
    color: draft.color || "green",
    color_else: draft.color_else || "darkGray",
    ...(draft.value_from ? { value_from: draft.value_from } : {}),
    ...(draft.threshold_from ? { threshold_from: draft.threshold_from } : {}),
    ...(draft.label_from ? { label_from: draft.label_from } : {}),
    ...(Object.keys(threshold).length > 0 ? { threshold } : {}),
    ...(conditions.length > 0 ? { conditions } : {}),
  };

  const digits = Number(draft.fraction_digits);
  if (Number.isFinite(digits)) {
    payload.fraction_digits = digits;
  }
  const max = Number(draft.bar_max);
  if (Number.isFinite(max) && max > 0) {
    payload.bar_max = max;
  }

  return payload;
}

function buildColumnTypesPayload(args: {
  configuredColumnKey: string | null;
  selectedColumns: string[];
  availableColumns: AvailableColumn[];
  conditionalDrafts: Record<string, ConditionalBarDraft>;
}): Record<string, unknown> {
  const { configuredColumnKey, selectedColumns, availableColumns, conditionalDrafts } = args;
  if (!configuredColumnKey) {
    return {};
  }

  const availableSet = new Set(availableColumns.map((column) => column.key));
  const filteredSelected = selectedColumns.filter((key) => availableSet.has(key));
  if (!filteredSelected.includes(configuredColumnKey)) {
    return {};
  }

  return {
    [configuredColumnKey]: draftToPayload(conditionalDrafts[configuredColumnKey] ?? createEmptyDraft()),
  };
}

function buildConfigSignature(args: {
  configuredColumnKey: string | null;
  selectedColumns: string[];
  availableColumns: AvailableColumn[];
  conditionalDrafts: Record<string, ConditionalBarDraft>;
}): string {
  const { configuredColumnKey, selectedColumns, availableColumns, conditionalDrafts } = args;
  const availableSet = new Set(availableColumns.map((column) => column.key));
  const filteredSelected = selectedColumns.filter((key) => availableSet.has(key));
  return JSON.stringify({
    selected_columns: filteredSelected,
    column_types: buildColumnTypesPayload({
      configuredColumnKey,
      selectedColumns: filteredSelected,
      availableColumns,
      conditionalDrafts,
    }),
  });
}

function formatConditionName(args: {
  condition: ConditionalRuleDraft;
  availableByKey: Map<string, AvailableColumn>;
}): string {
  return args.condition.clauses
    .map((clause) => {
      const available = args.availableByKey.get(clause.field);
      const fieldName = toTitleCase(available?.column ?? parseSelectedKey(clause.field).column ?? clause.field);
      const operator =
        clause.op === "neq"
          ? "!="
          : clause.op === "lt"
            ? "<"
            : clause.op === "gt"
              ? ">"
              : clause.op === "lte"
                ? "<="
                : clause.op === "gte"
                  ? ">="
                  : "=";
      const compareFieldKey = String(clause.value_field ?? "").trim();
      if (compareFieldKey) {
        const compareAvailable = args.availableByKey.get(compareFieldKey);
        const compareFieldName = toTitleCase(
          compareAvailable?.column ?? parseSelectedKey(compareFieldKey).column ?? compareFieldKey
        );
        return `${fieldName} ${operator} [${compareFieldName}]`;
      }
      return `${fieldName} ${operator} ${clause.value}`;
    })
    .join(" AND ");
}

export default function ReportComponentConditionalBarEdit(args: {
  reportId: string;
  reportComponentId: string;
  configApiPath?: string;
  dataApiPath?: string;
}) {
  const {
    reportId,
    reportComponentId,
    configApiPath = "/api/reports/components/conditional-bar-config",
    dataApiPath = "/api/reports/components/conditional-bar",
  } = args;
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [reportRoute, setReportRoute] = useState("");
  const [componentCode, setComponentCode] = useState("conditional_bar");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [availableColumns, setAvailableColumns] = useState<AvailableColumn[]>([]);
  const [conditionalDrafts, setConditionalDrafts] = useState<Record<string, ConditionalBarDraft>>({});
  const [configuredColumnKey, setConfiguredColumnKey] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<GenericRow[]>([]);
  const [activeConditionIndex, setActiveConditionIndex] = useState<number | null>(null);
  const [draggedConditionIndex, setDraggedConditionIndex] = useState<number | null>(null);
  const [dropConditionIndex, setDropConditionIndex] = useState<number | null>(null);
  const lastSavedConfigSignatureRef = useRef("");

  const loadPreview = useCallback(async (nextRoute: string) => {
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

      const res = await fetch(`${dataApiPath}?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ConditionalBarDataResponse;
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
  }, [dataApiPath, searchParamsKey]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    try {
      const res = await fetch(
        `${configApiPath}?report_id=${encodeURIComponent(reportId)}&report_component_id=${encodeURIComponent(reportComponentId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as ConditionalBarConfigResponse;
      if (!res.ok || !json.config) {
        throw new Error(json.error || "Failed to load conditional bar config");
      }

      const nextRoute = String(json.config.route ?? "").trim() || reportId;
      const nextAvailable = json.config.available_columns ?? [];
      const nextSelected = Array.from(new Set(json.config.selected_columns ?? []));
      const drafts: Record<string, ConditionalBarDraft> = {};
      for (const [key, raw] of Object.entries(json.config.column_types ?? {})) {
        if (!isObjectRecord(raw) || String(raw.type ?? "").trim().toLowerCase() !== "conditional_bar") {
          continue;
        }
        drafts[key] = parseConditionalBarDraft(raw);
      }
      const nextConfigured = nextSelected.find((key) => drafts[key]) ?? nextSelected[0] ?? null;
      if (nextConfigured && !drafts[nextConfigured]) {
        drafts[nextConfigured] = createEmptyDraft();
      }

      setReportRoute(nextRoute);
      setComponentCode(String(json.config.component_code ?? "conditional_bar"));
      setAvailableColumns(nextAvailable);
      setSelectedColumns(nextSelected);
      setConfiguredColumnKey(nextConfigured);
      setConditionalDrafts(drafts);

      lastSavedConfigSignatureRef.current = buildConfigSignature({
        configuredColumnKey: nextConfigured,
        selectedColumns: nextSelected,
        availableColumns: nextAvailable,
        conditionalDrafts: drafts,
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
    if (reportRoute) {
      void loadPreview(reportRoute);
    }
  }, [loadPreview, reportRoute, searchParamsKey]);

  useEffect(() => {
    function handleColumnChange(event: Event) {
      const customEvent = event as CustomEvent<{ reportId?: string; reportComponentId?: string; selectedColumns?: string[] }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportId || String(detail.reportComponentId ?? "") !== reportComponentId) {
        return;
      }
      if (!Array.isArray(detail.selectedColumns)) {
        return;
      }
      const availableSet = new Set(availableColumns.map((column) => column.key));
      const nextSelected = Array.from(
        new Set(
          detail.selectedColumns
            .map((column) => String(column ?? "").trim())
            .filter((column) => column.length > 0 && availableSet.has(column))
        )
      );
      setSelectedColumns(nextSelected);
    }

    window.addEventListener(EDIT_COLUMNS_CHANGE_EVENT, handleColumnChange as EventListener);
    return () => {
      window.removeEventListener(EDIT_COLUMNS_CHANGE_EVENT, handleColumnChange as EventListener);
    };
  }, [availableColumns, reportComponentId, reportId]);

  useEffect(() => {
    if (selectedColumns.length === 0) {
      setConfiguredColumnKey(null);
      return;
    }
    setConfiguredColumnKey((current) => (current && selectedColumns.includes(current) ? current : selectedColumns[0]));
  }, [selectedColumns]);

  useEffect(() => {
    if (!configuredColumnKey) {
      return;
    }
    setActiveConditionIndex(null);
    setConditionalDrafts((current) => {
      if (current[configuredColumnKey]) {
        return current;
      }
      return { ...current, [configuredColumnKey]: createEmptyDraft() };
    });
  }, [configuredColumnKey]);

  const configSignature = useMemo(() => {
    return buildConfigSignature({
      configuredColumnKey,
      selectedColumns,
      availableColumns,
      conditionalDrafts,
    });
  }, [availableColumns, conditionalDrafts, configuredColumnKey, selectedColumns]);

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
    const map = new Map<string, AvailableColumn>();
    for (const column of availableColumns) {
      map.set(column.key, column);
    }
    return map;
  }, [availableColumns]);

  const accessorBySelectedKey = useMemo(() => {
    const previewKeys = new Set(Object.keys(previewRows[0] ?? {}));
    const map = new Map<string, string>();
    for (const key of selectedColumns) {
      const parsed = parseSelectedKey(key);
      const fallback = parsed.column || key;
      map.set(key, previewKeys.has(fallback) ? fallback : previewKeys.has(key) ? key : fallback);
    }
    return map;
  }, [previewRows, selectedColumns]);

  const configuredDraft = useMemo(() => {
    if (!configuredColumnKey) {
      return null;
    }
    return conditionalDrafts[configuredColumnKey] ?? createEmptyDraft();
  }, [conditionalDrafts, configuredColumnKey]);

  const activeConditionDraft = useMemo(() => {
    if (!configuredDraft || activeConditionIndex === null) {
      return null;
    }
    return configuredDraft.conditions[activeConditionIndex] ?? null;
  }, [activeConditionIndex, configuredDraft]);

  const includeConditionIndexes = useMemo(() => {
    if (!configuredDraft) {
      return [] as number[];
    }
    const indexes: number[] = [];
    for (let index = 0; index < configuredDraft.conditions.length; index += 1) {
      if (configuredDraft.conditions[index].include !== false) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [configuredDraft]);

  const excludeConditionIndexes = useMemo(() => {
    if (!configuredDraft) {
      return [] as number[];
    }
    const indexes: number[] = [];
    for (let index = 0; index < configuredDraft.conditions.length; index += 1) {
      if (configuredDraft.conditions[index].include === false) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [configuredDraft]);

  useEffect(() => {
    if (!configuredDraft || activeConditionIndex === null) {
      return;
    }
    if (activeConditionIndex < 0 || activeConditionIndex >= configuredDraft.conditions.length) {
      setActiveConditionIndex(null);
    }
  }, [activeConditionIndex, configuredDraft]);

  const conditionSourceColumns = useMemo(() => {
    if (!configuredColumnKey) {
      return [] as Array<{ key: string; label: string; compactLabel: string }>;
    }
    return selectedColumns.map((key) => {
      const available = availableByKey.get(key);
      const parsed = parseSelectedKey(key);
      const compactLabel = toTitleCase(available?.column ?? parsed.column ?? key);
      return {
        key,
        label: available ? `${available.source_schema}.${available.dataset_key}.${available.column}` : parsed.column || key,
        compactLabel,
      };
    });
  }, [availableByKey, configuredColumnKey, selectedColumns]);

  const conditionFieldInputTypeByKey = useMemo(() => {
    const byKey = new Map<string, ConditionFieldInputType>();
    for (const key of selectedColumns) {
      const accessor = accessorBySelectedKey.get(key) || parseSelectedKey(key).column || key;
      const values = previewRows.map((row) => row[accessor]);
      byKey.set(key, inferConditionFieldInputType(values));
    }
    return byKey;
  }, [accessorBySelectedKey, previewRows, selectedColumns]);

  const previewSegments = useMemo(() => {
    if (!configuredColumnKey || !configuredDraft) {
      return [] as Array<{ key: string; color: string; title: string }>;
    }

    const thresholdSourceKey = configuredDraft.threshold_from || configuredDraft.value_from || configuredColumnKey;
    const labelSourceKey = configuredDraft.label_from || "sis_user_id";
    const thresholdField = accessorBySelectedKey.get(thresholdSourceKey) || parseSelectedKey(thresholdSourceKey).column || thresholdSourceKey;
    const labelField = accessorBySelectedKey.get(labelSourceKey) || parseSelectedKey(labelSourceKey).column || labelSourceKey;

    return previewRows
      .map((row, index) => {
        const matchedConditionIndex = configuredDraft.conditions.findIndex((condition) =>
          condition.clauses.every((clause) => {
            const field = accessorBySelectedKey.get(clause.field) || parseSelectedKey(clause.field).column || clause.field;
            const left = row[field];
            const compareFieldKey = String(clause.value_field ?? "").trim();
            const right = compareFieldKey
              ? (
                  row[
                    accessorBySelectedKey.get(compareFieldKey) ||
                      parseSelectedKey(compareFieldKey).column ||
                      compareFieldKey
                  ]
                )
              : clause.value;
            return matchesConditionClause({ op: clause.op, left, right });
          })
        );
        const matched = matchedConditionIndex >= 0 ? configuredDraft.conditions[matchedConditionIndex] : null;

        if (matched && !matched.include) {
          return null;
        }

        const threshold = toNumber(row[thresholdField]);
        const match = threshold !== null ? matchesDraftThreshold(configuredDraft, threshold) : false;
        const color = matched?.color
          ? resolveBarColor(matched.color)
          : resolveBarColor(match ? configuredDraft.color : configuredDraft.color_else);
        const title = String(row[labelField] ?? row.sis_user_id ?? `row-${index + 1}`);
        const sortOrder = matchedConditionIndex >= 0 ? matchedConditionIndex : Number.MAX_SAFE_INTEGER;

        return {
          key: `${title}-${index}`,
          color,
          title,
          sortOrder,
          index,
        };
      })
      .filter(
        (item): item is { key: string; color: string; title: string; sortOrder: number; index: number } => item !== null
      )
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.index - right.index;
      })
      .map(({ key, color, title }) => ({ key, color, title }));
  }, [accessorBySelectedKey, configuredColumnKey, configuredDraft, previewRows]);

  function updateConfiguredDraft(update: Partial<ConditionalBarDraft>) {
    if (!configuredColumnKey) {
      return;
    }
    setConditionalDrafts((current) => ({
      ...current,
      [configuredColumnKey]: {
        ...(current[configuredColumnKey] ?? createEmptyDraft()),
        ...update,
      },
    }));
  }

  function addConditionRule() {
    if (!configuredColumnKey) {
      return;
    }
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      const sourceField = existing.threshold_from || existing.value_from || selectedColumns[0] || configuredColumnKey;
      return {
        ...current,
        [configuredColumnKey]: {
          ...existing,
          conditions: sortConditionsByGroup([
            ...existing.conditions,
            {
              include: true,
              color: "darkGray",
              clauses: [{ field: sourceField, op: "eq", value: "true", value_field: "" }],
            },
          ]),
        },
      };
    });
  }

  function updateConditionRule(ruleIndex: number, update: Partial<ConditionalRuleDraft>) {
    if (!configuredColumnKey) {
      return;
    }
    let nextIndexForUpdatedRule: number | null = null;
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      const conditions = [...existing.conditions];
      if (!conditions[ruleIndex]) {
        return current;
      }
      const updatedRule = { ...conditions[ruleIndex], ...update };
      conditions[ruleIndex] = updatedRule;
      const nextConditions = update.include === undefined ? conditions : sortConditionsByGroup(conditions);
      if (update.include !== undefined) {
        nextIndexForUpdatedRule = nextConditions.indexOf(updatedRule);
      }
      return {
        ...current,
        [configuredColumnKey]: { ...existing, conditions: nextConditions },
      };
    });
    if (nextIndexForUpdatedRule !== null) {
      setActiveConditionIndex((current) => {
        if (current === ruleIndex) {
          return nextIndexForUpdatedRule;
        }
        return current;
      });
    }
  }

  function reorderConditionRule(sourceIndex: number, targetIndex: number) {
    if (!configuredColumnKey) {
      return;
    }
    if (sourceIndex === targetIndex) {
      return;
    }
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        sourceIndex >= existing.conditions.length ||
        targetIndex >= existing.conditions.length
      ) {
        return current;
      }
      if (existing.conditions[sourceIndex].include !== existing.conditions[targetIndex].include) {
        return current;
      }
      const nextConditions = [...existing.conditions];
      const [moved] = nextConditions.splice(sourceIndex, 1);
      nextConditions.splice(targetIndex, 0, moved);
      return {
        ...current,
        [configuredColumnKey]: {
          ...existing,
          conditions: nextConditions,
        },
      };
    });
    setActiveConditionIndex((current) => {
      if (current === null) {
        return null;
      }
      if (current === sourceIndex) {
        return targetIndex;
      }
      if (sourceIndex < current && current <= targetIndex) {
        return current - 1;
      }
      if (targetIndex <= current && current < sourceIndex) {
        return current + 1;
      }
      return current;
    });
  }

  function handleConditionDragStart(event: React.DragEvent<HTMLButtonElement>, conditionIndex: number) {
    setDraggedConditionIndex(conditionIndex);
    setDropConditionIndex(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(conditionIndex));
  }

  function handleConditionDragOver(event: React.DragEvent<HTMLDivElement>, conditionIndex: number) {
    if (draggedConditionIndex === null || draggedConditionIndex === conditionIndex) {
      return;
    }
    if (!configuredDraft) {
      return;
    }
    const sourceRule = configuredDraft.conditions[draggedConditionIndex];
    const targetRule = configuredDraft.conditions[conditionIndex];
    if (!sourceRule || !targetRule || sourceRule.include !== targetRule.include) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropConditionIndex !== conditionIndex) {
      setDropConditionIndex(conditionIndex);
    }
  }

  function handleConditionDrop(event: React.DragEvent<HTMLDivElement>, targetIndex: number) {
    event.preventDefault();
    const sourceFromDataTransferRaw = event.dataTransfer.getData("text/plain");
    const parsedSource = Number.parseInt(sourceFromDataTransferRaw, 10);
    const sourceIndex = draggedConditionIndex ?? (Number.isNaN(parsedSource) ? null : parsedSource);
    setDraggedConditionIndex(null);
    setDropConditionIndex(null);
    if (sourceIndex === null) {
      return;
    }
    if (!configuredDraft) {
      return;
    }
    const sourceRule = configuredDraft.conditions[sourceIndex];
    const targetRule = configuredDraft.conditions[targetIndex];
    if (!sourceRule || !targetRule || sourceRule.include !== targetRule.include) {
      return;
    }
    reorderConditionRule(sourceIndex, targetIndex);
  }

  function handleConditionDragEnd() {
    setDraggedConditionIndex(null);
    setDropConditionIndex(null);
  }

  function removeConditionRule(ruleIndex: number) {
    if (!configuredColumnKey) {
      return;
    }
    setDraggedConditionIndex((current) => {
      if (current === null) {
        return null;
      }
      if (current === ruleIndex) {
        return null;
      }
      if (current > ruleIndex) {
        return current - 1;
      }
      return current;
    });
    setDropConditionIndex((current) => {
      if (current === null) {
        return null;
      }
      if (current === ruleIndex) {
        return null;
      }
      if (current > ruleIndex) {
        return current - 1;
      }
      return current;
    });
    setActiveConditionIndex((current) => {
      if (current === null) {
        return null;
      }
      if (current === ruleIndex) {
        return null;
      }
      if (current > ruleIndex) {
        return current - 1;
      }
      return current;
    });
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      return {
        ...current,
        [configuredColumnKey]: {
          ...existing,
          conditions: existing.conditions.filter((_, index) => index !== ruleIndex),
        },
      };
    });
  }

  function addClause(ruleIndex: number) {
    if (!configuredColumnKey) {
      return;
    }
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      const conditions = [...existing.conditions];
      const rule = conditions[ruleIndex];
      if (!rule) {
        return current;
      }
      const sourceField = existing.threshold_from || existing.value_from || selectedColumns[0] || configuredColumnKey;
      conditions[ruleIndex] = {
        ...rule,
        clauses: [...rule.clauses, { field: sourceField, op: "eq", value: "true", value_field: "" }],
      };
      return {
        ...current,
        [configuredColumnKey]: { ...existing, conditions },
      };
    });
  }

  function updateClause(ruleIndex: number, clauseIndex: number, update: Partial<ConditionalClauseDraft>) {
    if (!configuredColumnKey) {
      return;
    }
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      const conditions = [...existing.conditions];
      const rule = conditions[ruleIndex];
      if (!rule || !rule.clauses[clauseIndex]) {
        return current;
      }
      const clauses = [...rule.clauses];
      clauses[clauseIndex] = { ...clauses[clauseIndex], ...update };
      conditions[ruleIndex] = { ...rule, clauses };
      return {
        ...current,
        [configuredColumnKey]: { ...existing, conditions },
      };
    });
  }

  function removeClause(ruleIndex: number, clauseIndex: number) {
    if (!configuredColumnKey) {
      return;
    }
    setConditionalDrafts((current) => {
      const existing = current[configuredColumnKey] ?? createEmptyDraft();
      const conditions = [...existing.conditions];
      const rule = conditions[ruleIndex];
      if (!rule || rule.clauses.length <= 1) {
        return current;
      }
      conditions[ruleIndex] = {
        ...rule,
        clauses: rule.clauses.filter((_, index) => index !== clauseIndex),
      };
      return {
        ...current,
        [configuredColumnKey]: { ...existing, conditions },
      };
    });
  }

  function renderConditionCard(ruleIndex: number) {
    if (!configuredDraft) {
      return null;
    }
    const rule = configuredDraft.conditions[ruleIndex];
    if (!rule) {
      return null;
    }
    const conditionSummary = formatConditionName({ condition: rule, availableByKey });
    const isDropTarget = dropConditionIndex === ruleIndex && draggedConditionIndex !== ruleIndex;
    const isDragging = draggedConditionIndex === ruleIndex;
    return (
      <div
        key={`rule-${ruleIndex}`}
        className="rounded border p-2"
        style={{
          borderColor: isDropTarget ? "var(--app-control-track-active)" : "var(--app-border)",
          backgroundColor: isDragging ? "var(--app-surface-muted)" : undefined,
        }}
        onDragOver={(event) => handleConditionDragOver(event, ruleIndex)}
        onDrop={(event) => handleConditionDrop(event, ruleIndex)}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            draggable
            onDragStart={(event) => handleConditionDragStart(event, ruleIndex)}
            onDragEnd={handleConditionDragEnd}
            className="mt-0.5 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded border active:cursor-grabbing"
            style={{
              borderColor: "var(--app-border)",
              color: "var(--app-text-muted)",
              backgroundColor: "var(--app-surface)",
            }}
            aria-label={`Reorder condition ${ruleIndex + 1}`}
            title="Drag to reorder"
          >
            <DragHandleIcon className="h-4 w-4" />
          </button>
          <span
            className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2"
            style={{
              backgroundColor: resolveBarColor(rule.color),
              borderColor: "var(--app-surface)",
              boxShadow: "0 0 0 1px var(--app-text-strong)",
            }}
            aria-hidden="true"
            title={`Condition color: ${rule.color || "darkGray"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium" style={{ color: "var(--app-text-strong)" }} title={conditionSummary}>
              {conditionSummary || "No clauses set"}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--app-text-muted)" }}>
              {rule.include ? "Include" : "Exclude"} match - {rule.clauses.length} clause
              {rule.clauses.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <EditAction
              onClick={() => setActiveConditionIndex(ruleIndex)}
              ariaLabel={`Edit condition ${ruleIndex + 1}`}
              title="Edit condition"
              className="h-6 w-6 text-[11px]"
              style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
              iconSize={10}
            />
            <button
              type="button"
              onClick={() => removeConditionRule(ruleIndex)}
              className="inline-flex h-6 w-6 items-center justify-center rounded border text-xs font-medium"
              style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
              aria-label={`Remove condition ${ruleIndex + 1}`}
              title="Remove condition"
            >
              X
              <span className="sr-only">{`Remove condition ${ruleIndex + 1}`}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const availableSet = new Set(availableColumns.map((column) => column.key));
      const filteredSelected = selectedColumns.filter((key) => availableSet.has(key));
      const columnTypes = buildColumnTypesPayload({
        configuredColumnKey,
        selectedColumns: filteredSelected,
        availableColumns,
        conditionalDrafts,
      });

      const res = await fetch(
        `${configApiPath}?report_id=${encodeURIComponent(reportId)}&report_component_id=${encodeURIComponent(reportComponentId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selected_columns: filteredSelected,
            column_types: columnTypes,
          }),
        }
      );

      const json = (await res.json()) as ConditionalBarConfigResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Save failed");
      }

      lastSavedConfigSignatureRef.current = buildConfigSignature({
        configuredColumnKey,
        selectedColumns: filteredSelected,
        availableColumns,
        conditionalDrafts,
      });
      setSaveMessage("Saved.");
      await loadConfig();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [availableColumns, conditionalDrafts, configuredColumnKey, configApiPath, loadConfig, reportComponentId, reportId, selectedColumns]);

  useEffect(() => {
    function onSaveRequest(event: Event) {
      const customEvent = event as CustomEvent<{ reportId?: string; reportComponentId?: string }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportId || String(detail.reportComponentId ?? "") !== reportComponentId) {
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
      const customEvent = event as CustomEvent<{ reportId?: string; reportComponentId?: string }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportId || String(detail.reportComponentId ?? "") !== reportComponentId) {
        return;
      }
      setSaveMessage(null);
      setError(null);
      void loadConfig();
    }

    window.addEventListener(EDIT_COMPONENT_RESET_REQUEST_EVENT, onResetRequest as EventListener);
    return () => {
      window.removeEventListener(EDIT_COMPONENT_RESET_REQUEST_EVENT, onResetRequest as EventListener);
    };
  }, [loadConfig, reportComponentId, reportId]);

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

        {selectedColumns.length === 0 && !loading && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No columns selected. Use sidebar "Columns" to add at least one source column.
          </div>
        )}

        {configuredColumnKey && configuredDraft && selectedColumns.length > 0 && (
          <div className="space-y-4">
            <ReportComponentConditionalBar segments={previewSegments} />

            <div className="rounded border p-3" style={{ borderColor: "var(--app-border)" }}>
              <h3 className="mb-2 text-sm font-semibold">Bar Settings</h3>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={configuredColumnKey}
                  onChange={(event) => setConfiguredColumnKey(event.target.value)}
                  className="rounded border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
                >
                  {selectedColumns.map((key) => {
                    const available = availableByKey.get(key);
                    const parsed = parseSelectedKey(key);
                    const label = available ? `${available.source_schema}.${available.dataset_key}.${available.column}` : parsed.column || key;
                    return (
                      <option key={`configured-${key}`} value={key}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                <select
                  value={configuredDraft.display}
                  onChange={(event) => updateConfiguredDraft({ display: event.target.value === "number" ? "number" : "percentage" })}
                  className="rounded border px-2 py-1 text-sm"
                  style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
                >
                  <option value="percentage">Display: Percentage</option>
                  <option value="number">Display: Number</option>
                </select>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                <input value={configuredDraft.gte} onChange={(event) => updateConfiguredDraft({ gte: event.target.value })} placeholder="gte (optional)" className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
                <input value={configuredDraft.lte} onChange={(event) => updateConfiguredDraft({ lte: event.target.value })} placeholder="lte (optional)" className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
                <input value={configuredDraft.fraction_digits} onChange={(event) => updateConfiguredDraft({ fraction_digits: event.target.value })} placeholder="fraction digits" className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
                <input value={configuredDraft.bar_max} onChange={(event) => updateConfiguredDraft({ bar_max: event.target.value })} placeholder="bar max (optional)" className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                <label className="space-y-1 text-xs" style={{ color: "var(--app-text-muted)" }}>
                  <span>Value Source</span>
                  <select value={configuredDraft.value_from || configuredColumnKey} onChange={(event) => updateConfiguredDraft({ value_from: event.target.value === configuredColumnKey ? "" : event.target.value })} className="w-full rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                    {conditionSourceColumns.map((source) => (
                      <option key={`value-${source.key}`} value={source.key}>
                        {source.compactLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs" style={{ color: "var(--app-text-muted)" }}>
                  <span>Threshold Source</span>
                  <select value={configuredDraft.threshold_from || configuredDraft.value_from || configuredColumnKey} onChange={(event) => updateConfiguredDraft({ threshold_from: event.target.value === (configuredDraft.value_from || configuredColumnKey) ? "" : event.target.value })} className="w-full rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                    {conditionSourceColumns.map((source) => (
                      <option key={`threshold-${source.key}`} value={source.key}>
                        {source.compactLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs" style={{ color: "var(--app-text-muted)" }}>
                  <span>Label Source</span>
                  <select value={configuredDraft.label_from || configuredColumnKey} onChange={(event) => updateConfiguredDraft({ label_from: event.target.value === configuredColumnKey ? "" : event.target.value })} className="w-full rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                    {conditionSourceColumns.map((source) => (
                      <option key={`label-${source.key}`} value={source.key}>
                        {source.compactLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <ColorSelectionDropdown value={configuredDraft.color} onChange={(nextValue) => updateConfiguredDraft({ color: nextValue })} groups={BASE_COLOR_GROUPS} className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
                <ColorSelectionDropdown value={configuredDraft.color_else} onChange={(nextValue) => updateConfiguredDraft({ color_else: nextValue })} groups={BASE_COLOR_GROUPS} className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
              </div>
            </div>

            <div className="rounded border p-3" style={{ borderColor: "var(--app-border)" }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Conditions</h3>
                <button type="button" onClick={addConditionRule} className="rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}>
                  Add Condition
                </button>
              </div>
              <p className="mb-2 text-xs" style={{ color: "var(--app-text-muted)" }}>
                Each condition can include one or more AND clauses. Use Edit to open the condition modal.
              </p>

              {configuredDraft.conditions.length === 0 && (
                <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
                  No conditions configured.
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--app-text-muted)" }}>
                    Include
                  </div>
                  {includeConditionIndexes.length === 0 ? (
                    <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                      No include conditions.
                    </div>
                  ) : (
                    includeConditionIndexes.map((ruleIndex) => renderConditionCard(ruleIndex))
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--app-text-muted)" }}>
                    Exclude
                  </div>
                  {excludeConditionIndexes.length === 0 ? (
                    <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                      No exclude conditions.
                    </div>
                  ) : (
                    excludeConditionIndexes.map((ruleIndex) => renderConditionCard(ruleIndex))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </ReportContainer>

      {configuredColumnKey && activeConditionIndex !== null && activeConditionDraft && (
        <CenteredModal
          isOpen
          onClose={() => setActiveConditionIndex(null)}
          title={`Edit Condition ${activeConditionIndex + 1}`}
          dialogId={`report-conditional-bar-condition-${reportComponentId}-${activeConditionIndex}`}
          maxWidthClassName="max-w-xl"
          closeButtonLabel="Close condition editor"
          closeButtonText="Close"
        >
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
              {formatConditionName({ condition: activeConditionDraft, availableByKey }) || "No clauses set"}
            </p>

            <div className="flex items-center gap-2">
              <select value={activeConditionDraft.include ? "include" : "exclude"} onChange={(event) => updateConditionRule(activeConditionIndex, { include: event.target.value !== "exclude" })} className="w-40 shrink-0 rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                <option value="include">Include Match</option>
                <option value="exclude">Exclude Match</option>
              </select>
              <ColorSelectionDropdown value={activeConditionDraft.color} onChange={(nextValue) => updateConditionRule(activeConditionIndex, { color: nextValue })} disabled={!activeConditionDraft.include} groups={BASE_COLOR_GROUPS} className="min-w-0 flex-1 rounded border px-2 py-1 text-sm disabled:opacity-60" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }} />
            </div>

            <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
              {activeConditionDraft.clauses.map((clause, clauseIndex) => {
                const inputType = conditionFieldInputTypeByKey.get(clause.field) ?? "text";
                const booleanValue = normalizeConditionValue(clause.value) === "true";
                const isRawValue = !String(clause.value_field ?? "").trim();
                return (
                  <div key={`clause-modal-${activeConditionIndex}-${clauseIndex}`} className="flex items-center gap-2">
                    <select value={clause.field} onChange={(event) => updateClause(activeConditionIndex, clauseIndex, { field: event.target.value })} className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                      {conditionSourceColumns.map((source) => (
                        <option key={`field-modal-${activeConditionIndex}-${clauseIndex}-${source.key}`} value={source.key}>
                          {source.compactLabel}
                        </option>
                      ))}
                    </select>
                    <select value={clause.op} onChange={(event) => updateClause(activeConditionIndex, clauseIndex, { op: parseConditionOperator(event.target.value) })} className="w-20 shrink-0 rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                      <option value="eq">=</option>
                      <option value="neq">!=</option>
                      <option value="lt">&lt;</option>
                      <option value="gt">&gt;</option>
                      <option value="lte">&lt;=</option>
                      <option value="gte">&gt;=</option>
                    </select>
                    <label className="flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                      <input
                        type="checkbox"
                        checked={isRawValue}
                        onChange={(event) =>
                          updateClause(activeConditionIndex, clauseIndex, {
                            value_field: event.target.checked
                              ? ""
                              : (clause.value_field || conditionSourceColumns[0]?.key || clause.field),
                          })
                        }
                        className="h-3.5 w-3.5"
                      />
                      <span>Raw</span>
                    </label>
                    {isRawValue ? (
                      inputType === "boolean" ? (
                        <label className="flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}>
                          <input
                            type="checkbox"
                            checked={booleanValue}
                            onChange={(event) => updateClause(activeConditionIndex, clauseIndex, { value: event.target.checked ? "true" : "false" })}
                            className="h-4 w-4"
                          />
                          <span>{booleanValue ? "true" : "false"}</span>
                        </label>
                      ) : (
                        <input
                          type={inputType === "number" ? "number" : "text"}
                          inputMode={inputType === "number" ? "decimal" : undefined}
                          value={clause.value}
                          onChange={(event) => updateClause(activeConditionIndex, clauseIndex, { value: event.target.value })}
                          placeholder={inputType === "number" ? "number value" : "value"}
                          className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                          style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
                        />
                      )
                    ) : (
                      <select
                        value={clause.value_field || conditionSourceColumns[0]?.key || ""}
                        onChange={(event) => updateClause(activeConditionIndex, clauseIndex, { value_field: event.target.value })}
                        className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                        style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
                      >
                        {conditionSourceColumns.map((source) => (
                          <option key={`value-field-modal-${activeConditionIndex}-${clauseIndex}-${source.key}`} value={source.key}>
                            {source.compactLabel}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => removeClause(activeConditionIndex, clauseIndex)}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-medium"
                      style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                      aria-label={`Remove clause ${clauseIndex + 1}`}
                      title="Remove clause"
                    >
                      X
                      <span className="sr-only">{`Remove clause ${clauseIndex + 1}`}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => addClause(activeConditionIndex)} className="rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}>
                Add AND Clause
              </button>
              <button
                type="button"
                onClick={() => setActiveConditionIndex(null)}
                className="rounded border px-3 py-1 text-xs"
                style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
              >
                Done
              </button>
            </div>
          </div>
        </CenteredModal>
      )}
    </div>
  );
}

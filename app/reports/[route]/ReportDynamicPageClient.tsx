"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { MetaChip } from "../_components/MetaChip";
import { EditAction } from "../_components/EditAction";
import type { PillTone } from "../_components/Pill";
import type { ReportComponentTableColumn } from "../_reportComponents/ReportComponentTable";
import ReportComponentTableRuntime from "../_reportComponents/ReportComponentTableRuntime";
import ReportComponentConditionalBar from "../_reportComponents/ReportComponentConditionalBar";
import { useReportPageData } from "../_hooks/useReportPageData";
import { APP_COLORS } from "@/lib/color-palette";

type GenericReportRow = Record<string, unknown>;

type GenericReportResponse = {
  ok: boolean;
  count: number;
  data: GenericReportRow[];
  meta?: Record<string, unknown> & {
    report_id?: unknown;
    report_component_id?: unknown;
    component_code?: unknown;
    selected_columns?: unknown;
    report_component_settings?: unknown;
    component_settings?: unknown;
  };
  error?: string;
};
type ResolvedReportComponent = {
  component_code?: unknown;
  report_component_id?: unknown;
  report_id?: unknown;
  component_order?: unknown;
};
type ComponentResolveResponse = {
  ok: boolean;
  component_code?: string;
  report_component_id?: string;
  report_id?: string;
  components?: ResolvedReportComponent[];
  error?: string;
};

type ResolvedComponent = {
  componentCode: string;
  reportComponentId: string;
  reportId: string;
  componentOrder: number;
};

type ResolvedComponentData = {
  key: string;
  reportComponentId: string;
  componentCode: string;
  rows: GenericReportRow[];
  columnIds: string[];
  columnTypeRules: Record<string, ColumnTypeRule>;
};

type ComponentViewModel = {
  key: string;
  componentCode: string;
  rows: GenericReportRow[];
  rowCount: number;
  columns: ReportComponentTableColumn<GenericReportRow>[];
  defaultSortColumnId: string;
  standaloneConditionalBarRows: Array<{
    key: string;
    label: string;
    valueLabel: string;
    widthPct: number;
    color: string;
  }>;
  standaloneConditionalBarSegments: Array<{
    key: string;
    color: string;
    title: string;
  }>;
};

const EMPTY_ROWS: GenericReportRow[] = [];
const EMPTY_COMPONENT_DATA: ResolvedComponentData[] = [];
const RESERVED_QUERY_KEYS = new Set(["route", "include_meta", "include_rows", "anonymize"]);

type ColumnTypeRule = {
  type: string;
  threshold?: {
    gte?: number;
    lte?: number;
  };
  conditions?: Array<{
    include: boolean;
    color?: string;
    all: Array<{
      field: string;
      op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
      value: string;
      value_field?: string;
    }>;
  }>;
  display?: "percentage" | "number" | "raw" | "title_case";
  fraction_digits?: number;
  colors_by_value?: Record<string, string>;
  color?: string;
  color_else?: string;
  bar_max?: number;
  value_from?: string;
  threshold_from?: string;
  label_from?: string;
};

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePillValueKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toPillDisplayLabel(value: unknown, display: ColumnTypeRule["display"]): string {
  const normalized = normalizePillValueKey(value);
  if (!normalized) {
    return "(empty)";
  }
  if (display === "title_case") {
    return toTitleCase(normalized);
  }
  return normalized;
}

function resolvePillColorForValue(colorsByValue: Record<string, string>, value: unknown): PillTone {
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

function readColumnTypeRules(meta: GenericReportResponse["meta"]): Record<string, ColumnTypeRule> {
  if (!meta) {
    return {};
  }

  const settingsCandidate =
    isObjectRecord(meta.report_component_settings) ? meta.report_component_settings : meta.component_settings;
  if (!isObjectRecord(settingsCandidate)) {
    return {};
  }
  const settings = settingsCandidate;
  if (!isObjectRecord(settings.column_types)) {
    return {};
  }

  const rules: Record<string, ColumnTypeRule> = {};
  for (const [key, rawRule] of Object.entries(settings.column_types)) {
    if (!key || !isObjectRecord(rawRule)) {
      continue;
    }
    const type = String(rawRule.type ?? "").trim().toLowerCase();
    if (!type) {
      continue;
    }
    const colorsByValueRaw = isObjectRecord(rawRule.colors_by_value)
      ? rawRule.colors_by_value
      : (isObjectRecord(rawRule.tones_by_value) ? rawRule.tones_by_value : {});
    const colorsByValue: Record<string, string> = {};
    for (const [valueKey, color] of Object.entries(colorsByValueRaw)) {
      const colorName = String(color ?? "").trim();
      if (!colorName) {
        continue;
      }
      colorsByValue[String(valueKey ?? "")] = colorName;
    }
    rules[key] = {
      type,
      threshold: isObjectRecord(rawRule.threshold)
        ? {
            gte: typeof rawRule.threshold.gte === "number" ? rawRule.threshold.gte : undefined,
            lte: typeof rawRule.threshold.lte === "number" ? rawRule.threshold.lte : undefined,
          }
        : undefined,
      display:
        rawRule.display === "percentage" ||
        rawRule.display === "number" ||
        rawRule.display === "raw" ||
        rawRule.display === "title_case"
          ? rawRule.display
          : undefined,
      fraction_digits:
        typeof rawRule.fraction_digits === "number" && Number.isFinite(rawRule.fraction_digits)
          ? rawRule.fraction_digits
          : undefined,
      ...(Object.keys(colorsByValue).length > 0 ? { colors_by_value: colorsByValue } : {}),
      color:
        typeof rawRule.color === "string" && rawRule.color.trim().length > 0
          ? rawRule.color.trim()
          : undefined,
      color_else:
        typeof rawRule.color_else === "string" && rawRule.color_else.trim().length > 0
          ? rawRule.color_else.trim()
          : undefined,
      bar_max:
        typeof rawRule.bar_max === "number" && Number.isFinite(rawRule.bar_max)
          ? rawRule.bar_max
          : undefined,
      value_from:
        typeof rawRule.value_from === "string" && rawRule.value_from.trim().length > 0
          ? rawRule.value_from.trim()
          : undefined,
      threshold_from:
        typeof rawRule.threshold_from === "string" && rawRule.threshold_from.trim().length > 0
          ? rawRule.threshold_from.trim()
          : undefined,
      label_from:
        typeof rawRule.label_from === "string" && rawRule.label_from.trim().length > 0
          ? rawRule.label_from.trim()
          : undefined,
      conditions: Array.isArray(rawRule.conditions)
        ? rawRule.conditions
            .filter((condition): condition is Record<string, unknown> => isObjectRecord(condition))
            .map((condition) => {
              const all = Array.isArray(condition.all)
                ? condition.all
                    .filter((clause): clause is Record<string, unknown> => isObjectRecord(clause))
                    .map((clause) => {
                      const field = String(clause.field ?? "").trim();
                      const op = parseConditionOperator(clause.op);
                      const value = String(clause.value ?? "");
                      const value_field = String(clause.value_field ?? "").trim();
                      if (!field) {
                        return null;
                      }
                      return { field, op, value, ...(value_field ? { value_field } : {}) };
                    })
                    .filter(
                      (
                        clause
                      ): clause is {
                        field: string;
                        op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
                        value: string;
                        value_field?: string;
                      } =>
                        clause !== null
                    )
                : [];
              if (all.length === 0) {
                return null;
              }
              const color = String(condition.color ?? "").trim();
              return {
                include: condition.include !== false,
                ...(color ? { color } : {}),
                all,
              };
            })
            .filter(
              (
                condition
              ): condition is {
                include: boolean;
                color?: string;
                all: Array<{
                  field: string;
                  op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
                  value: string;
                  value_field?: string;
                }>;
              } => condition !== null
            )
        : undefined,
    };
  }

  return rules;
}

function resolveRuleForColumn(
  columnId: string,
  rules: Record<string, ColumnTypeRule>
): ColumnTypeRule | null {
  if (rules[columnId]) {
    return rules[columnId];
  }

  const suffixMatches = Object.entries(rules).filter(([key]) => {
    const normalized = key.trim().toLowerCase();
    return normalized.endsWith(`.${columnId.toLowerCase()}`);
  });
  if (suffixMatches.length === 0) {
    return null;
  }
  if (suffixMatches.length === 1) {
    return suffixMatches[0][1];
  }

  const preferred = suffixMatches.find(([key]) => key.trim().toLowerCase().startsWith("dataset."));
  return (preferred ?? suffixMatches[0])[1];
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

function matchesThreshold(rule: ColumnTypeRule, value: number): boolean {
  const gte = typeof rule.threshold?.gte === "number" ? rule.threshold.gte : undefined;
  const lte = typeof rule.threshold?.lte === "number" ? rule.threshold.lte : undefined;
  if (gte === undefined && lte === undefined) {
    return true;
  }
  if (gte !== undefined && value < gte) {
    return false;
  }
  if (lte !== undefined && value > lte) {
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

function parseConditionOperator(raw: unknown): "eq" | "neq" | "lt" | "gt" | "lte" | "gte" {
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

function matchesConditionClause(args: {
  op: "eq" | "neq" | "lt" | "gt" | "lte" | "gte";
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

function evaluateCondition(
  rule: ColumnTypeRule,
  row: GenericReportRow,
  resolveField: (field: string) => string
): { include: boolean; color?: string; conditionIndex: number } | null {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  for (let conditionIndex = 0; conditionIndex < conditions.length; conditionIndex += 1) {
    const condition = conditions[conditionIndex];
    const isMatch = condition.all.every((clause) => {
      const left = row[resolveField(clause.field)];
      const compareFieldRaw = String(clause.value_field ?? "").trim();
      const right = compareFieldRaw
        ? row[resolveField(compareFieldRaw)]
        : clause.value;
      return matchesConditionClause({ op: clause.op, left, right });
    });
    if (isMatch) {
      return { include: condition.include !== false, color: condition.color, conditionIndex };
    }
  }
  return null;
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

function inferColumnType(columnId: string, rows: GenericReportRow[]): "text" | "number" | "percent" {
  const normalized = columnId.trim().toLowerCase();
  if (normalized.endsWith("_id") || normalized.endsWith("_code")) {
    return "text";
  }
  if (
    normalized.startsWith("perc_") ||
    normalized.endsWith("_percent") ||
    normalized.endsWith("_pct") ||
    normalized.endsWith("_rate")
  ) {
    return "percent";
  }

  const sampleValues = rows
    .map((row) => row[columnId])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .slice(0, 20);
  if (sampleValues.length === 0) {
    return "text";
  }

  const numericValues = sampleValues.map((value) => toNumber(value)).filter((value) => value !== null);
  if (numericValues.length === sampleValues.length) {
    return "number";
  }
  return "text";
}

function rowKey(row: GenericReportRow, index: number): string {
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

function parseComponentCode(raw: unknown, source: string): string {
  const componentCode = String(raw ?? "").trim();
  if (!componentCode) {
    throw new Error(`Missing component_code from ${source}`);
  }
  return componentCode;
}

function componentEndpoint(componentCode: string): string {
  return `/api/reports/components/${componentCode.replace(/_/g, "-")}`;
}

function parseResolvedComponents(response: ComponentResolveResponse): ResolvedComponent[] {
  const candidates = Array.isArray(response.components) && response.components.length > 0
    ? response.components
    : [
        {
          component_code: response.component_code,
          report_component_id: response.report_component_id,
          report_id: response.report_id,
          component_order: 1,
        },
      ];

  const parsed = candidates
    .map((raw, index) => {
      const componentCode = String(raw.component_code ?? "").trim();
      const reportComponentId = String(raw.report_component_id ?? "").trim();
      const reportId = String(raw.report_id ?? "").trim();
      const orderRaw = Number(raw.component_order);
      if (!componentCode || !reportComponentId) {
        return null;
      }
      return {
        componentCode,
        reportComponentId,
        reportId,
        componentOrder: Number.isFinite(orderRaw) ? orderRaw : index + 1,
      } satisfies ResolvedComponent;
    })
    .filter((item): item is ResolvedComponent => item !== null)
    .sort((a, b) => {
      if (a.componentOrder !== b.componentOrder) {
        return a.componentOrder - b.componentOrder;
      }
      return a.reportComponentId.localeCompare(b.reportComponentId);
    });

  if (parsed.length === 0) {
    throw new Error("No active components configured for this report");
  }
  return parsed;
}

export default function ReportDynamicPageClient({ route, isAdmin }: { route: string; isAdmin: boolean }) {
  const searchParams = useSearchParams();
  const [reportId, setReportId] = useState<string | null>(null);

  const fetchRows = useCallback(
    async ({
      searchParams,
      anonymize,
    }: {
      searchParams: URLSearchParams | Readonly<URLSearchParams>;
      anonymize: boolean;
    }) => {
      const params = new URLSearchParams({
        route,
        include_meta: "1",
        include_rows: "1",
        anonymize: anonymize ? "1" : "0",
      });

      for (const [key, value] of searchParams.entries()) {
        if (!value || RESERVED_QUERY_KEYS.has(key)) {
          continue;
        }
        params.set(key, value);
      }

      const resolveRes = await fetch(
        `/api/reports/components/resolve?route=${encodeURIComponent(route)}`,
        { cache: "no-store" }
      );
      const resolveJson = (await resolveRes.json()) as ComponentResolveResponse;
      if (!resolveRes.ok || !resolveJson.ok) {
        throw new Error(resolveJson.error || "Failed to resolve report components");
      }

      const resolvedComponents = parseResolvedComponents(resolveJson);
      const nextReportId = resolvedComponents.find((item) => item.reportId)?.reportId ?? "";
      setReportId(nextReportId || null);

      const componentData = await Promise.all(
        resolvedComponents.map(async (component): Promise<ResolvedComponentData> => {
          const endpoint = componentEndpoint(component.componentCode);
          const componentParams = new URLSearchParams(params.toString());
          componentParams.set("component_code", component.componentCode);
          componentParams.set("report_component_id", component.reportComponentId);

          const res = await fetch(`${endpoint}?${componentParams.toString()}`);
          const json = (await res.json()) as GenericReportResponse;
          if (!res.ok || !json.ok) {
            throw new Error(
              json.error ||
                `Failed to load component ${component.componentCode} (${component.reportComponentId})`
            );
          }

          const rows = Array.isArray(json.data) ? json.data : EMPTY_ROWS;
          const selectedColumns = Array.isArray(json.meta?.selected_columns)
            ? json.meta.selected_columns
                .map((value) => String(value ?? "").trim())
                .filter((value) => value.length > 0)
            : [];
          const discoveredColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
          const resolvedCode = parseComponentCode(
            json.meta?.component_code,
            `${endpoint} response meta.component_code`
          );

          return {
            key: component.reportComponentId,
            reportComponentId: component.reportComponentId,
            componentCode: resolvedCode,
            rows,
            columnIds: selectedColumns.length > 0 ? selectedColumns : discoveredColumns,
            columnTypeRules: readColumnTypeRules(json.meta),
          };
        })
      );

      return componentData;
    },
    [route]
  );

  const { reportTitle, reportDescription, loading, error, rows } = useReportPageData<ResolvedComponentData>({
    route,
    searchParams,
    initialTitle: toTitleCase(route),
    initialDescription: null,
    initialRows: EMPTY_COMPONENT_DATA,
    rowsOnFetchError: EMPTY_COMPONENT_DATA,
    fetchRows,
  });

  const resolvedRows = rows ?? EMPTY_COMPONENT_DATA;
  const componentViews = useMemo<ComponentViewModel[]>(() => {
    return resolvedRows.map((component): ComponentViewModel => {
      const safeRows = component.rows ?? EMPTY_ROWS;
      const columnIds = component.columnIds;
      const columnTypeRules = component.columnTypeRules;

      const totalsByColumn: Record<string, number> = {};
      const maxByColumn: Record<string, number> = {};
      for (const columnId of columnIds) {
        let sum = 0;
        let max = 0;
        for (const row of safeRows) {
          const value = toNumber(row[columnId]);
          if (value !== null) {
            sum += value;
            max = Math.max(max, value);
          }
        }
        totalsByColumn[columnId] = sum;
        maxByColumn[columnId] = max;
      }

      const rowFieldKeys = new Set(Object.keys(safeRows[0] ?? {}));
      const maxByField: Record<string, number> = {};
      for (const key of rowFieldKeys) {
        let max = 0;
        for (const row of safeRows) {
          const value = toNumber(row[key]);
          if (value !== null) {
            max = Math.max(max, value);
          }
        }
        maxByField[key] = max;
      }

      const columns: ReportComponentTableColumn<GenericReportRow>[] = columnIds.map(
        (columnId): ReportComponentTableColumn<GenericReportRow> => {
        const rule = resolveRuleForColumn(columnId, columnTypeRules);
        const base: ReportComponentTableColumn<GenericReportRow> = {
          id: columnId,
          header: toTitleCase(columnId),
          accessor: columnId as keyof GenericReportRow,
          columnType: inferColumnType(columnId, safeRows),
          sortable: true,
        };

        if (!rule) {
          return base;
        }

        if (rule.type === "threshold") {
          const gte = typeof rule.threshold?.gte === "number" ? rule.threshold.gte : null;
          const lte = typeof rule.threshold?.lte === "number" ? rule.threshold.lte : null;
          const cutoff = gte ?? lte;
          if (cutoff === null) {
            return base;
          }
          return {
            ...base,
            columnType: "threshold",
            fractionDigits: rule.fraction_digits ?? 2,
            threshold: {
              cutoff,
              comparison: lte !== null && gte === null ? "lte" : "gte",
              format: rule.display === "percentage" ? "percent" : "number",
              fractionDigits: rule.fraction_digits ?? 2,
            },
          };
        }

        if (rule.type === "pill") {
          return {
            ...base,
            columnType: "pill",
            pill: {
              getLabel: (value) => toPillDisplayLabel(value, rule.display),
              getTone: (value) => resolvePillColorForValue(rule.colors_by_value ?? {}, value),
            },
          };
        }

        if (rule.type === "percentage_of_total_bar") {
          const total = totalsByColumn[columnId] ?? 0;
          return {
            ...base,
            columnType: "custom",
            sortValue: (row) => toNumber(row[columnId]) ?? Number.NEGATIVE_INFINITY,
            render: (row) => {
              const value = toNumber(row[columnId]);
              if (value === null) {
                return "-";
              }
              const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
              const pctLabel = `${(pct * 100).toFixed(1)}%`;
              return (
                <div className="min-w-[140px]">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span>{formatNumber(value, 2)}</span>
                    <span style={{ color: "var(--app-text-muted)" }}>{pctLabel}</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded"
                    style={{ backgroundColor: "var(--app-surface-muted)" }}
                  >
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

        if (rule.type === "conditional_bar" && component.componentCode === "conditional_bar") {
          const valueField = resolveFieldKey({
            preferred: rule.value_from,
            availableKeys: rowFieldKeys,
            fallback: columnId,
          });
          const thresholdField = resolveFieldKey({
            preferred: rule.threshold_from ?? rule.value_from,
            availableKeys: rowFieldKeys,
            fallback: valueField,
          });
          const digits = rule.fraction_digits ?? 2;
          const fallbackBarMax =
            rule.display === "percentage"
              ? 1
              : Math.max(maxByField[valueField] ?? maxByColumn[columnId] ?? 0, 1);
          const denominator = Math.max(
            typeof rule.bar_max === "number" && Number.isFinite(rule.bar_max) && rule.bar_max > 0
              ? rule.bar_max
              : fallbackBarMax,
            1e-9
          );
          return {
            ...base,
            columnType: "custom",
            sortValue: (row) => toNumber(row[valueField]) ?? Number.NEGATIVE_INFINITY,
            render: (row) => {
              const value = toNumber(row[valueField]);
              if (value === null) {
                return "-";
              }
              const pct = Math.max(0, Math.min(1, value / denominator));
              const thresholdValue = toNumber(row[thresholdField]);
              const isMatch = thresholdValue !== null ? matchesThreshold(rule, thresholdValue) : false;
              const barColor = isMatch
                ? resolveBarColor(rule.color)
                : resolveBarColor(rule.color_else);
              const label =
                rule.display === "percentage"
                  ? `${(value * 100).toFixed(digits)}%`
                  : formatNumber(value, digits);

              return (
                <div className="min-w-[140px]">
                  <div className="mb-1 text-xs">{label}</div>
                  <div
                    className="h-2 w-full overflow-hidden rounded"
                    style={{ backgroundColor: "var(--app-surface-muted)" }}
                  >
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

        if (rule.type === "number" || rule.type === "percent" || rule.type === "text") {
          return {
            ...base,
            columnType: rule.type,
            ...(rule.type === "number" || rule.type === "percent"
              ? { fractionDigits: rule.fraction_digits ?? 2 }
              : {}),
          };
        }

        return base;
        }
      );

      const standaloneConditionalBarRows = component.componentCode !== "conditional_bar"
        ? []
        : (() => {
            const conditionalEntry = Object.entries(columnTypeRules).find(([, rule]) => rule.type === "conditional_bar");
            if (!conditionalEntry) {
              return [] as Array<{ key: string; label: string; valueLabel: string; widthPct: number; color: string }>;
            }

            const [ruleColumnKey, rule] = conditionalEntry;
            const availableKeys = new Set(Object.keys(safeRows[0] ?? {}));
            const valueField = resolveFieldKey({
              preferred: rule.value_from || ruleColumnKey,
              availableKeys,
              fallback: ruleColumnKey,
            });
            const thresholdField = resolveFieldKey({
              preferred: rule.threshold_from || rule.value_from || ruleColumnKey,
              availableKeys,
              fallback: valueField,
            });
            const labelField = resolveFieldKey({
              preferred: rule.label_from,
              availableKeys,
              fallback: "sis_user_id",
            });
            const digits = rule.fraction_digits ?? 2;
            const fallbackBarMax =
              rule.display === "percentage" ? 1 : Math.max(maxByField[valueField] ?? 0, 1);
            const denominator = Math.max(
              typeof rule.bar_max === "number" && Number.isFinite(rule.bar_max) && rule.bar_max > 0
                ? rule.bar_max
                : fallbackBarMax,
              1e-9
            );

            return safeRows
              .map((row, index) => {
                const value = toNumber(row[valueField]);
                if (value === null) {
                  return null;
                }
                const matchedCondition = evaluateCondition(rule, row, (field) =>
                  resolveFieldKey({ preferred: field, availableKeys, fallback: field })
                );
                if (matchedCondition && !matchedCondition.include) {
                  return null;
                }
                const thresholdValue = toNumber(row[thresholdField]);
                const isMatch = thresholdValue !== null ? matchesThreshold(rule, thresholdValue) : false;
                const color = matchedCondition?.color
                  ? resolveBarColor(matchedCondition.color)
                  : (isMatch
                      ? resolveBarColor(rule.color)
                      : resolveBarColor(rule.color_else));
                const widthPct = Math.max(0, Math.min(100, (value / denominator) * 100));
                const rawLabel = row[labelField];
                const label = String(rawLabel ?? row.sis_user_id ?? `row-${index + 1}`).trim() || `row-${index + 1}`;
                const valueLabel =
                  rule.display === "percentage"
                    ? `${(value * 100).toFixed(digits)}%`
                    : formatNumber(value, digits);
                return {
                  key: rowKey(row, index),
                  label,
                  valueLabel,
                  widthPct,
                  color,
                  value,
                  conditionOrder: matchedCondition?.conditionIndex ?? (Array.isArray(rule.conditions) ? rule.conditions.length : 0),
                };
              })
              .filter((row): row is { key: string; label: string; valueLabel: string; widthPct: number; color: string; value: number; conditionOrder: number } => row !== null)
              .sort((a, b) => {
                if (a.conditionOrder !== b.conditionOrder) {
                  return a.conditionOrder - b.conditionOrder;
                }
                return b.value - a.value;
              })
              .map(({ value, conditionOrder, ...rest }) => rest);
          })();

      return {
        key: component.key,
        componentCode: component.componentCode,
        rows: safeRows,
        rowCount: safeRows.length,
        columns,
        defaultSortColumnId: columns[0]?.id ?? "id",
        standaloneConditionalBarRows,
        standaloneConditionalBarSegments: standaloneConditionalBarRows.map((row) => ({
          key: row.key,
          color: row.color,
          title: `${row.label}: ${row.valueLabel}`,
        })),
      };
    });
  }, [resolvedRows]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ReportHeader
        title={reportTitle}
        description={reportDescription}
        action={
          isAdmin && reportId ? (
            <EditAction
              href={`/reports/${reportId}/edit`}
              ariaLabel="Edit report"
              title="Edit report"
              className="text-sm"
              style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
            />
          ) : null
        }
      />

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      {loading && (
        <ReportContainer className="mt-5">
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Loading...
          </div>
        </ReportContainer>
      )}

      {!loading && componentViews.length === 0 && (
        <ReportContainer className="mt-5">
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No components configured for this report.
          </div>
        </ReportContainer>
      )}

      {!loading &&
        componentViews.map((view, index) => (
          <ReportContainer className={index === 0 ? "mt-5" : "mt-4"} key={view.key}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {view.componentCode === "conditional_bar" ? "Conditional Bars" : "Report Data"}
              </h2>
              <MetaChip>Rows: {view.rowCount}</MetaChip>
            </div>

            {view.componentCode !== "conditional_bar" && view.columns.length === 0 && (
              <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
                No columns configured for this component.
              </div>
            )}

            {view.componentCode === "conditional_bar" && (
              <ReportComponentConditionalBar
                rows={view.standaloneConditionalBarRows}
                segments={view.standaloneConditionalBarSegments}
              />
            )}

            {view.componentCode !== "conditional_bar" && view.columns.length > 0 && (
              <ReportComponentTableRuntime
                rows={view.rows}
                columns={view.columns}
                defaultSortColumnId={view.defaultSortColumnId}
                rowKey={rowKey}
              />
            )}
          </ReportContainer>
        ))}
    </div>
  );
}


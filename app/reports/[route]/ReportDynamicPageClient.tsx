"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { MetaChip } from "../_components/MetaChip";
import { EditAction } from "../_components/EditAction";
import type { PillTone } from "../_components/Pill";
import { ReportComponentTable, type ReportComponentTableColumn } from "../_components/ReportComponentTable";
import { useReportPageData } from "../_hooks/useReportPageData";

type GenericReportRow = Record<string, unknown>;

type GenericReportResponse = {
  ok: boolean;
  count: number;
  data: GenericReportRow[];
  meta?: Record<string, unknown> & {
    report_id?: unknown;
    report_component_id?: unknown;
    selected_columns?: unknown;
    report_component_settings?: unknown;
    component_settings?: unknown;
  };
  error?: string;
};

const EMPTY_ROWS: GenericReportRow[] = [];
const RESERVED_QUERY_KEYS = new Set(["route", "include_meta", "include_rows", "anonymize"]);

type ColumnTypeRule = {
  type: string;
  threshold?: {
    gte?: number;
    lte?: number;
  };
  display?: "percentage" | "number" | "raw" | "title_case";
  fraction_digits?: number;
  colors_by_value?: Record<string, string>;
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

export default function ReportDynamicPageClient({ route, isAdmin }: { route: string; isAdmin: boolean }) {
  const searchParams = useSearchParams();
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const [columnTypeRules, setColumnTypeRules] = useState<Record<string, ColumnTypeRule>>({});
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportComponentId, setReportComponentId] = useState<string | null>(null);

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

      const res = await fetch(`/api/reports/components/table?${params.toString()}`);
      const json = (await res.json()) as GenericReportResponse;
      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }

      const rows = Array.isArray(json.data) ? json.data : EMPTY_ROWS;
      const selectedColumns = Array.isArray(json.meta?.selected_columns)
        ? json.meta.selected_columns
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0)
        : [];
      const discoveredColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
      setColumnIds(selectedColumns.length > 0 ? selectedColumns : discoveredColumns);
      setColumnTypeRules(readColumnTypeRules(json.meta));
      const nextReportId = String(json.meta?.report_id ?? "").trim();
      const nextReportComponentId = String(json.meta?.report_component_id ?? "").trim();
      setReportId(nextReportId || null);
      setReportComponentId(nextReportComponentId || null);

      return rows;
    },
    [route]
  );

  const { reportTitle, reportDescription, loading, error, rows } = useReportPageData<GenericReportRow>({
    route,
    searchParams,
    initialTitle: toTitleCase(route),
    initialDescription: null,
    initialRows: EMPTY_ROWS,
    rowsOnFetchError: EMPTY_ROWS,
    fetchRows,
  });

  const safeRows = rows ?? EMPTY_ROWS;
  const totalsByColumn = useMemo<Record<string, number>>(() => {
    const totals: Record<string, number> = {};
    for (const columnId of columnIds) {
      let sum = 0;
      for (const row of safeRows) {
        const value = toNumber(row[columnId]);
        if (value !== null) {
          sum += value;
        }
      }
      totals[columnId] = sum;
    }
    return totals;
  }, [columnIds, safeRows]);

  const columns = useMemo<ReportComponentTableColumn<GenericReportRow>[]>(() => {
    return columnIds.map((columnId) => {
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
    });
  }, [columnIds, columnTypeRules, safeRows, totalsByColumn]);

  const defaultSortColumnId = columns[0]?.id ?? "id";

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ReportHeader title={reportTitle} description={reportDescription} />
      {isAdmin && reportId && reportComponentId && (
        <div className="mt-2">
          <EditAction
            href={`/reports/${reportId}/edit`}
            ariaLabel="Edit report"
            title="Edit report"
            className="text-sm"
            style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
          />
        </div>
      )}

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      <ReportContainer className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Report Data</h2>
          <MetaChip>Rows: {safeRows.length}</MetaChip>
        </div>

        {loading && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Loading...
          </div>
        )}

        {!loading && columns.length === 0 && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No columns configured for this report.
          </div>
        )}

        {columns.length > 0 && (
          <ReportComponentTable
            rows={safeRows}
            columns={columns}
            defaultSort={{ columnId: defaultSortColumnId, direction: "asc" }}
            rowKey={rowKey}
            emptyText="No data found for the selected filters."
          />
        )}
      </ReportContainer>
    </div>
  );
}

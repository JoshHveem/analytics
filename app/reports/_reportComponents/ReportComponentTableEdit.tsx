"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_COLORS } from "@/lib/color-palette";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { EditAction } from "../_components/EditAction";
import ColorSelectionDropdown, { PILL_COLOR_GROUPS } from "../_components/ColorSelectionDropdown";
import type { PillTone } from "../_components/Pill";
import { ReportComponentTable, type ReportComponentTableColumn } from "./ReportComponentTable";

type AvailableColumn = {
  key: string;
  dataset_key: string;
  column: string;
  source_schema: string;
  selected: boolean;
};

type ColumnTypeDraft = {
  type: "" | "threshold" | "percentage_of_total_bar" | "number" | "percent" | "text" | "pill";
  gte: string;
  lte: string;
  display: "percentage" | "number" | "raw" | "title_case";
  fraction_digits: string;
  colors_by_value: Record<string, string>;
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
  return {
    type,
    gte,
    lte,
    display,
    fraction_digits,
    colors_by_value,
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

  return null;
}

function parseSelectedKey(key: string): { datasetKey: string; column: string } {
  const [datasetKey, column] = String(key ?? "").trim().split(".");
  return {
    datasetKey: datasetKey ?? "",
    column: column ?? "",
  };
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

export default function ReportComponentTableEdit(args: {
  reportId: string;
  reportComponentId: string;
}) {
  const { reportId, reportComponentId } = args;
  const configApiPath = "/api/reports/components/table-config";
  const dataApiPath = "/api/reports/components/table";
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

      const nextRoute = String(json.config.route ?? "");
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

  function updateDraft(key: string, update: Partial<ColumnTypeDraft>) {
    setColumnTypeDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? createEmptyDraft()),
        ...update,
      },
    }));
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Drag headers left/right to reorder columns. Columns are managed in the sidebar "Columns" tab. Click "Edit" on a header to configure that column.
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

        {previewColumns.length > 0 && (
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
                <h2 className="text-sm font-semibold">Edit Column Settings</h2>
                <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                  {activeColumn.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveColumnKey(null)}
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
    </div>
  );
}




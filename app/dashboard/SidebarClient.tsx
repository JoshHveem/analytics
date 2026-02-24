"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReportCategory } from "@/lib/report-catalog";
import { InfoModalTrigger } from "@/app/_components/InfoModalTrigger";
import { applyAppTheme } from "@/lib/color-palette";
import { publishReportFiltersReady } from "@/app/reports/filter-readiness";
import SettingsIcon from "./SettingsIcon";

type SidebarClientProps = {
  categories: ReportCategory[];
};

type ReportFilterMenuItem = {
  filter_code: string;
  type: string;
  label: string;
  description: string | null;
  table: string | null;
  column: string | null;
  settings?: {
    default_value: string | null;
    include_all: boolean;
  } | null;
};

type ReportConfigResponse = {
  ok: boolean;
  config?: {
    id: string;
    filters: Array<{
      filter_code: string;
      type: string;
      label: string;
      description: string | null;
      table: string | null;
      column: string | null;
      settings?: {
        default_value: string | null;
        include_all: boolean;
      } | null;
    }>;
  };
};

type ReportMetaResponse = {
  ok: boolean;
  meta?: Record<string, unknown> & {
    selected?: Record<string, unknown> | null;
  };
};

type UserSettingsResponse = {
  ok: boolean;
  settings?: {
    dark_mode: boolean;
    anonymize: boolean;
  };
  error?: string;
};

type EditAvailableColumn = {
  key: string;
  dataset_key: string;
  column: string;
  source_schema: string;
  selected: boolean;
};

type TableConfigResponse = {
  ok: boolean;
  config?: {
    report_id: string;
    report_component_id: string;
    route: string;
    component_code: string;
    selected_columns: string[];
    available_columns: EditAvailableColumn[];
    column_types: Record<string, unknown>;
  };
  error?: string;
};

type ReportPathContext = {
  reportRoute: string | null;
  isReportEdit: boolean;
  isComponentEdit: boolean;
  reportComponentId: string | null;
};

type ReportEditableFilterItem = {
  filter_code: string;
  label: string;
  description: string | null;
  type: string;
  table: string | null;
  column: string | null;
  selected: boolean;
  settings?: {
    default_value: string | null;
    include_all: boolean;
  } | null;
};

type ReportEditorFiltersResponse = {
  ok: boolean;
  report?: {
    report_id: string;
    route: string;
  };
  available_filters?: ReportEditableFilterItem[];
  selected_filters?: string[];
  error?: string;
};

type SelectFilterSettingsDraft = {
  default_value: string;
  include_all: boolean;
};

function toReportFilterMenuItem(filter: {
  filter_code: string;
  type?: string | null;
  label?: string | null;
  description?: string | null;
  table?: string | null;
  column?: string | null;
  settings?: {
    default_value: string | null;
    include_all: boolean;
  } | null;
}): ReportFilterMenuItem {
  return {
    filter_code: String(filter.filter_code),
    type: String(filter.type ?? "select"),
    label: String(filter.label ?? filter.filter_code),
    description: filter.description ?? null,
    table: filter.table ?? null,
    column: filter.column ?? null,
    settings: filter.settings ?? null,
  };
}

function toSelectFilterSettingsDraft(
  filter: ReportEditableFilterItem
): SelectFilterSettingsDraft {
  const settings = filter.settings ?? null;
  const defaultValueRaw = settings?.default_value;
  const default_value =
    defaultValueRaw === null || defaultValueRaw === undefined
      ? ""
      : String(defaultValueRaw);
  return {
    default_value,
    include_all: settings?.include_all === true,
  };
}

const EDIT_COLUMNS_STATE_EVENT = "analytics:report-component-edit-state";
const EDIT_COLUMNS_CHANGE_EVENT = "analytics:report-component-edit-columns-change";
const EDIT_COMPONENT_SAVE_REQUEST_EVENT = "analytics:report-component-edit-save-request";
const EDIT_COMPONENT_RESET_REQUEST_EVENT = "analytics:report-component-edit-reset-request";
const REPORT_EDIT_STATE_EVENT = "analytics:report-edit-state";
const REPORT_EDIT_SAVE_REQUEST_EVENT = "analytics:report-edit-save-request";
const REPORT_EDIT_RESET_REQUEST_EVENT = "analytics:report-edit-reset-request";
const SIDEBAR_WIDTH_STORAGE_KEY = "analytics-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(value)));
}

async function fetchReportFilterMeta(args: {
  reportId: string;
  params: URLSearchParams;
}): Promise<ReportMetaResponse> {
  const { reportId, params } = args;
  const query = new URLSearchParams(params.toString());
  query.set("report_id", reportId);
  const res = await fetch(`/api/reports/filter-meta?${query.toString()}`, {
    cache: "no-store",
  });
  const json = (await res.json()) as ReportMetaResponse;
  if (res.ok && json.meta) {
    return json;
  }
  throw new Error("Report filter metadata endpoint unavailable");
}

function parseReportPathContext(pathname: string): ReportPathContext {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "reports" || parts.length < 2) {
    return {
      reportRoute: null,
      isReportEdit: false,
      isComponentEdit: false,
      reportComponentId: null,
    };
  }

  const reportRoute = parts[1];
  const isReportEdit = parts.length >= 3 && parts[2] === "edit";
  const isComponentEdit =
    parts.length >= 5 && parts[2] === "components" && parts[4] === "edit";
  const reportComponentId = isComponentEdit ? parts[3] : null;

  return {
    reportRoute,
    isReportEdit,
    isComponentEdit,
    reportComponentId,
  };
}

function normalizeFilterType(type: string | null | undefined): "select" | "multi_select" | "text" {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized === "multi_select") {
    return "multi_select";
  }
  if (normalized === "text") {
    return "text";
  }
  return "select";
}

function splitMultiValue(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeMetaSourceKeys(filter: ReportFilterMenuItem): string[] {
  const keys: string[] = [];
  const pushKey = (key: string) => {
    const normalized = key.trim().toLowerCase();
    if (!normalized || keys.includes(normalized)) {
      return;
    }
    keys.push(normalized);
  };

  const tableName = String(filter.table ?? "").trim();
  if (tableName) {
    pushKey(tableName);
    pushKey(tableName.replace(/\./g, "_"));
    const tableWithoutSchema = tableName.includes(".") ? tableName.split(".").pop() ?? "" : tableName;
    pushKey(tableWithoutSchema);
  }

  const param = filter.filter_code;
  if (param === "academic_year") {
    pushKey("years");
    return keys;
  }

  if (param.endsWith("_code")) {
    pushKey(`${param.replace(/_code$/, "")}s`);
    return keys;
  }

  if (param.endsWith("y")) {
    pushKey(`${param.slice(0, -1)}ies`);
    return keys;
  }

  pushKey(`${param}s`);
  return keys;
}

function optionsFromMetaSource(raw: unknown, valueKeyHint?: string | null): Array<{ value: string; label: string }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const first = raw[0];
  if (typeof first === "string" || typeof first === "number") {
    return raw.map((item) => {
      const value = String(item ?? "");
      return { value, label: value };
    });
  }

  if (!first || typeof first !== "object") {
    return [];
  }

  const firstRecord = first as Record<string, unknown>;
  const recordKeys = Object.keys(firstRecord);
  const inferredValueKey =
    recordKeys.find((key) => key.endsWith("_code")) ??
    recordKeys.find((key) => key === "code" || key.endsWith("_id")) ??
    recordKeys[0];
  const valueCandidates = [
    String(valueKeyHint ?? "").trim(),
    "value",
    "id",
    inferredValueKey,
  ].filter((key) => key.length > 0);
  const valueKey = valueCandidates.find((key) => key in firstRecord);
  if (!valueKey) {
    return [];
  }

  const codeNameCandidate = valueKey.endsWith("_code")
    ? valueKey.replace(/_code$/, "_name")
    : "";
  const idNameCandidate = valueKey.endsWith("_id")
    ? valueKey.replace(/_id$/, "_name")
    : "";
  const labelCandidates = [
    "label",
    "name",
    codeNameCandidate,
    idNameCandidate,
    recordKeys.find((key) => key.endsWith("_name")) ?? "",
    valueKey,
  ].filter((key) => key.length > 0);
  const labelKey = labelCandidates.find((key) => key in firstRecord) ?? valueKey;

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const value = String(record[valueKey] ?? "").trim();
      if (!value) {
        return null;
      }
      const label = String(record[labelKey] ?? value).trim() || value;
      return { value, label };
    })
    .filter((option): option is { value: string; label: string } => option !== null);
}

function filterOptionsFromMeta(
  filter: ReportFilterMenuItem,
  filterMeta: Record<string, unknown>
): Array<{ value: string; label: string }> {
  const sourceKeys = normalizeMetaSourceKeys(filter);
  const source = sourceKeys.find((key) => key in filterMeta);
  const fallbackKey =
    source ??
    Object.keys(filterMeta).find((metaKey) => sourceKeys.includes(metaKey.trim().toLowerCase()));
  const raw = fallbackKey ? filterMeta[fallbackKey] : undefined;
  return optionsFromMetaSource(raw, filter.column);
}

function resolveFilterDefaultsIntoQuery(args: {
  currentParams: URLSearchParams;
  filters: ReportFilterMenuItem[];
  selectedByMeta: Record<string, string | null>;
  meta: Record<string, unknown>;
}): URLSearchParams | null {
  const { currentParams, filters, selectedByMeta, meta } = args;
  const nextParams = new URLSearchParams(currentParams.toString());
  let changed = false;

  for (const filter of filters) {
    const filterCode = String(filter.filter_code ?? "").trim();
    if (!filterCode || nextParams.has(filterCode)) {
      continue;
    }

    const selectedValue = String(selectedByMeta[filterCode] ?? "").trim();
    const defaultValue = String(filter.settings?.default_value ?? "").trim();
    const filterType = normalizeFilterType(filter.type);
    const includeAllEnabled = filter.settings?.include_all === true;
    let resolvedValue = selectedValue || defaultValue;

    if (!resolvedValue && filterType === "select" && !includeAllEnabled) {
      const options = filterOptionsFromMeta(filter, meta);
      resolvedValue = String(options[0]?.value ?? "").trim();
    }

    if (!resolvedValue) {
      continue;
    }

    nextParams.set(filterCode, resolvedValue);
    changed = true;
  }

  return changed ? nextParams : null;
}

function groupedColumns(columns: EditAvailableColumn[]): Array<[string, EditAvailableColumn[]]> {
  const byDataset = new Map<string, EditAvailableColumn[]>();
  for (const column of columns) {
    const datasetKey = `${column.source_schema}.${column.dataset_key}`;
    const existing = byDataset.get(datasetKey) ?? [];
    existing.push(column);
    byDataset.set(datasetKey, existing);
  }
  return Array.from(byDataset.entries())
    .map(([datasetKey, datasetColumns]) => [
      datasetKey,
      [...datasetColumns].sort((a, b) => a.column.localeCompare(b.column)),
    ] as [string, EditAvailableColumn[]])
    .sort(([left], [right]) => left.localeCompare(right));
}

function SettingToggle({
  label,
  enabled,
  onToggle,
  switchAriaLabel,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  switchAriaLabel: string;
}) {
  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--app-border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium" style={{ color: "var(--app-text-strong)" }}>
            {label}
          </div>
          <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
            {enabled ? "Enabled" : "Disabled"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={switchAriaLabel}
          onClick={onToggle}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          style={{ backgroundColor: enabled ? "var(--app-control-track-active)" : "var(--app-control-track)" }}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
              enabled ? "translate-x-5" : "translate-x-1"
            }`}
            style={{ backgroundColor: "var(--app-control-thumb)" }}
          />
        </button>
      </div>
    </div>
  );
}

function isMenuModeAvailable(
  menuMode: "reports" | "filters" | "columns" | "settings",
  args: {
    reportRoute: string | null;
    isComponentEditMode: boolean;
  }
): boolean {
  if (menuMode === "filters") {
    return Boolean(args.reportRoute);
  }
  if (menuMode === "columns") {
    return args.isComponentEditMode;
  }
  return true;
}

function NavIcon({
  name,
  className,
}: {
  name: "home" | "reports" | "filters" | "columns";
  className?: string;
}) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M3 11.5L12 4l9 7.5" />
        <path d="M6.75 10.75V20h10.5v-9.25" />
      </svg>
    );
  }
  if (name === "reports") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M5 4.75h14v14.5H5z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </svg>
    );
  }
  if (name === "filters") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M4 6.5h16M7.5 12h9M10.5 17.5h3" />
      </svg>
    );
  }
  if (name === "columns") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
        <path d="M4.5 5h15v14h-15z" />
        <path d="M10 5v14M14 5v14" />
      </svg>
    );
  }
  return null;
}

export default function SidebarClient({ categories }: SidebarClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportPathContext = useMemo(() => parseReportPathContext(pathname), [pathname]);
  const reportRoute = reportPathContext.reportRoute;
  const isReportEditMode = reportPathContext.isReportEdit;
  const isComponentEditMode = reportPathContext.isComponentEdit;
  const isReportOrComponentEditMode = isReportEditMode || isComponentEditMode;
  const reportComponentId = reportPathContext.reportComponentId;
  const queryKey = searchParams.toString();
  const [reportId, setReportId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReportFilterMenuItem[]>([]);
  const [menuMode, setMenuMode] = useState<"reports" | "filters" | "columns" | "settings">(
    isComponentEditMode ? "columns" : reportRoute ? "filters" : "reports"
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterMeta, setFilterMeta] = useState<Record<string, unknown>>({});
  const [loadingFilterConfig, setLoadingFilterConfig] = useState(false);
  const [loadingFilterData, setLoadingFilterData] = useState(false);
  const [syncingFilterDefaults, setSyncingFilterDefaults] = useState(false);
  const [filterConfigResolved, setFilterConfigResolved] = useState(false);
  const [filterMetaResolved, setFilterMetaResolved] = useState(false);
  const [loadingEditColumns, setLoadingEditColumns] = useState(false);
  const [editAvailableColumns, setEditAvailableColumns] = useState<EditAvailableColumn[]>([]);
  const [editSelectedColumns, setEditSelectedColumns] = useState<string[]>([]);
  const [loadingEditFilters, setLoadingEditFilters] = useState(false);
  const [savingEditFilters, setSavingEditFilters] = useState(false);
  const [editFilterError, setEditFilterError] = useState<string | null>(null);
  const [editFilterMessage, setEditFilterMessage] = useState<string | null>(null);
  const [editAvailableFilters, setEditAvailableFilters] = useState<ReportEditableFilterItem[]>([]);
  const [editSelectedFilters, setEditSelectedFilters] = useState<string[]>([]);
  const [editFilterSettings, setEditFilterSettings] = useState<Record<string, SelectFilterSettingsDraft>>({});
  const [componentEditDirty, setComponentEditDirty] = useState(false);
  const [componentEditSaving, setComponentEditSaving] = useState(false);
  const [reportEditDirty, setReportEditDirty] = useState(false);
  const [reportEditSaving, setReportEditSaving] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_WIDTH);
  const [darkMode, setDarkMode] = useState(false);
  const [anonymize, setAnonymize] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadFilters() {
      if (!reportRoute) {
        setReportId(null);
        setFilters([]);
        setLoadingFilterConfig(false);
        setFilterConfigResolved(true);
        setFilterMetaResolved(true);
        return;
      }

      setFilterMetaResolved(false);
      setFilterConfigResolved(false);
      setLoadingFilterConfig(true);
      try {
        const res = await fetch(`/api/reports/config?route=${encodeURIComponent(reportRoute)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ReportConfigResponse;
        if (!res.ok || !json.config) {
          if (!cancelled) {
            setReportId(null);
            setFilters([]);
          }
          return;
        }

        if (!cancelled) {
          setReportId(String(json.config.id));
          setFilters((json.config.filters ?? []).map((f) => toReportFilterMenuItem(f)));
          setFilterMetaResolved(false);
        }
      } catch {
        if (!cancelled) {
          setReportId(null);
          setFilters([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingFilterConfig(false);
          setFilterConfigResolved(true);
        }
      }
    }

    void loadFilters();
    return () => {
      cancelled = true;
    };
  }, [reportRoute]);

  useEffect(() => {
    let cancelled = false;

    async function loadFilterMeta() {
      if (!reportRoute || !reportId) {
        setFilterMeta({});
        setLoadingFilterData(false);
        setSyncingFilterDefaults(false);
        setFilterMetaResolved(true);
        return;
      }

      setLoadingFilterData(true);
      setSyncingFilterDefaults(false);
      setFilterMetaResolved(false);
      try {
        const params = new URLSearchParams();
        params.set("include_meta", "1");
        params.set("include_rows", "0");

        for (const [key, value] of searchParams.entries()) {
          if (value) {
            params.set(key, value);
          }
        }

        const json = await fetchReportFilterMeta({ reportId, params });
        const meta = json.meta ?? {};

        if (!cancelled) {
          setFilterMeta(meta);
          const selectedRaw =
            meta.selected && typeof meta.selected === "object"
              ? (meta.selected as Record<string, unknown>)
              : {};
          const selectedByMeta: Record<string, string | null> = {};
          for (const [key, value] of Object.entries(selectedRaw)) {
            selectedByMeta[key] = value === null || value === undefined ? null : String(value);
          }
          const nextParams = resolveFilterDefaultsIntoQuery({
            currentParams: new URLSearchParams(searchParams.toString()),
            filters,
            selectedByMeta,
            meta,
          });
          if (nextParams) {
            setSyncingFilterDefaults(true);
            const nextQuery = nextParams.toString();
            router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
          } else {
            setSyncingFilterDefaults(false);
          }
        }
      } catch {
        if (!cancelled) {
          setFilterMeta({});
          setSyncingFilterDefaults(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingFilterData(false);
          setFilterMetaResolved(true);
        }
      }
    }

    void loadFilterMeta();
    return () => {
      cancelled = true;
    };
  }, [filters, pathname, reportId, reportRoute, router, searchParams]);

  const filtersReady =
    !reportRoute ||
    (
      filterConfigResolved &&
      filterMetaResolved &&
      !loadingFilterConfig &&
      !loadingFilterData &&
      !syncingFilterDefaults
    );

  useEffect(() => {
    publishReportFiltersReady(reportRoute, queryKey, filtersReady);
  }, [filtersReady, queryKey, reportRoute]);

  useEffect(() => {
    let cancelled = false;

    async function loadEditColumns() {
      if (!isComponentEditMode || !reportRoute || !reportComponentId) {
        setEditAvailableColumns([]);
        setEditSelectedColumns([]);
        return;
      }

      setLoadingEditColumns(true);
      try {
        const query = new URLSearchParams({
          report_id: reportRoute,
          report_component_id: reportComponentId,
        });
        const res = await fetch(`/api/reports/components/table-config?${query.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as TableConfigResponse;
        if (!res.ok || !json.config) {
          throw new Error(json.error || "Failed to load component columns");
        }

        if (!cancelled) {
          const availableColumns = json.config.available_columns ?? [];
          const selectedColumns = Array.from(new Set(json.config.selected_columns ?? []));
          setEditAvailableColumns(availableColumns);
          setEditSelectedColumns(selectedColumns);
        }
      } catch {
        if (!cancelled) {
          setEditAvailableColumns([]);
          setEditSelectedColumns([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingEditColumns(false);
        }
      }
    }

    void loadEditColumns();
    return () => {
      cancelled = true;
    };
  }, [isComponentEditMode, reportComponentId, reportRoute]);

  useEffect(() => {
    let cancelled = false;

    async function loadEditFilters() {
      if (!isReportOrComponentEditMode || !reportId) {
        setEditAvailableFilters([]);
        setEditSelectedFilters([]);
        setEditFilterSettings({});
        setEditFilterError(null);
        setEditFilterMessage(null);
        return;
      }

      setLoadingEditFilters(true);
      setEditFilterError(null);
      setEditFilterMessage(null);
      try {
        const query = new URLSearchParams({
          report_id: reportId,
        });
        const res = await fetch(`/api/reports/editor/filters?${query.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ReportEditorFiltersResponse;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Failed to load editable filters");
        }

        if (!cancelled) {
          const availableFilters = Array.isArray(json.available_filters) ? json.available_filters : [];
          const selectedFilters = Array.from(
            new Set((json.selected_filters ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
          );
          setEditAvailableFilters(availableFilters);
          setEditSelectedFilters(selectedFilters);
          const nextSettings: Record<string, SelectFilterSettingsDraft> = {};
          for (const filter of availableFilters) {
            const filterCode = String(filter.filter_code ?? "").trim();
            if (!filterCode) {
              continue;
            }
            if (normalizeFilterType(filter.type) !== "select") {
              continue;
            }
            nextSettings[filterCode] = toSelectFilterSettingsDraft(filter);
          }
          setEditFilterSettings(nextSettings);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setEditAvailableFilters([]);
          setEditSelectedFilters([]);
          setEditFilterSettings({});
          setEditFilterError(String(error));
        }
      } finally {
        if (!cancelled) {
          setLoadingEditFilters(false);
        }
      }
    }

    void loadEditFilters();
    return () => {
      cancelled = true;
    };
  }, [isReportOrComponentEditMode, reportId]);

  useEffect(() => {
    function handleEditState(event: Event) {
      if (!isComponentEditMode || !reportRoute || !reportComponentId) {
        return;
      }
      const customEvent = event as CustomEvent<{
        reportId?: string;
        reportComponentId?: string;
        availableColumns?: EditAvailableColumn[];
        selectedColumns?: string[];
        isDirty?: boolean;
        isSaving?: boolean;
      }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== reportRoute) {
        return;
      }
      if (String(detail.reportComponentId ?? "") !== reportComponentId) {
        return;
      }
      if (Array.isArray(detail.availableColumns)) {
        setEditAvailableColumns(detail.availableColumns);
      }
      if (Array.isArray(detail.selectedColumns)) {
        setEditSelectedColumns(Array.from(new Set(detail.selectedColumns.map((item) => String(item ?? "")))));
      }
      if (typeof detail.isDirty === "boolean") {
        setComponentEditDirty(detail.isDirty);
      }
      if (typeof detail.isSaving === "boolean") {
        setComponentEditSaving(detail.isSaving);
      }
    }

    window.addEventListener(EDIT_COLUMNS_STATE_EVENT, handleEditState as EventListener);
    return () => {
      window.removeEventListener(EDIT_COLUMNS_STATE_EVENT, handleEditState as EventListener);
    };
  }, [isComponentEditMode, reportComponentId, reportRoute]);

  useEffect(() => {
    if (!isComponentEditMode) {
      setComponentEditDirty(false);
      setComponentEditSaving(false);
    }
  }, [isComponentEditMode]);

  useEffect(() => {
    function handleReportEditState(event: Event) {
      const customEvent = event as CustomEvent<{
        reportId?: string;
        isDirty?: boolean;
        isSaving?: boolean;
      }>;
      const detail = customEvent.detail ?? {};
      if (String(detail.reportId ?? "") !== String(reportRoute ?? "")) {
        return;
      }
      if (typeof detail.isDirty === "boolean") {
        setReportEditDirty(detail.isDirty);
      }
      if (typeof detail.isSaving === "boolean") {
        setReportEditSaving(detail.isSaving);
      }
    }

    window.addEventListener(REPORT_EDIT_STATE_EVENT, handleReportEditState as EventListener);
    return () => {
      window.removeEventListener(REPORT_EDIT_STATE_EVENT, handleReportEditState as EventListener);
    };
  }, [reportRoute]);

  useEffect(() => {
    if (!isReportEditMode) {
      setReportEditDirty(false);
      setReportEditSaving(false);
    }
  }, [isReportEditMode]);

  useEffect(() => {
    if (
      !isMenuModeAvailable(menuMode, {
        reportRoute,
        isComponentEditMode,
      })
    ) {
      setMenuMode("reports");
    }
  }, [isComponentEditMode, menuMode, reportRoute]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, queryKey]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = Number(raw);
      setSidebarWidth(clampSidebarWidth(parsed));
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sidebar-width", `${clampSidebarWidth(sidebarWidth)}px`);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(sidebarWidth)));
    } catch {
      // no-op
    }
  }, [sidebarWidth]);

  useEffect(() => {
    let cancelled = false;

    async function loadUserSettings() {
      let fallbackDarkMode = false;
      let fallbackAnonymize = false;

      try {
        const savedTheme = window.localStorage.getItem("analytics-theme");
        if (savedTheme === "dark") {
          fallbackDarkMode = true;
        } else if (savedTheme === "light") {
          fallbackDarkMode = false;
        } else {
          fallbackDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
        }
      } catch {
        fallbackDarkMode = false;
      }

      try {
        fallbackAnonymize = window.localStorage.getItem("analytics-anonymize") === "1";
      } catch {
        fallbackAnonymize = false;
      }

      if (!cancelled) {
        setDarkMode(fallbackDarkMode);
        setAnonymize(fallbackAnonymize);
      }

      try {
        const res = await fetch("/api/user-settings");
        const json = (await res.json()) as UserSettingsResponse;
        if (!res.ok || !json.settings) {
          return;
        }
        if (!cancelled) {
          setDarkMode(Boolean(json.settings.dark_mode));
          setAnonymize(Boolean(json.settings.anonymize));
        }
      } catch {
        // Keep local fallback when settings endpoint is unavailable.
      } finally {
        if (!cancelled) {
          setSettingsReady(true);
        }
      }
    }

    void loadUserSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    applyAppTheme(root, darkMode ? "dark" : "light");
    root.classList.toggle("dark", darkMode);
    root.style.colorScheme = darkMode ? "dark" : "light";
    try {
      window.localStorage.setItem("analytics-theme", darkMode ? "dark" : "light");
    } catch {
      // no-op
    }
  }, [darkMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (anonymize) {
      root.setAttribute("data-anonymize", "1");
    } else {
      root.removeAttribute("data-anonymize");
    }
    try {
      window.localStorage.setItem("analytics-anonymize", anonymize ? "1" : "0");
    } catch {
      // no-op
    }
    window.dispatchEvent(
      new CustomEvent("analytics:anonymize-change", {
        detail: { enabled: anonymize },
      })
    );
  }, [anonymize]);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    void fetch("/api/user-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dark_mode: darkMode,
        anonymize,
      }),
    });
  }, [darkMode, anonymize, settingsReady]);

  function filterValue(filterCode: string): string {
    return searchParams.get(filterCode) ?? "";
  }

  function filterOptions(filter: ReportFilterMenuItem): Array<{ value: string; label: string }> {
    return filterOptionsFromMeta(filter, filterMeta);
  }

  function applyFilterChange(filterCode: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const param = filterCode;

    if (value) {
      params.set(param, value);
    } else {
      params.delete(param);
    }

    if (param === "program_code" || param === "academic_year") {
      params.delete("campus_code");
    }

    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }

  function applyMultiFilterChange(filterCode: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    const param = filterCode;
    const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);

    if (cleaned.length > 0) {
      params.set(param, cleaned.join(","));
    } else {
      params.delete(param);
    }

    if (param === "program_code" || param === "academic_year") {
      params.delete("campus_code");
    }

    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }

  function applyEditColumnChange(columnKey: string, checked: boolean) {
    if (!isComponentEditMode || !reportRoute || !reportComponentId) {
      return;
    }
    const available = new Set(editAvailableColumns.map((column) => column.key));
    if (!available.has(columnKey)) {
      return;
    }

    setEditSelectedColumns((current) => {
      const currentSet = new Set(current);
      if (checked) {
        currentSet.add(columnKey);
      } else {
        currentSet.delete(columnKey);
      }
      const next = Array.from(currentSet);
      window.dispatchEvent(
        new CustomEvent(EDIT_COLUMNS_CHANGE_EVENT, {
          detail: {
            reportId: reportRoute,
            reportComponentId,
            selectedColumns: next,
          },
        })
      );
      return next;
    });
  }

  function applyEditFilterChange(filterCode: string, checked: boolean) {
    const available = new Set(editAvailableFilters.map((filter) => String(filter.filter_code ?? "").trim()));
    if (!available.has(filterCode)) {
      return;
    }
    if (checked) {
      const filter = editAvailableFilters.find(
        (item) => String(item.filter_code ?? "").trim() === filterCode
      );
      if (filter && normalizeFilterType(filter.type) === "select") {
        setEditFilterSettings((current) => {
          if (current[filterCode]) {
            return current;
          }
          return {
            ...current,
            [filterCode]: toSelectFilterSettingsDraft(filter),
          };
        });
      }
    }
    setEditSelectedFilters((current) => {
      const nextSet = new Set(current);
      if (checked) {
        nextSet.add(filterCode);
      } else {
        nextSet.delete(filterCode);
      }
      return Array.from(nextSet).sort((left, right) => left.localeCompare(right));
    });
  }

  function applyEditFilterSettingDefaultValue(filterCode: string, value: string) {
    setEditFilterSettings((current) => ({
      ...current,
      [filterCode]: {
        default_value: value,
        include_all: current[filterCode]?.include_all ?? false,
      },
    }));
  }

  function applyEditFilterSettingIncludeAll(filterCode: string, includeAll: boolean) {
    setEditFilterSettings((current) => ({
      ...current,
      [filterCode]: {
        default_value: current[filterCode]?.default_value ?? "",
        include_all: includeAll,
      },
    }));
  }

  async function saveEditFilters() {
    if (!reportId || !isReportOrComponentEditMode) {
      return;
    }

    setSavingEditFilters(true);
    setEditFilterError(null);
    setEditFilterMessage(null);
    try {
      const filterSettingsPayload: Record<string, { default_value: string | null; include_all: boolean }> = {};
      for (const filterCode of editSelectedFilters) {
        const filter = editAvailableFilters.find(
          (item) => String(item.filter_code ?? "").trim() === filterCode
        );
        const filterType = normalizeFilterType(filter?.type);
        if (filterType !== "select") {
          continue;
        }
        const draft = editFilterSettings[filterCode];
        filterSettingsPayload[filterCode] = {
          default_value: String(draft?.default_value ?? "").trim() || null,
          include_all: draft?.include_all === true,
        };
      }
      const res = await fetch("/api/reports/editor/filters", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_id: reportId,
          selected_filters: editSelectedFilters,
          filter_settings: filterSettingsPayload,
        }),
      });
      const json = (await res.json()) as ReportEditorFiltersResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to update report filters");
      }

      const availableFilters = Array.isArray(json.available_filters) ? json.available_filters : [];
      const selectedFilters = Array.from(
        new Set((json.selected_filters ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
      );

      setEditAvailableFilters(availableFilters);
      setEditSelectedFilters(selectedFilters);
      const nextSettings: Record<string, SelectFilterSettingsDraft> = {};
      for (const filter of availableFilters) {
        const filterCode = String(filter.filter_code ?? "").trim();
        if (!filterCode) {
          continue;
        }
        if (normalizeFilterType(filter.type) !== "select") {
          continue;
        }
        nextSettings[filterCode] = toSelectFilterSettingsDraft(filter);
      }
      setEditFilterSettings(nextSettings);
      setFilters(
        availableFilters
          .filter((filter) => selectedFilters.includes(String(filter.filter_code)))
          .map((filter) => toReportFilterMenuItem(filter))
      );

      const params = new URLSearchParams(searchParams.toString());
      const selectedSet = new Set(selectedFilters);
      let paramsChanged = false;
      const managedFilterKeys = new Set([
        ...availableFilters.map((filter) => String(filter.filter_code)),
        ...filters.map((filter) => String(filter.filter_code)),
      ]);
      for (const filterCode of managedFilterKeys) {
        if (!selectedSet.has(filterCode) && params.has(filterCode)) {
          params.delete(filterCode);
          paramsChanged = true;
        }
      }
      if (paramsChanged) {
        const next = params.toString();
        router.replace(next ? `${pathname}?${next}` : pathname);
      }

      setEditFilterMessage("Report filters updated.");
    } catch (error: unknown) {
      setEditFilterError(String(error));
    } finally {
      setSavingEditFilters(false);
    }
  }

  const groupedEditColumns = useMemo(() => groupedColumns(editAvailableColumns), [editAvailableColumns]);
  const selectedEditFilterSet = useMemo(
    () => new Set(editSelectedFilters.map((filterCode) => String(filterCode))),
    [editSelectedFilters]
  );
  const editableFilterCodeSet = useMemo(
    () => new Set(editAvailableFilters.map((filter) => String(filter.filter_code))),
    [editAvailableFilters]
  );
  const activeEditableFilters = useMemo(
    () =>
      editAvailableFilters.filter((filter) =>
        selectedEditFilterSet.has(String(filter.filter_code))
      ),
    [editAvailableFilters, selectedEditFilterSet]
  );
  const unusedEditableFilters = useMemo(
    () =>
      editAvailableFilters.filter(
        (filter) => !selectedEditFilterSet.has(String(filter.filter_code))
      ),
    [editAvailableFilters, selectedEditFilterSet]
  );
  const visibleFilters = useMemo(() => {
    if (!isReportOrComponentEditMode || editAvailableFilters.length === 0) {
      return filters;
    }
    return activeEditableFilters.map((filter) => toReportFilterMenuItem(filter));
  }, [activeEditableFilters, editAvailableFilters.length, filters, isReportOrComponentEditMode]);
  const editSelectedFiltersSignature = useMemo(
    () => JSON.stringify([...editSelectedFilters].sort((left, right) => left.localeCompare(right))),
    [editSelectedFilters]
  );
  const editSelectedFilterSettingsSignature = useMemo(() => {
    const pairs = [...editSelectedFilters]
      .sort((left, right) => left.localeCompare(right))
      .map((filterCode) => {
        const filter = editAvailableFilters.find(
          (item) => String(item.filter_code ?? "").trim() === filterCode
        );
        const filterType = normalizeFilterType(filter?.type);
        if (filterType !== "select") {
          return [filterCode, null] as const;
        }
        const draft = editFilterSettings[filterCode];
        return [
          filterCode,
          {
            default_value: String(draft?.default_value ?? "").trim() || null,
            include_all: draft?.include_all === true,
          },
        ] as const;
      });
    return JSON.stringify(pairs);
  }, [editAvailableFilters, editFilterSettings, editSelectedFilters]);
  const persistedEditSelectedFiltersSignature = useMemo(
    () =>
      JSON.stringify(
        editAvailableFilters
          .filter((filter) => filter.selected)
          .map((filter) => String(filter.filter_code))
          .sort((left, right) => left.localeCompare(right))
      ),
    [editAvailableFilters]
  );
  const persistedEditSelectedFilterSettingsSignature = useMemo(() => {
    const pairs = editAvailableFilters
      .filter((filter) => filter.selected)
      .map((filter) => {
        const filterCode = String(filter.filter_code ?? "").trim();
        const filterType = normalizeFilterType(filter.type);
        if (filterType !== "select") {
          return [filterCode, null] as const;
        }
        return [
          filterCode,
          {
            default_value:
              filter.settings?.default_value === null || filter.settings?.default_value === undefined
                ? null
                : String(filter.settings.default_value).trim() || null,
            include_all: filter.settings?.include_all === true,
          },
        ] as const;
      })
      .sort((left, right) => left[0].localeCompare(right[0]));
    return JSON.stringify(pairs);
  }, [editAvailableFilters]);
  const editFiltersDirty =
    editSelectedFiltersSignature !== persistedEditSelectedFiltersSignature ||
    editSelectedFilterSettingsSignature !== persistedEditSelectedFilterSettingsSignature;
  const globalEditDirty =
    editFiltersDirty ||
    (isComponentEditMode && componentEditDirty) ||
    (isReportEditMode && reportEditDirty);
  const globalEditSaving =
    savingEditFilters ||
    (isComponentEditMode && componentEditSaving) ||
    (isReportEditMode && reportEditSaving);
  const showGlobalSaveBar = isReportOrComponentEditMode && (globalEditDirty || globalEditSaving);

  async function saveAllEdits() {
    if (!isReportOrComponentEditMode) {
      return;
    }
    if (editFiltersDirty) {
      await saveEditFilters();
    }
    if (isComponentEditMode && componentEditDirty && reportRoute && reportComponentId) {
      window.dispatchEvent(
        new CustomEvent(EDIT_COMPONENT_SAVE_REQUEST_EVENT, {
          detail: {
            reportId: reportRoute,
            reportComponentId,
          },
        })
      );
    }
    if (isReportEditMode && reportEditDirty && reportRoute) {
      window.dispatchEvent(
        new CustomEvent(REPORT_EDIT_SAVE_REQUEST_EVENT, {
          detail: {
            reportId: reportRoute,
          },
        })
      );
    }
  }

  function undoAllEdits() {
    if (!isReportOrComponentEditMode) {
      return;
    }

    if (editFiltersDirty) {
      const restoredSelectedFilters = editAvailableFilters
        .filter((filter) => filter.selected)
        .map((filter) => String(filter.filter_code))
        .sort((left, right) => left.localeCompare(right));
      setEditSelectedFilters(restoredSelectedFilters);

      const restoredSettings: Record<string, SelectFilterSettingsDraft> = {};
      for (const filter of editAvailableFilters) {
        const filterCode = String(filter.filter_code ?? "").trim();
        if (!filterCode) {
          continue;
        }
        if (normalizeFilterType(filter.type) !== "select") {
          continue;
        }
        restoredSettings[filterCode] = toSelectFilterSettingsDraft(filter);
      }
      setEditFilterSettings(restoredSettings);

      setFilters(
        editAvailableFilters
          .filter((filter) => filter.selected)
          .map((filter) => toReportFilterMenuItem(filter))
      );
      setEditFilterError(null);
      setEditFilterMessage(null);
    }

    if (isComponentEditMode && componentEditDirty && reportRoute && reportComponentId) {
      window.dispatchEvent(
        new CustomEvent(EDIT_COMPONENT_RESET_REQUEST_EVENT, {
          detail: {
            reportId: reportRoute,
            reportComponentId,
          },
        })
      );
    }
    if (isReportEditMode && reportEditDirty && reportRoute) {
      window.dispatchEvent(
        new CustomEvent(REPORT_EDIT_RESET_REQUEST_EVENT, {
          detail: {
            reportId: reportRoute,
          },
        })
      );
    }
  }

  function startSidebarResize(event: React.MouseEvent<HTMLDivElement>) {
    if (window.innerWidth < 1024) {
      return;
    }

    event.preventDefault();
    const initialX = event.clientX;
    const initialWidth = clampSidebarWidth(sidebarWidth);

    const handleMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - initialX;
      setSidebarWidth(clampSidebarWidth(initialWidth + delta));
    };

    const handleUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  const railBackgroundColor = darkMode ? "#ffffff" : "#0a0a0a";
  const railTextColor = darkMode ? "#111827" : "#f8fafc";
  const railMutedTextColor = darkMode ? "#4b5563" : "#94a3b8";
  const railBorderColor = darkMode ? "#d1d5db" : "#1f2937";
  const panelBackgroundColor = "var(--app-surface)";
  const panelTextColor = "var(--app-text-strong)";
  const panelBorderColor = "var(--app-border)";
  const activeRailItemBackgroundColor = panelBackgroundColor;
  const activeRailItemTextColor = panelTextColor;
  const reportsActive = menuMode === "reports";
  const homeActive = false;
  const filtersActive = menuMode === "filters";
  const columnsActive = menuMode === "columns";
  const settingsActive = menuMode === "settings";
  const mobileModeLabel = homeActive
    ? "Home"
    : menuMode === "reports"
      ? "Reports"
      : menuMode === "filters"
        ? "Filters"
        : menuMode === "columns"
          ? "Columns"
          : "Settings";

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 z-30 border-b px-4 py-3 lg:hidden"
        style={{
          borderColor: railBorderColor,
          backgroundColor: railBackgroundColor,
          color: railTextColor,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((current) => !current)}
            className="rounded border px-3 py-1 text-sm font-medium"
            style={{ borderColor: railBorderColor, color: railTextColor }}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-sidebar"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
          <span className="text-sm font-semibold">Analytics</span>
          <span className="text-xs" style={{ color: railMutedTextColor }}>
            {mobileModeLabel}
          </span>
        </div>
      </div>

      {mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 lg:hidden"
          style={{ backgroundColor: "var(--app-overlay)" }}
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close menu overlay"
        />
      )}

      <nav
        id="mobile-sidebar"
        className={`fixed left-0 z-30 overflow-hidden border-r border-b transition-transform duration-200 lg:top-0 lg:z-20 lg:h-screen lg:w-[var(--sidebar-width)] lg:border-b-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } top-14 h-[calc(100dvh-3.5rem)] w-80 max-w-[calc(100vw-1rem)]`}
        style={{
          borderColor: railBorderColor,
          backgroundColor: railBackgroundColor,
          color: railTextColor,
        }}
      >
        <div className="flex h-full min-w-0">
          <div
            className="flex w-16 shrink-0 flex-col items-center justify-between py-3"
            style={{ backgroundColor: railBackgroundColor }}
          >
            <div className="flex w-full flex-col items-center gap-2">
              <Link
                href="/"
                onClick={() => {
                  setMobileMenuOpen(false);
                }}
                className="inline-flex h-11 w-full items-center justify-center rounded-none transition-colors"
                style={{
                  backgroundColor: homeActive ? activeRailItemBackgroundColor : "transparent",
                  color: homeActive ? activeRailItemTextColor : railTextColor,
                }}
                aria-label="Home"
                title="Home"
              >
                <NavIcon name="home" className="h-5 w-5" />
              </Link>
              <button
                type="button"
                onClick={() => setMenuMode("reports")}
                className="inline-flex h-11 w-full items-center justify-center rounded-none transition-colors"
                style={{
                  backgroundColor: reportsActive ? activeRailItemBackgroundColor : "transparent",
                  color: reportsActive ? activeRailItemTextColor : railTextColor,
                }}
                aria-label="Reports"
                title="Reports"
              >
                <NavIcon name="reports" className="h-5 w-5" />
              </button>
              {reportRoute && (
                <button
                  type="button"
                  onClick={() => setMenuMode("filters")}
                  className="inline-flex h-11 w-full items-center justify-center rounded-none transition-colors"
                  style={{
                    backgroundColor: filtersActive ? activeRailItemBackgroundColor : "transparent",
                    color: filtersActive ? activeRailItemTextColor : railTextColor,
                  }}
                  aria-label="Filters"
                  title="Filters"
                >
                  <NavIcon name="filters" className="h-5 w-5" />
                </button>
              )}
              {isComponentEditMode && (
                <button
                  type="button"
                  onClick={() => setMenuMode("columns")}
                  className="inline-flex h-11 w-full items-center justify-center rounded-none transition-colors"
                  style={{
                    backgroundColor: columnsActive ? activeRailItemBackgroundColor : "transparent",
                    color: columnsActive ? activeRailItemTextColor : railTextColor,
                  }}
                  aria-label="Columns"
                  title="Columns"
                >
                  <NavIcon name="columns" className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setMenuMode("settings")}
                className="inline-flex h-11 w-full items-center justify-center rounded-none transition-colors"
                style={{
                  backgroundColor: settingsActive ? activeRailItemBackgroundColor : "transparent",
                  color: settingsActive ? activeRailItemTextColor : railTextColor,
                }}
                aria-label="Settings"
                title="Settings"
              >
                <SettingsIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: railMutedTextColor }}>
              Menu
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col" style={{ backgroundColor: panelBackgroundColor, color: panelTextColor }}>
            <div className="shrink-0 border-b px-4 py-3 lg:px-6" style={{ borderColor: panelBorderColor }}>
              <div className="text-sm font-semibold">{mobileModeLabel}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex flex-col gap-6 px-4 py-4 lg:px-6 lg:py-6">
            {menuMode === "reports" && (
              <>
                <div>
                  <Link
                    href="/reports"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block rounded px-2 py-1 text-sm font-medium"
                    style={{
                      backgroundColor: pathname === "/reports" ? "var(--app-surface-muted)" : "transparent",
                      color: "var(--app-text-strong)",
                    }}
                  >
                    All Reports
                  </Link>
                </div>
                {categories.map((cat) => (
                  <div key={cat.categoryKey}>
                    <div className="mb-2 text-xs font-medium" style={{ color: "var(--app-text-muted)" }}>
                      {cat.categoryLabel}
                    </div>
                    <ul className="flex flex-col gap-1">
                      {cat.reports.map((report) => {
                        const isActive = pathname === report.href;
                        return (
                          <li key={report.id}>
                            <div
                              className="flex items-center justify-between gap-2 rounded px-2 py-1"
                              style={{ backgroundColor: isActive ? "var(--app-surface-muted)" : "transparent" }}
                            >
                              <Link
                                href={report.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`min-w-0 flex-1 truncate text-sm ${isActive ? "font-medium" : ""}`}
                                style={{ color: "var(--app-text-strong)" }}
                              >
                                {report.title}
                              </Link>
                              <InfoModalTrigger
                                header={report.title}
                                body={report.description ?? "No description available for this report."}
                                triggerAriaLabel={`Show details for ${report.title}`}
                                dialogId={`report-list-info-dialog-${report.id}`}
                                closeButtonLabel="Close report details"
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {categories.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                    No active reports found in `meta.reports`.
                  </p>
                )}
                <div>
                  {/* These reports are all hard coded reports, not ones pulled from meta.reports */}
                  <div className="mb-2 text-xs font-medium" style={{ color: "var(--app-text-muted)" }}>
                    Other
                  </div>
                  <Link
                    href="/reports/table-relationships"
                    onClick={() => setMobileMenuOpen(false)}
                    className="mb-4 block px-3 py-2 text-sm font-medium"
                    style={{
                      borderColor: pathname === "/reports/table-relationships" ? "var(--app-control-track-active)" : "var(--app-border)",
                      backgroundColor: pathname === "/reports/table-relationships" ? "var(--app-surface-muted)" : "transparent",
                      color: "var(--app-text-strong)",
                    }}
                  >
                    Table Relationships 
                  </Link>
                </div>
              </>
            )}

            {reportRoute && menuMode === "filters" && (
              <div>
                {visibleFilters.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                    No filters for this report.
                  </p>
                )}
                {visibleFilters.length > 0 && (
                  <div className={`space-y-3 ${loadingFilterData ? "opacity-60" : "opacity-100"}`}>
                    {visibleFilters.map((filter) => {
                      const filterType = normalizeFilterType(filter.type);
                      const value = filterValue(filter.filter_code);
                      const options = filterOptions(filter);
                      const hasDescription = Boolean(filter.description && filter.description.trim().length > 0);
                      const multiValue = splitMultiValue(value);
                      const canRemoveInEditMode =
                        isReportOrComponentEditMode && editableFilterCodeSet.has(String(filter.filter_code));
                      const selectSettings = editFilterSettings[String(filter.filter_code)];
                      const includeAllEnabled =
                        filterType === "select" &&
                        (isReportOrComponentEditMode
                          ? (selectSettings?.include_all === true)
                          : (filter.settings?.include_all === true));
                      const canEditSelectSettings =
                        isReportOrComponentEditMode && filterType === "select" && canRemoveInEditMode;

                      return (
                        <label key={filter.filter_code} className="relative flex flex-col text-sm">
                          <span className="flex items-center justify-between gap-2">
                            <span>{filter.label}</span>
                            <span className="flex items-center gap-2">
                              {hasDescription && (
                                <InfoModalTrigger
                                  header={filter.label}
                                  body={filter.description}
                                  triggerAriaLabel={`Show info for ${filter.label}`}
                                  dialogId={`filter-info-dialog-${filter.filter_code}`}
                                  closeButtonLabel="Close filter info"
                                />
                              )}
                              {canRemoveInEditMode && (
                                <button
                                  type="button"
                                  onClick={() => applyEditFilterChange(String(filter.filter_code), false)}
                                  disabled={savingEditFilters}
                                  className="rounded border px-1.5 py-0 text-xs font-semibold leading-5"
                                  style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                                  aria-label={`Remove ${filter.label}`}
                                  title={`Remove ${filter.label}`}
                                >
                                  X
                                </button>
                              )}
                            </span>
                          </span>
                          {filterType === "multi_select" ? (
                            <select
                              multiple
                              value={multiValue}
                              onChange={(e) => {
                                const selected = Array.from(e.currentTarget.selectedOptions).map((option) => option.value);
                                applyMultiFilterChange(filter.filter_code, selected);
                              }}
                              className="mt-1 rounded border px-2 py-1"
                              style={{
                                borderColor: "var(--app-border)",
                                backgroundColor: "var(--app-surface)",
                                color: "var(--app-text-strong)",
                              }}
                              disabled={loadingFilterData}
                            >
                              {options.length === 0 && (
                                <option value="" disabled>
                                  No options
                                </option>
                              )}
                              {options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : filterType === "select" ? (
                            <>
                              <select
                                value={value}
                                onChange={(e) => applyFilterChange(filter.filter_code, e.target.value)}
                                className="mt-1 rounded border px-2 py-1"
                                style={{
                                  borderColor: "var(--app-border)",
                                  backgroundColor: "var(--app-surface)",
                                  color: "var(--app-text-strong)",
                                }}
                                disabled={loadingFilterData}
                              >
                                {includeAllEnabled && <option value="">All</option>}
                                {options.length === 0 && value !== "" && (
                                  <option value={value}>{value}</option>
                                )}
                                {options.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {canEditSelectSettings && (
                                <div
                                  className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2 rounded border p-2"
                                  style={{ borderColor: "var(--app-border)" }}
                                >
                                  <input
                                    value={selectSettings?.default_value ?? ""}
                                    onChange={(event) =>
                                      applyEditFilterSettingDefaultValue(
                                        String(filter.filter_code),
                                        event.target.value
                                      )
                                    }
                                    className="rounded border px-2 py-1 text-xs"
                                    style={{
                                      borderColor: "var(--app-border)",
                                      backgroundColor: "var(--app-surface)",
                                      color: "var(--app-text-strong)",
                                    }}
                                    placeholder="Default value (optional)"
                                  />
                                  <label className="flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={selectSettings?.include_all === true}
                                      onChange={(event) =>
                                        applyEditFilterSettingIncludeAll(
                                          String(filter.filter_code),
                                          event.target.checked
                                        )
                                      }
                                    />
                                    Include All
                                  </label>
                                </div>
                              )}
                            </>
                          ) : (
                            <input
                              value={value}
                              onChange={(e) => applyFilterChange(filter.filter_code, e.target.value)}
                              className="mt-1 rounded border px-2 py-1"
                              style={{
                                borderColor: "var(--app-border)",
                                backgroundColor: "var(--app-surface)",
                                color: "var(--app-text-strong)",
                              }}
                              disabled={loadingFilterData}
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                {isReportOrComponentEditMode && (
                  <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--app-border)" }}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        Manage report filters.
                      </div>
                    </div>

                    {editFilterError && (
                      <p className="mb-2 text-xs" style={{ color: "var(--app-danger, #b91c1c)" }}>
                        {editFilterError}
                      </p>
                    )}
                    {editFilterMessage && (
                      <p className="mb-2 text-xs" style={{ color: "var(--app-success, #166534)" }}>
                        {editFilterMessage}
                      </p>
                    )}

                    {loadingEditFilters && (
                      <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        Loading filters...
                      </p>
                    )}

                    {!loadingEditFilters && editAvailableFilters.length === 0 && (
                      <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                        No available filters found in `meta.filters`.
                      </p>
                    )}

                    {!loadingEditFilters && editAvailableFilters.length > 0 && (
                      <div className="space-y-4">
                        <div>
                          <div className="mb-2 text-xs font-medium" style={{ color: "var(--app-text-muted)" }}>
                            Unused Filters
                          </div>
                          {unusedEditableFilters.length === 0 && (
                            <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                              No unused filters available.
                            </p>
                          )}
                          {unusedEditableFilters.length > 0 && (
                            <div className="space-y-1">
                              {unusedEditableFilters.map((filter) => {
                                const filterCode = String(filter.filter_code);
                                const hasDescription = Boolean(filter.description && filter.description.trim().length > 0);
                                return (
                                  <div
                                    key={filterCode}
                                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm"
                                    style={{ backgroundColor: "transparent" }}
                                  >
                                    <span className="truncate">{filter.label || filterCode}</span>
                                    <span className="flex items-center gap-2">
                                      {hasDescription && (
                                        <InfoModalTrigger
                                          header={filter.label || filterCode}
                                          body={filter.description}
                                          triggerAriaLabel={`Show info for ${filter.label || filterCode}`}
                                          dialogId={`unused-filter-info-dialog-${filterCode}`}
                                          closeButtonLabel="Close filter info"
                                        />
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => applyEditFilterChange(filterCode, true)}
                                        disabled={savingEditFilters}
                                        className="rounded border px-2 py-0.5 text-xs"
                                        style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                                      >
                                        Add
                                      </button>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isComponentEditMode && menuMode === "columns" && (
              <div>
                {loadingEditColumns && (
                  <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                    Loading columns...
                  </p>
                )}
                {!loadingEditColumns && groupedEditColumns.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                    No columns available for this component.
                  </p>
                )}
                {!loadingEditColumns && groupedEditColumns.length > 0 && (
                  <div className="space-y-4">
                    {groupedEditColumns.map(([datasetKey, columns]) => (
                      <div key={datasetKey}>
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--app-text-muted)" }}>
                          {datasetKey}
                        </div>
                        <div className="space-y-1">
                          {columns.map((column) => {
                            const isChecked = editSelectedColumns.includes(column.key);
                            return (
                              <label
                                key={column.key}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                                style={{ backgroundColor: isChecked ? "var(--app-surface-muted)" : "transparent" }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(event) => applyEditColumnChange(column.key, event.target.checked)}
                                />
                                <span>{column.column}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {menuMode === "settings" && (
              <div className="space-y-4">
                <SettingToggle
                  label="Dark Mode"
                  enabled={darkMode}
                  onToggle={() => setDarkMode((current) => !current)}
                  switchAriaLabel="Toggle dark mode"
                />
                <SettingToggle
                  label="Anonymize"
                  enabled={anonymize}
                  onToggle={() => setAnonymize((current) => !current)}
                  switchAriaLabel="Toggle anonymize"
                />
              </div>
            )}
            </div>
          </div>
          {showGlobalSaveBar && (
            <div
              className="shrink-0 border-t px-4 pb-4 pt-3 lg:px-6 lg:pb-6"
              style={{ borderColor: panelBorderColor, backgroundColor: panelBackgroundColor }}
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={undoAllEdits}
                  disabled={loadingEditFilters || globalEditSaving || !globalEditDirty}
                  className="w-full rounded border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                >
                  Undo Changes
                </button>
                <button
                  type="button"
                  onClick={() => void saveAllEdits()}
                  disabled={loadingEditFilters || globalEditSaving || !globalEditDirty}
                  className="w-full rounded border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                  aria-live="polite"
                >
                  {globalEditSaving ? "Saving changes..." : "Save Changes"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={startSidebarResize}
          className="absolute right-0 top-0 hidden h-full w-2 translate-x-1/2 cursor-col-resize lg:block"
          style={{ backgroundColor: "transparent" }}
        />
      </nav>
    </>
  );
}

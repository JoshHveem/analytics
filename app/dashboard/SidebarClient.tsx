"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReportCategory } from "@/lib/report-catalog";
import { InfoModalTrigger } from "@/app/_components/InfoModalTrigger";
import { applyAppTheme } from "@/lib/color-palette";

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

const EDIT_COLUMNS_STATE_EVENT = "analytics:report-component-edit-state";
const EDIT_COLUMNS_CHANGE_EVENT = "analytics:report-component-edit-columns-change";
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

  const labelCandidates = [
    valueKey.replace(/_code$/, "_name"),
    recordKeys.find((key) => key.endsWith("_name")) ?? "",
    "label",
    "name",
    valueKey,
  ];
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
  const [menuMode, setMenuMode] = useState<"reports" | "filters" | "edit_filters" | "columns" | "settings">(
    isComponentEditMode ? "columns" : reportRoute ? "filters" : "reports"
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterMeta, setFilterMeta] = useState<Record<string, unknown>>({});
  const [selectedMeta, setSelectedMeta] = useState<Record<string, string | null>>({});
  const [loadingFilterData, setLoadingFilterData] = useState(false);
  const [loadingEditColumns, setLoadingEditColumns] = useState(false);
  const [editAvailableColumns, setEditAvailableColumns] = useState<EditAvailableColumn[]>([]);
  const [editSelectedColumns, setEditSelectedColumns] = useState<string[]>([]);
  const [loadingEditFilters, setLoadingEditFilters] = useState(false);
  const [savingEditFilters, setSavingEditFilters] = useState(false);
  const [editFilterError, setEditFilterError] = useState<string | null>(null);
  const [editFilterMessage, setEditFilterMessage] = useState<string | null>(null);
  const [editAvailableFilters, setEditAvailableFilters] = useState<ReportEditableFilterItem[]>([]);
  const [editSelectedFilters, setEditSelectedFilters] = useState<string[]>([]);
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
        return;
      }

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
          setFilters(
            (json.config.filters ?? []).map((f) => ({
              filter_code: String(f.filter_code),
              type: String(f.type ?? "select"),
              label: String(f.label ?? f.filter_code),
              description: f.description ?? null,
              table: f.table ?? null,
              column: f.column ?? null,
            }))
          );
        }
      } catch {
        if (!cancelled) {
          setReportId(null);
          setFilters([]);
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
        setSelectedMeta({});
        return;
      }

      setLoadingFilterData(true);
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
          const nextSelected: Record<string, string | null> = {};
          for (const [key, value] of Object.entries(selectedRaw)) {
            nextSelected[key] = value === null || value === undefined ? null : String(value);
          }
          setSelectedMeta(nextSelected);
        }
      } catch {
        if (!cancelled) {
          setFilterMeta({});
          setSelectedMeta({});
        }
      } finally {
        if (!cancelled) {
          setLoadingFilterData(false);
        }
      }
    }

    void loadFilterMeta();
    return () => {
      cancelled = true;
    };
  }, [reportId, reportRoute, searchParams]);

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
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setEditAvailableFilters([]);
          setEditSelectedFilters([]);
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
    }

    window.addEventListener(EDIT_COLUMNS_STATE_EVENT, handleEditState as EventListener);
    return () => {
      window.removeEventListener(EDIT_COLUMNS_STATE_EVENT, handleEditState as EventListener);
    };
  }, [isComponentEditMode, reportComponentId, reportRoute]);

  useEffect(() => {
    if (isComponentEditMode) {
      setMenuMode("columns");
      return;
    }
    if (isReportEditMode) {
      setMenuMode("edit_filters");
      return;
    }
    setMenuMode(reportRoute ? "filters" : "reports");
  }, [isComponentEditMode, isReportEditMode, reportRoute]);

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
    const param = filterCode;
    const fromQuery = searchParams.get(param);
    if (fromQuery) {
      return fromQuery;
    }
    return selectedMeta[param] ?? "";
  }

  function filterOptions(filter: ReportFilterMenuItem): Array<{ value: string; label: string }> {
    const sourceKeys = normalizeMetaSourceKeys(filter);
    const source = sourceKeys.find((key) => key in filterMeta);
    const fallbackKey =
      source ??
      Object.keys(filterMeta).find((metaKey) => sourceKeys.includes(metaKey.trim().toLowerCase()));
    const raw = fallbackKey ? filterMeta[fallbackKey] : undefined;
    return optionsFromMetaSource(raw, filter.column);
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

  async function saveEditFilters() {
    if (!reportId || !isReportOrComponentEditMode) {
      return;
    }

    setSavingEditFilters(true);
    setEditFilterError(null);
    setEditFilterMessage(null);
    try {
      const res = await fetch("/api/reports/editor/filters", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_id: reportId,
          selected_filters: editSelectedFilters,
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
      setFilters(
        availableFilters
          .filter((filter) => selectedFilters.includes(String(filter.filter_code)))
          .map((filter) => ({
            filter_code: String(filter.filter_code),
            type: String(filter.type ?? "select"),
            label: String(filter.label ?? filter.filter_code),
            description: filter.description ?? null,
            table: filter.table ?? null,
            column: filter.column ?? null,
          }))
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
  const editSelectedFiltersSignature = useMemo(
    () => JSON.stringify([...editSelectedFilters].sort((left, right) => left.localeCompare(right))),
    [editSelectedFilters]
  );
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
  const editFiltersDirty = editSelectedFiltersSignature !== persistedEditSelectedFiltersSignature;

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

  const mobileModeLabel =
    menuMode === "reports"
      ? "Reports"
      : menuMode === "filters"
        ? "Filters"
        : menuMode === "edit_filters"
          ? "Edit Filters"
          : menuMode === "columns"
            ? "Columns"
            : "Settings";

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 z-30 border-b px-4 py-3 lg:hidden"
        style={{
          borderColor: "var(--app-border)",
          backgroundColor: "var(--app-surface)",
          color: "var(--app-text-strong)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((current) => !current)}
            className="rounded border px-3 py-1 text-sm font-medium"
            style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-sidebar"
          >
            {mobileMenuOpen ? "Close" : "Menu"}
          </button>
          <span className="text-sm font-semibold">Analytics</span>
          <span className="text-xs" style={{ color: "var(--app-text-muted)" }}>
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
        className={`fixed left-0 z-30 overflow-auto border-r border-b p-4 transition-transform duration-200 lg:top-0 lg:z-20 lg:h-screen lg:w-[var(--sidebar-width)] lg:border-b-0 lg:p-6 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } top-14 h-[calc(100dvh-3.5rem)] w-80 max-w-[calc(100vw-1rem)]`}
        style={{
          borderColor: "var(--app-border)",
          backgroundColor: "var(--app-surface)",
          color: "var(--app-text-strong)",
        }}
      >
        <div>
          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="mb-4 block rounded-md border px-3 py-2 text-sm font-medium"
            style={{
              borderColor: pathname === "/" ? "var(--app-control-track-active)" : "var(--app-border)",
              backgroundColor: pathname === "/" ? "var(--app-surface-muted)" : "transparent",
              color: "var(--app-text-strong)",
            }}
          >
            Home
          </Link>
          <div className="mb-4 rounded-md border p-1" style={{ borderColor: "var(--app-border)" }}>
            <div
              className={`grid gap-1 ${
                reportRoute
                  ? isComponentEditMode
                    ? "grid-cols-5"
                    : isReportEditMode
                      ? "grid-cols-4"
                      : "grid-cols-3"
                  : "grid-cols-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setMenuMode("reports")}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: menuMode === "reports" ? "var(--app-control-track-active)" : "var(--app-surface)",
                  color: menuMode === "reports" ? "var(--app-control-thumb)" : "var(--app-text-muted)",
                }}
              >
                Reports
              </button>
              {reportRoute && (
                <button
                  type="button"
                  onClick={() => setMenuMode("filters")}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: menuMode === "filters" ? "var(--app-control-track-active)" : "var(--app-surface)",
                    color: menuMode === "filters" ? "var(--app-control-thumb)" : "var(--app-text-muted)",
                  }}
                >
                  Filters
                </button>
              )}
              {reportRoute && isReportOrComponentEditMode && (
                <button
                  type="button"
                  onClick={() => setMenuMode("edit_filters")}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: menuMode === "edit_filters" ? "var(--app-control-track-active)" : "var(--app-surface)",
                    color: menuMode === "edit_filters" ? "var(--app-control-thumb)" : "var(--app-text-muted)",
                  }}
                >
                  Edit Filters
                </button>
              )}
              {isComponentEditMode && (
                <button
                  type="button"
                  onClick={() => setMenuMode("columns")}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: menuMode === "columns" ? "var(--app-control-track-active)" : "var(--app-surface)",
                    color: menuMode === "columns" ? "var(--app-control-thumb)" : "var(--app-text-muted)",
                  }}
                >
                  Columns
                </button>
              )}
              <button
                type="button"
                onClick={() => setMenuMode("settings")}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: menuMode === "settings" ? "var(--app-control-track-active)" : "var(--app-surface)",
                  color: menuMode === "settings" ? "var(--app-control-thumb)" : "var(--app-text-muted)",
                }}
              >
                Settings
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {menuMode === "reports" && (
              <>
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
                {filters.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                    No filters for this report.
                  </p>
                )}
                {filters.length > 0 && (
                  <div className={`space-y-3 ${loadingFilterData ? "opacity-60" : "opacity-100"}`}>
                    {filters.map((filter) => {
                      const filterType = normalizeFilterType(filter.type);
                      const value = filterValue(filter.filter_code);
                      const options = filterOptions(filter);
                      const hasDescription = Boolean(filter.description && filter.description.trim().length > 0);
                      const multiValue = splitMultiValue(value);

                      return (
                        <label key={filter.filter_code} className="relative flex flex-col text-sm">
                          <span className="flex items-center justify-between gap-2">
                            <span>{filter.label}</span>
                            {hasDescription && (
                              <InfoModalTrigger
                                header={filter.label}
                                body={filter.description}
                                triggerAriaLabel={`Show info for ${filter.label}`}
                                dialogId={`filter-info-dialog-${filter.filter_code}`}
                                closeButtonLabel="Close filter info"
                              />
                            )}
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
                              {options.length === 0 && value !== "" && (
                                <option value={value}>{value}</option>
                              )}
                              {options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
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
              </div>
            )}

            {reportRoute && isReportOrComponentEditMode && menuMode === "edit_filters" && (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                    Select which filters are used by this report.
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveEditFilters()}
                    disabled={loadingEditFilters || savingEditFilters || !editFiltersDirty}
                    className="rounded border px-2 py-1 text-xs"
                    style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                  >
                    {savingEditFilters ? "Saving..." : "Save"}
                  </button>
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
                  <div className="space-y-1">
                    {editAvailableFilters.map((filter) => {
                      const filterCode = String(filter.filter_code);
                      const isChecked = editSelectedFilters.includes(filterCode);
                      const hasDescription = Boolean(filter.description && filter.description.trim().length > 0);
                      return (
                        <label
                          key={filterCode}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-sm"
                          style={{ backgroundColor: isChecked ? "var(--app-surface-muted)" : "transparent" }}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(event) => applyEditFilterChange(filterCode, event.target.checked)}
                            />
                            <span className="truncate">{filter.label || filterCode}</span>
                          </span>
                          {hasDescription && (
                            <InfoModalTrigger
                              header={filter.label || filterCode}
                              body={filter.description}
                              triggerAriaLabel={`Show info for ${filter.label || filterCode}`}
                              dialogId={`edit-filter-info-dialog-${filterCode}`}
                              closeButtonLabel="Close filter info"
                            />
                          )}
                        </label>
                      );
                    })}
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

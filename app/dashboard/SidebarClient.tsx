"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type ProgramOption = {
  program_code: string;
  program_name: string;
};

type DepartmentOption = {
  department_code: string;
  department_name: string;
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

function reportRouteFromPathname(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "reports") {
    return null;
  }
  return parts[1];
}

function filterCodeToParam(filterCode: string): string {
  if (filterCode === "program") {
    return "program_code";
  }
  if (filterCode === "department") {
    return "department_code";
  }
  return filterCode;
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

function normalizeMetaSourceKey(filter: ReportFilterMenuItem): string {
  const tableName = String(filter.table ?? "").trim();
  if (tableName) {
    return tableName;
  }

  const param = filterCodeToParam(filter.filter_code);
  if (param === "academic_year") {
    return "years";
  }

  if (param.endsWith("_code")) {
    return `${param.replace(/_code$/, "")}s`;
  }

  if (param.endsWith("y")) {
    return `${param.slice(0, -1)}ies`;
  }

  return `${param}s`;
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
  const valueCandidates = [
    String(valueKeyHint ?? "").trim(),
    "value",
    "id",
  ].filter((key) => key.length > 0);
  const valueKey = valueCandidates.find((key) => key in firstRecord);
  if (!valueKey) {
    return [];
  }

  const labelCandidates = [
    valueKey.replace(/_code$/, "_name"),
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
  const reportRoute = useMemo(() => reportRouteFromPathname(pathname), [pathname]);
  const queryKey = searchParams.toString();
  const [filters, setFilters] = useState<ReportFilterMenuItem[]>([]);
  const [menuMode, setMenuMode] = useState<"reports" | "filters" | "settings">(reportRoute ? "filters" : "reports");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterMeta, setFilterMeta] = useState<Record<string, unknown>>({});
  const [selectedMeta, setSelectedMeta] = useState<Record<string, string | null>>({});
  const [loadingFilterData, setLoadingFilterData] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [anonymize, setAnonymize] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadFilters() {
      if (!reportRoute) {
        setFilters([]);
        return;
      }

      try {
        const res = await fetch(`/api/reports/config?route=${encodeURIComponent(reportRoute)}`);
        const json = (await res.json()) as ReportConfigResponse;
        if (!res.ok || !json.config) {
          if (!cancelled) {
            setFilters([]);
          }
          return;
        }

        if (!cancelled) {
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
      if (!reportRoute) {
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

        const res = await fetch(`/api/reports/${encodeURIComponent(reportRoute)}?${params.toString()}`);
        const json = (await res.json()) as ReportMetaResponse;
        if (!res.ok || !json.meta) {
          if (!cancelled) {
            setFilterMeta({});
            setSelectedMeta({});
          }
          return;
        }

        if (!cancelled) {
          setFilterMeta(json.meta);
          const selectedRaw =
            json.meta.selected && typeof json.meta.selected === "object"
              ? (json.meta.selected as Record<string, unknown>)
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
  }, [reportRoute, searchParams]);

  useEffect(() => {
    setMenuMode(reportRoute ? "filters" : "reports");
  }, [reportRoute]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, queryKey]);

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
    const param = filterCodeToParam(filterCode);
    const fromQuery = searchParams.get(param);
    if (fromQuery) {
      return fromQuery;
    }
    return selectedMeta[param] ?? "";
  }

  function filterOptions(filter: ReportFilterMenuItem): Array<{ value: string; label: string }> {
    const sourceKey = normalizeMetaSourceKey(filter);
    const source = filterMeta[sourceKey];
    return optionsFromMetaSource(source, filter.column);
  }

  function applyFilterChange(filterCode: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const param = filterCodeToParam(filterCode);

    if (value) {
      params.set(param, value);
    } else {
      params.delete(param);
    }

    if (param === "program_code" || param === "academic_year") {
      params.delete("campus");
    }

    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }

  function applyMultiFilterChange(filterCode: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    const param = filterCodeToParam(filterCode);
    const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);

    if (cleaned.length > 0) {
      params.set(param, cleaned.join(","));
    } else {
      params.delete(param);
    }

    if (param === "program_code" || param === "academic_year") {
      params.delete("campus");
    }

    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }

  const mobileModeLabel = menuMode === "reports" ? "Reports" : menuMode === "filters" ? "Filters" : "Settings";

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
        className={`fixed left-0 z-30 overflow-auto border-r border-b p-4 transition-transform duration-200 lg:top-0 lg:z-20 lg:h-screen lg:w-64 lg:border-b-0 lg:p-6 ${
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
            <div className={`grid gap-1 ${reportRoute ? "grid-cols-3" : "grid-cols-2"}`}>
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
                          {filterType === "multi_select" && options.length > 0 ? (
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
                              {options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : filterType === "select" && options.length > 0 ? (
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
      </nav>
    </>
  );
}





"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReportContainer } from "./ReportContainer";
import { ReportErrorBanner } from "./ReportErrorBanner";
import { EditAction } from "./EditAction";

const REPORT_EDIT_STATE_EVENT = "analytics:report-edit-state";
const REPORT_EDIT_SAVE_REQUEST_EVENT = "analytics:report-edit-save-request";
const REPORT_EDIT_RESET_REQUEST_EVENT = "analytics:report-edit-reset-request";

type EditorComponent = {
  report_component_id: string;
  component_code: string;
  component_name: string | null;
  component_description: string | null;
  component_order: number;
};

type AvailableComponent = {
  component_code: string;
  name: string | null;
  description: string | null;
};

type EditorResponse = {
  ok: boolean;
  report?: {
    report_id: string;
    title: string;
    route: string;
  };
  components?: EditorComponent[];
  available_components?: AvailableComponent[];
  created_report_component_id?: string;
  error?: string;
};

type DatasetTablesResponse = {
  ok: boolean;
  tables?: string[];
  error?: string;
};

function toTitleCase(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ReportEditorClient({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resolvedReportId, setResolvedReportId] = useState<string>(reportId);
  const [resolvedRoute, setResolvedRoute] = useState<string>(reportId);
  const [reportTitle, setReportTitle] = useState<string>(toTitleCase(reportId));
  const [reportTitleDraft, setReportTitleDraft] = useState<string>(toTitleCase(reportId));
  const [savingTitle, setSavingTitle] = useState(false);
  const [components, setComponents] = useState<EditorComponent[]>([]);
  const [availableComponents, setAvailableComponents] = useState<AvailableComponent[]>([]);
  const [newComponentCode, setNewComponentCode] = useState<string>("");
  const [datasetTables, setDatasetTables] = useState<string[]>([]);
  const [selectedDatasetTable, setSelectedDatasetTable] = useState<string>("");
  const [loadingDatasetTables, setLoadingDatasetTables] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ report_id: reportId });
      const res = await fetch(`/api/reports/editor/components?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as EditorResponse;
      if (!res.ok || !json.ok || !json.report) {
        throw new Error(json.error || "Failed to load report editor");
      }

      const sortedComponents = [...(json.components ?? [])].sort((a, b) => {
        const leftOrder = Number(a.component_order ?? 100000);
        const rightOrder = Number(b.component_order ?? 100000);
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return String(a.report_component_id).localeCompare(String(b.report_component_id));
      });

      setResolvedReportId(String(json.report.report_id));
      setResolvedRoute(String(json.report.route));
      const nextTitle = String(json.report.title);
      setReportTitle(nextTitle);
      setReportTitleDraft(nextTitle);
      setComponents(sortedComponents);
      setAvailableComponents(json.available_components ?? []);
      setNewComponentCode((current) =>
        (json.available_components ?? []).some((item) => item.component_code === current) ? current : ""
      );
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDatasetTables = useCallback(async () => {
    setLoadingDatasetTables(true);
    try {
      const res = await fetch("/api/reports/editor/dataset-tables", {
        cache: "no-store",
      });
      const json = (await res.json()) as DatasetTablesResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load dataset tables");
      }

      const nextTables = Array.from(
        new Set(
          (json.tables ?? [])
            .map((table) => String(table ?? "").trim())
            .filter((table) => table.length > 0)
        )
      );
      setDatasetTables(nextTables);
      setSelectedDatasetTable((current) => (nextTables.includes(current) ? current : ""));
    } catch (e: unknown) {
      setError((current) => current ?? String(e));
    } finally {
      setLoadingDatasetTables(false);
    }
  }, []);

  useEffect(() => {
    void loadDatasetTables();
  }, [loadDatasetTables]);

  const reportTitleDirty = reportTitleDraft.trim() !== reportTitle.trim();

  async function persistOrder(nextComponents: EditorComponent[]) {
    setSavingOrder(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/reports/editor/components", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_id: resolvedReportId,
          component_ids: nextComponents.map((component) => component.report_component_id),
        }),
      });
      const json = (await res.json()) as EditorResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to reorder components");
      }
      setMessage("Component order updated.");
      setComponents(nextComponents);
    } catch (e: unknown) {
      setError(String(e));
      await load();
    } finally {
      setSavingOrder(false);
    }
  }

  async function saveReportTitle() {
    const nextTitle = reportTitleDraft.trim();
    if (!nextTitle || !reportTitleDirty || savingTitle) {
      return;
    }
    setSavingTitle(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/reports/editor/report", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_id: resolvedReportId,
          title: nextTitle,
        }),
      });
      const json = (await res.json()) as EditorResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to update report title");
      }
      setReportTitle(nextTitle);
      setReportTitleDraft(nextTitle);
      setMessage("Report name updated.");
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSavingTitle(false);
    }
  }

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(REPORT_EDIT_STATE_EVENT, {
        detail: {
          reportId,
          isDirty: reportTitleDirty,
          isSaving: savingTitle,
        },
      })
    );
  }, [reportId, reportTitleDirty, savingTitle]);

  useEffect(() => {
    function onSaveRequest(event: Event) {
      const customEvent = event as CustomEvent<{ reportId?: string }>;
      if (String(customEvent.detail?.reportId ?? "") !== reportId) {
        return;
      }
      if (reportTitleDraft.trim().length === 0) {
        setError("Report name is required.");
        return;
      }
      void saveReportTitle();
    }

    window.addEventListener(REPORT_EDIT_SAVE_REQUEST_EVENT, onSaveRequest as EventListener);
    return () => {
      window.removeEventListener(REPORT_EDIT_SAVE_REQUEST_EVENT, onSaveRequest as EventListener);
    };
  }, [reportId, reportTitleDraft, saveReportTitle]);

  useEffect(() => {
    function onResetRequest(event: Event) {
      const customEvent = event as CustomEvent<{ reportId?: string }>;
      if (String(customEvent.detail?.reportId ?? "") !== reportId) {
        return;
      }
      setReportTitleDraft(reportTitle);
      setError(null);
      setMessage(null);
    }

    window.addEventListener(REPORT_EDIT_RESET_REQUEST_EVENT, onResetRequest as EventListener);
    return () => {
      window.removeEventListener(REPORT_EDIT_RESET_REQUEST_EVENT, onResetRequest as EventListener);
    };
  }, [reportId, reportTitle]);

  function moveComponent(componentId: string, direction: "up" | "down") {
    if (savingOrder) {
      return;
    }

    const currentIndex = components.findIndex((item) => item.report_component_id === componentId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= components.length) {
      return;
    }

    const nextComponents = [...components];
    const [moved] = nextComponents.splice(currentIndex, 1);
    nextComponents.splice(targetIndex, 0, moved);
    void persistOrder(nextComponents);
  }

  async function createComponent() {
    if (newComponentCode.trim().length === 0) {
      setError("Component type is required.");
      return;
    }
    const requiresDatasetTable = newComponentCode === "table" || newComponentCode === "conditional_bar";
    if (requiresDatasetTable && selectedDatasetTable.trim().length === 0) {
      setError("Dataset table is required for this component type.");
      return;
    }

    setCreating(true);
    setError(null);
    setMessage(null);

    try {
      const body: Record<string, unknown> = {
        report_id: resolvedReportId,
        component_code: newComponentCode,
      };
      if (requiresDatasetTable && selectedDatasetTable.trim().length > 0) {
        body.base_dataset_key = selectedDatasetTable.trim();
      }

      const res = await fetch("/api/reports/editor/components", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as EditorResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to create component");
      }

      setMessage("Component created.");
      await load();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  const requiresDatasetTable = newComponentCode === "table" || newComponentCode === "conditional_bar";

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <input
              value={reportTitleDraft}
              onChange={(event) => setReportTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setReportTitleDraft(reportTitle);
                }
              }}
              className="w-full min-w-[16rem] rounded border px-2 py-1 text-xl font-bold"
              style={{
                borderColor: "var(--app-border)",
                backgroundColor: "var(--app-surface)",
                color: "var(--app-text-strong)",
              }}
              placeholder="Report name"
              aria-label="Edit report name"
            />
          </div>
        </div>
        <Link
          href={`/reports/${resolvedRoute}`}
          className="rounded border px-3 py-1 text-sm"
          style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
        >
          Back To Report
        </Link>
      </div>

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      <ReportContainer className="mt-5">
        <div className="mb-3 text-sm" style={{ color: "var(--app-text-muted)" }}>
          Report ID: {resolvedReportId} | Route: {resolvedRoute}
        </div>

        {message && (
          <div className="mb-3 text-sm" style={{ color: "var(--app-success, #166534)" }}>
            {message}
          </div>
        )}

        {loading && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Loading components...
          </div>
        )}

        {!loading && components.length === 0 && (
          <div className="mb-5 text-sm" style={{ color: "var(--app-text-muted)" }}>
            No components configured yet.
          </div>
        )}

        {!loading && components.length > 0 && (
          <div className="mb-5 space-y-2">
            {components.map((component, index) => (
              <div
                key={component.report_component_id}
                className="rounded border p-3"
                style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface-muted)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {component.component_name ?? toTitleCase(component.component_code)}
                    </div>
                    <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                      component_code: {component.component_code}
                    </div>
                    <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
                      report_component_id: {component.report_component_id}
                    </div>
                    {component.component_description && (
                      <div className="mt-1 text-xs" style={{ color: "var(--app-text-muted)" }}>
                        {component.component_description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => moveComponent(component.report_component_id, "up")}
                      disabled={index === 0 || savingOrder}
                      className="rounded border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveComponent(component.report_component_id, "down")}
                      disabled={index === components.length - 1 || savingOrder}
                      className="rounded border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                    >
                      Down
                    </button>
                    <EditAction
                      href={`/reports/${resolvedReportId}/components/${component.report_component_id}/edit`}
                      ariaLabel={`Edit component ${component.component_name ?? component.component_code}`}
                      title="Edit component"
                      className="text-xs"
                      style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded border p-3" style={{ borderColor: "var(--app-border)" }}>
          <div className="mb-2 text-sm font-semibold">Create Component</div>
          <div className="flex flex-nowrap items-center gap-2">
            <select
              value={newComponentCode}
              onChange={(event) => setNewComponentCode(event.target.value)}
              aria-label="Select component type"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              style={{
                borderColor: "var(--app-border)",
                backgroundColor: "var(--app-surface)",
                color: "var(--app-text-strong)",
              }}
            >
              <option value="">Select Component Type</option>
              {availableComponents.map((component) => (
                <option key={component.component_code} value={component.component_code}>
                  {component.name ?? toTitleCase(component.component_code)}
                </option>
              ))}
            </select>

            <select
              value={selectedDatasetTable}
              onChange={(event) => setSelectedDatasetTable(event.target.value)}
              aria-label="Select dataset table"
              disabled={loadingDatasetTables || datasetTables.length === 0}
              className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              style={{
                borderColor: "var(--app-border)",
                backgroundColor: "var(--app-surface)",
                color: "var(--app-text-strong)",
              }}
            >
              <option value="">
                {loadingDatasetTables ? "Loading datasets..." : "Select Dataset"}
              </option>
              {!loadingDatasetTables &&
                datasetTables.map((tableName) => (
                  <option key={tableName} value={tableName}>
                    {`dataset.${tableName}`}
                  </option>
                ))}
            </select>

            <button
              type="button"
              onClick={() => void createComponent()}
              aria-label="Add component"
              disabled={
                creating ||
                availableComponents.length === 0 ||
                newComponentCode.trim().length === 0 ||
                (requiresDatasetTable && selectedDatasetTable.trim().length === 0)
              }
              className="rounded border px-3 py-1 text-sm leading-none"
              style={{ borderColor: "var(--app-border)", color: "var(--app-text-strong)" }}
            >
              {creating ? "..." : "+"}
            </button>
          </div>
        </div>
      </ReportContainer>
    </div>
  );
}


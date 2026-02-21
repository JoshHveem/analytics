import type { ReadonlyURLSearchParams } from "next/navigation";

type TemplateFilterOption = {
  value: string;
  label: string;
};

type TemplateSelectedFilters = Record<string, string | null>;

type TemplateReportMeta = {
  selected: TemplateSelectedFilters;
  years?: string[];
  campuses?: string[];
  programs?: TemplateFilterOption[];
};

export type TemplateReportResponse<TRow> = {
  ok: boolean;
  count: number;
  data: TRow[];
  meta?: TemplateReportMeta;
  error?: string;
};

export type TemplateReportConfigResponse = {
  ok: boolean;
  config?: {
    title: string;
    description: string | null;
    filters?: Array<{
      filter_code: string;
      type: string;
      default_value: string | null;
      label: string;
      description: string | null;
    }>;
  };
  error?: string;
};

export function getAnonymizeEnabled(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.getAttribute("data-anonymize") === "1";
}

export function buildReportQuery(args: {
  searchParams: ReadonlyURLSearchParams;
  includeMeta?: boolean;
  includeRows?: boolean;
  knownFilterKeys?: string[];
}): URLSearchParams {
  const { searchParams, includeMeta = true, includeRows = true, knownFilterKeys = [] } = args;

  const params = new URLSearchParams({
    include_meta: includeMeta ? "1" : "0",
    include_rows: includeRows ? "1" : "0",
    anonymize: getAnonymizeEnabled() ? "1" : "0",
  });

  for (const key of knownFilterKeys) {
    const value = searchParams.get(key);
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export const REPORT_TEMPLATE_CHECKLIST = [
  "Use a Suspense wrapper when route logic calls useSearchParams().",
  "Keep useSearchParams() inside an inner component, not at top-level page export.",
  "Load report metadata via /api/reports/config?route=<route> and keep graceful fallback title/description.",
  "Load rows via /api/reports/<route>?include_meta=1&include_rows=1&anonymize=0|1 plus active filters.",
  "Listen for analytics:anonymize-change and refetch report rows.",
  "Use ReportHeader, ReportContainer, ReportErrorBanner, MetaChip, and ReportTable for styling consistency.",
  "Use stable row keys in tables (prefer sis_user_id + relevant dimensions).",
  "Show explicit loading state and empty state text.",
  "Treat API failures as user-visible errors without crashing page render.",
] as const;

export const REPORT_TEMPLATE_TSX_SNIPPET = `
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { ReportTable, type ReportTableColumn } from "../_components/ReportTable";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { MetaChip } from "../_components/MetaChip";
import {
  buildReportQuery,
  type TemplateReportConfigResponse,
  type TemplateReportResponse,
} from "../report-template";

type Row = {
  // TODO: define row shape
  sis_user_id: string;
};

function ReportPageInner() {
  const searchParams = useSearchParams();
  const [title, setTitle] = useState("Loading...");
  const [description, setDescription] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchConfig();
  }, []);

  useEffect(() => {
    void fetchReport();
  }, [searchParams]);

  useEffect(() => {
    function onAnonymizeChange() {
      void fetchReport();
    }
    window.addEventListener("analytics:anonymize-change", onAnonymizeChange);
    return () => window.removeEventListener("analytics:anonymize-change", onAnonymizeChange);
  }, [searchParams]);

  async function fetchConfig() {
    try {
      const res = await fetch("/api/reports/config?route=<route>");
      const json = (await res.json()) as TemplateReportConfigResponse;
      if (!res.ok) throw new Error(json.error || "Request failed");
      if (json.config) {
        setTitle(String(json.config.title ?? title));
        setDescription(json.config.description ?? null);
      }
    } catch {
      // Keep fallback header when config fails.
    }
  }

  async function fetchReport() {
    setLoading(true);
    setError(null);
    try {
      const params = buildReportQuery({
        searchParams,
        includeMeta: true,
        includeRows: true,
        knownFilterKeys: ["academic_year", "program_code", "campus_code"],
      });
      const res = await fetch("/api/reports/<route>?" + params.toString());
      const json = (await res.json()) as TemplateReportResponse<Row>;
      if (!res.ok) throw new Error(json.error || "Request failed");
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e: unknown) {
      setRows([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const columns = useMemo<ReportTableColumn<Row>[]>(() => {
    return [
      // TODO: define table columns
      { id: "sis_user_id", header: "SIS User", accessor: "sis_user_id", columnType: "text" },
    ];
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ReportHeader title={title} description={description} />
      {error && <ReportErrorBanner className="mt-4" message={error} />}
      <ReportContainer className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Report Data</h2>
          <MetaChip>Rows: {rows.length}</MetaChip>
        </div>
        {loading ? (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>Loading...</div>
        ) : (
          <ReportTable
            rows={rows}
            columns={columns}
            defaultSort={{ columnId: "sis_user_id", direction: "asc" }}
            rowKey={(row, index) => row.sis_user_id + "-" + index}
            emptyText="No rows found."
          />
        )}
      </ReportContainer>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl">
          <ReportHeader title="<Report Title>" description={null} />
          <ReportContainer className="mt-5">
            <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>Loading...</div>
          </ReportContainer>
        </div>
      }
    >
      <ReportPageInner />
    </Suspense>
  );
}
`.trim();

import { useCallback, useEffect, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { getAnonymizeEnabled, type TemplateReportConfigResponse } from "../report-template";

type UseReportPageDataArgs<TRow> = {
  route: string;
  searchParams: ReadonlyURLSearchParams;
  initialTitle: string;
  initialDescription?: string | null;
  initialRows: TRow[] | null;
  resetRowsBeforeFetch?: TRow[] | null;
  rowsOnFetchError?: TRow[] | null;
  fetchRows: (args: {
    searchParams: URLSearchParams | ReadonlyURLSearchParams;
    anonymize: boolean;
  }) => Promise<TRow[]>;
};

export function useReportPageData<TRow>({
  route,
  searchParams,
  initialTitle,
  initialDescription = null,
  initialRows,
  resetRowsBeforeFetch,
  rowsOnFetchError,
  fetchRows,
}: UseReportPageDataArgs<TRow>) {
  const searchParamsKey = searchParams.toString();
  const [reportTitle, setReportTitle] = useState(initialTitle);
  const [reportDescription, setReportDescription] = useState<string | null>(initialDescription);
  const [rows, setRows] = useState<TRow[] | null>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);

    if (resetRowsBeforeFetch !== undefined) {
      setRows(resetRowsBeforeFetch);
    }

    try {
      const data = await fetchRows({
        searchParams: new URLSearchParams(searchParamsKey),
        anonymize: getAnonymizeEnabled(),
      });
      setRows(data);
    } catch (e: unknown) {
      setRows(rowsOnFetchError ?? initialRows);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchRows, initialRows, resetRowsBeforeFetch, rowsOnFetchError, searchParamsKey]);

  useEffect(() => {
    async function fetchReportConfig() {
      try {
        const res = await fetch(`/api/reports/config?route=${route}`);
        const json = (await res.json()) as TemplateReportConfigResponse;
        if (!res.ok) {
          throw new Error(json.error || "Request failed");
        }
        if (json.config) {
          setReportTitle(String(json.config.title ?? initialTitle));
          setReportDescription(json.config.description ?? null);
        }
      } catch {
        // Keep local fallback title/description if metadata fails.
      }
    }

    void fetchReportConfig();
  }, [initialTitle, route]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onAnonymizeChange() {
      void refresh();
    }

    window.addEventListener("analytics:anonymize-change", onAnonymizeChange);
    return () => {
      window.removeEventListener("analytics:anonymize-change", onAnonymizeChange);
    };
  }, [refresh]);

  return {
    reportTitle,
    reportDescription,
    rows,
    loading,
    error,
    refresh,
    setRows,
  };
}

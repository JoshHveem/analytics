"use client";

import { useEffect, useState } from "react";
import ReportComponentTableEdit from "./ReportComponentTableEdit";
import ReportComponentConditionalBarEdit from "./ReportComponentConditionalBarEdit";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";

type ConfigResponse = {
  ok: boolean;
  config?: {
    component_code?: string;
  };
  error?: string;
};

export default function ReportComponentEditClient(args: { reportId: string; reportComponentId: string }) {
  const { reportId, reportComponentId } = args;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [componentCode, setComponentCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadComponentCode() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reports/components/table-config?report_id=${encodeURIComponent(reportId)}&report_component_id=${encodeURIComponent(reportComponentId)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as ConfigResponse;
        if (!res.ok || !json.config) {
          throw new Error(json.error || "Failed to load component config");
        }
        const nextComponentCode = String(json.config.component_code ?? "").trim();
        if (!nextComponentCode) {
          throw new Error('Missing component_code in table-config response');
        }
        if (!cancelled) {
          setComponentCode(nextComponentCode);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(String(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadComponentCode();
    return () => {
      cancelled = true;
    };
  }, [reportComponentId, reportId]);

  if (error) {
    return <ReportErrorBanner className="mt-4" message={error} />;
  }

  if (loading) {
    return (
      <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
        Loading component editor...
      </div>
    );
  }

  if (componentCode === "conditional_bar") {
    return <ReportComponentConditionalBarEdit reportId={reportId} reportComponentId={reportComponentId} />;
  }

  if (componentCode === "table") {
    return <ReportComponentTableEdit reportId={reportId} reportComponentId={reportComponentId} />;
  }

  return (
    <ReportErrorBanner
      className="mt-4"
      message={`No editor implemented in code for component_code "${componentCode ?? ""}".`}
    />
  );
}

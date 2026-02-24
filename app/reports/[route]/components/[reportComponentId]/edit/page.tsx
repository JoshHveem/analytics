import { requireAuth } from "@/lib/auth";
import { ReportContainer } from "../../../../_components/ReportContainer";
import { ReportPageSuspense } from "../../../../_components/ReportPageSuspense";
import ReportComponentEditClient from "../../../../_reportComponents/ReportComponentEditClient";

export default async function ReportComponentEditPage({
  params,
}: {
  params: Promise<{ route: string; reportComponentId: string }>;
}) {
  const user = await requireAuth();
  const { route, reportComponentId } = await params;

  if (!user.is_admin) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <ReportContainer className="mt-6">
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Admin access is required to edit report metadata.
          </div>
        </ReportContainer>
      </div>
    );
  }

  return (
    <ReportPageSuspense title="Edit Report Component" maxWidthClassName="max-w-6xl">
      <ReportComponentEditClient reportId={route} reportComponentId={reportComponentId} />
    </ReportPageSuspense>
  );
}


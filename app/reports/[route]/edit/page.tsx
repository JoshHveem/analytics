import { requireAuth } from "@/lib/auth";
import ReportEditorClient from "../../_components/ReportEditorClient";
import { ReportContainer } from "../../_components/ReportContainer";
import { ReportPageSuspense } from "../../_components/ReportPageSuspense";

export default async function ReportEditPage({
  params,
}: {
  params: Promise<{ route: string }>;
}) {
  const { route } = await params;
  const user = await requireAuth();

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
    <ReportPageSuspense title="Edit Report" maxWidthClassName="max-w-6xl">
      <ReportEditorClient reportId={route} />
    </ReportPageSuspense>
  );
}

import { Suspense, type ReactNode } from "react";
import { ReportHeader } from "./ReportHeader";
import { ReportContainer } from "./ReportContainer";

type ReportPageSuspenseProps = {
  title: string;
  maxWidthClassName?: string;
  children: ReactNode;
};

export function ReportPageSuspense({
  title,
  maxWidthClassName = "max-w-6xl",
  children,
}: ReportPageSuspenseProps) {
  return (
    <Suspense
      fallback={
        <div className={`mx-auto w-full ${maxWidthClassName}`}>
          <ReportHeader title={title} description={null} />
          <ReportContainer className="mt-5">
            <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
              Loading...
            </div>
          </ReportContainer>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

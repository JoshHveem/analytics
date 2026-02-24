"use client";

import { InfoModalTrigger } from "@/app/_components/InfoModalTrigger";
import type { ReactNode } from "react";

type ReportHeaderProps = {
  title: string;
  description?: string | null;
  action?: ReactNode;
};

export function ReportHeader({ title, description, action }: ReportHeaderProps) {
  const hasDescription = Boolean(description && description.trim().length > 0);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {hasDescription && (
          <InfoModalTrigger
            header={title}
            body={description}
            triggerAriaLabel={`Show description for ${title}`}
            dialogId="report-description-dialog"
            closeButtonLabel="Close report description"
          />
        )}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

"use client";

import { InfoModalTrigger } from "@/app/_components/InfoModalTrigger";

type ReportHeaderProps = {
  title: string;
  description?: string | null;
};

export function ReportHeader({ title, description }: ReportHeaderProps) {
  const hasDescription = Boolean(description && description.trim().length > 0);

  return (
    <div>
      <div className="flex items-center gap-2">
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
    </div>
  );
}

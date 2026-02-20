"use client";

import { type ReactNode, useRef, useState } from "react";
import { CenteredModal } from "@/app/_components/CenteredModal";

type InfoModalTriggerProps = {
  header: string;
  body: ReactNode;
  triggerAriaLabel: string;
  dialogId?: string;
  closeButtonLabel?: string;
};

export function InfoModalTrigger({
  header,
  body,
  triggerAriaLabel,
  dialogId,
  closeButtonLabel = "Close info",
}: InfoModalTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="h-5 w-5 rounded-full border text-xs font-semibold"
        style={{
          borderColor: "var(--app-border)",
          color: "var(--app-text-muted)",
          backgroundColor: "var(--app-surface)",
        }}
        aria-label={triggerAriaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
      >
        ?
      </button>
      <CenteredModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={header}
        restoreFocusTo={triggerRef.current}
        dialogId={dialogId}
        closeButtonLabel={closeButtonLabel}
      >
        {body}
      </CenteredModal>
    </>
  );
}

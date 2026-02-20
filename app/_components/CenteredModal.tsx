"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

type CenteredModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  restoreFocusTo?: HTMLElement | null;
  dialogId?: string;
  maxWidthClassName?: string;
  closeButtonLabel?: string;
  closeButtonText?: string;
};

export function CenteredModal({
  isOpen,
  onClose,
  title,
  children,
  restoreFocusTo = null,
  dialogId,
  maxWidthClassName = "max-w-md",
  closeButtonLabel = "Close dialog",
  closeButtonText = "X",
}: CenteredModalProps) {
  const fallbackId = useId();
  const resolvedDialogId = dialogId ?? `centered-modal-${fallbackId}`;
  const titleId = `${resolvedDialogId}-title`;
  const descriptionId = `${resolvedDialogId}-description`;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener("keydown", onKeyDown);
      restoreFocusTo?.focus();
    };
  }, [isOpen, onClose, restoreFocusTo]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "var(--app-overlay)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        id={resolvedDialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`w-full ${maxWidthClassName} rounded-lg border p-4 shadow-2xl`}
        style={{
          borderColor: "var(--app-border)",
          backgroundColor: "var(--app-surface)",
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold" style={{ color: "var(--app-text-strong)" }}>
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded border px-2 py-1 text-xs font-medium"
            style={{
              borderColor: "var(--app-border)",
              color: "var(--app-text-muted)",
              backgroundColor: "var(--app-surface)",
            }}
            aria-label={closeButtonLabel}
          >
            {closeButtonText}
          </button>
        </div>
        <div id={descriptionId} className="whitespace-pre-line text-sm" style={{ color: "var(--app-text-muted)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

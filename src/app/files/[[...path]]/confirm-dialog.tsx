"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
};

// A modal that asks before something big happens (Trash, moving files). Escape, Cancel or a
// click outside closes it; focus starts on Cancel so Enter never confirms by accident.
export function ConfirmDialog({ open, title, confirmLabel, danger, busy, onConfirm, onCancel, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      cancel.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialog.current) onCancel();
      }}
      className="panel m-auto w-[min(34rem,calc(100vw-2rem))] p-0 text-foreground"
    >
      <div className="flex max-h-[calc(100vh-4rem)] flex-col gap-4 p-5">
        <h2 className="text-xl font-medium">{title}</h2>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">{children}</div>
        <div className="flex justify-end gap-3">
          <button ref={cancel} type="button" className="btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className={danger ? "btn-quiet border-(--down) text-(--down)" : "btn-primary"}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

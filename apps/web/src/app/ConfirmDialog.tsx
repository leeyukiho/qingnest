import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy, Loader2, X } from "lucide-react";

export function ConfirmDialog({
  busy = false,
  confirmLabel = "确认",
  description,
  destructive = false,
  error,
  confirmationText,
  onCancel,
  onConfirm,
  open,
  title,
}: {
  busy?: boolean;
  confirmLabel?: string;
  description: string;
  destructive?: boolean;
  error?: string | null;
  confirmationText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [copied, setCopied] = useState(false);
  const confirmed = !confirmationText || confirmation === confirmationText;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);
  useEffect(() => {
    if (!open) return;
    setConfirmation("");
    setCopied(false);
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        aria-describedby="confirm-dialog-description"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-md border border-white/20 bg-zinc-950 p-5 shadow-2xl"
        role="alertdialog"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${destructive ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-white/15 text-zinc-300"}`}
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-base font-semibold text-white"
              id="confirm-dialog-title"
            >
              {title}
            </h2>
            <p
              className="mt-2 break-words text-sm leading-6 text-zinc-400"
              id="confirm-dialog-description"
            >
              {description}
            </p>
          </div>
          <button
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {confirmationText ? (
          <div className="mt-5">
            <p className="text-sm text-zinc-400">请输入以下内容以确认操作：</p>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2 rounded-md border border-white/15 bg-black px-3 py-2">
              <code className="min-w-0 truncate text-sm font-medium text-zinc-200">{confirmationText}</code>
              <button aria-label="复制确认内容" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-400 hover:bg-white/10 hover:text-white" onClick={async () => { await navigator.clipboard.writeText(confirmationText); setCopied(true); }} type="button">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "已复制" : "复制"}</button>
            </div>
            <label className="mt-3 grid gap-2 text-sm text-zinc-300">确认内容<input autoComplete="off" autoFocus className="h-10 w-full rounded-md border border-white/20 bg-black px-3 text-white outline-none placeholder:text-zinc-600 focus:border-white/50" disabled={busy} onChange={(event) => setConfirmation(event.target.value)} placeholder={confirmationText} value={confirmation} /></label>
          </div>
        ) : null}
        {error ? (
          <p aria-live="assertive" className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm leading-5 text-red-200">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="h-9 rounded-md border border-white/15 px-3 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${destructive ? "bg-red-500 text-white hover:bg-red-400" : "bg-white text-black hover:bg-zinc-200"}`}
            disabled={busy || !confirmed}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

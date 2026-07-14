import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "info" | "success" | "error";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 5000 : 3500);
  }, [dismiss]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" ? createPortal(
        <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-7">
          {toasts.map((toast) => {
            const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertCircle : Info;
            return (
              <div className={cn("pointer-events-auto flex min-h-11 w-fit max-w-[min(92vw,32rem)] items-center gap-3 rounded-md border bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 shadow-2xl", toast.tone === "error" ? "border-red-400/40" : toast.tone === "success" ? "border-emerald-400/40" : "border-white/20")} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 leading-5">{toast.message}</span>
                <button aria-label="关闭提示" className="ml-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-zinc-500 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => dismiss(toast.id)} type="button">
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}

export function ToastMessage({ message, tone = "error" }: { message: string | null; tone?: ToastTone }) {
  const { showToast } = useToast();

  useEffect(() => {
    if (message) showToast(message, tone);
  }, [message, showToast, tone]);

  return null;
}

import { ChevronRight } from "lucide-react";
import { STUDIO_TITLE_CLASS } from "@/app/ui";

export function StudioBreadcrumbTitle({ backLabel, currentLabel, onBack }: { backLabel: string; currentLabel: string; onBack: () => void }) {
  return <h1 className={`${STUDIO_TITLE_CLASS} flex min-w-0 items-center gap-2`}><button className="min-w-0 cursor-pointer truncate text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={onBack} type="button">{backLabel}</button><ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-700" /><span className="min-w-0 truncate text-white">{currentLabel}</span></h1>;
}

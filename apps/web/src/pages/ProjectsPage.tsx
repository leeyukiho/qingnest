import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowRight, ExternalLink, FolderKanban, Globe2, Lock, Plus } from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { getStatusLabel } from "@/app/deployment-view";
import { StudioLoading } from "@/app/feedback";
import { STUDIO_PATH, STUDIO_PROJECTS_PATH } from "@/app/navigation";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECONDARY_BUTTON_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import { listProjects, type AccountProfile, type ProjectSummary } from "@/lib/api";

export function ProjectsPage({ account, authReady, onNavigate, session }: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    listProjects().then(setProjects).catch((cause) => setError(cause instanceof Error ? cause.message : "项目加载失败")).finally(() => setLoading(false));
  }, [session]);

  if (!authReady || (session && loading)) return <StudioLoading account={account} active="projects" label="正在读取项目" onNavigate={onNavigate} />;

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="projects" onNavigate={onNavigate} />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <h1 className={STUDIO_TITLE_CLASS}>我的项目</h1>
              <button className={STUDIO_SECONDARY_BUTTON_CLASS} onClick={() => onNavigate(STUDIO_PATH)} type="button">
                <Plus className="h-4 w-4" />新建项目
              </button>
            </div>

            <ToastMessage message={error} />
            {!loading && projects.length === 0 ? (
              <div className={`${STUDIO_PANEL_CLASS} mt-5 flex min-h-64 flex-col items-center justify-center p-8 text-center`}>
                <FolderKanban className="h-7 w-7 text-zinc-500" />
                <h2 className="mt-4 text-base font-semibold">还没有项目</h2>
                <button className={`${STUDIO_SECONDARY_BUTTON_CLASS} mt-5`} onClick={() => onNavigate(STUDIO_PATH)} type="button">创建第一个项目</button>
              </div>
            ) : (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => (
                  <article className={`${STUDIO_PANEL_CLASS} flex min-h-44 flex-col p-5`} key={project.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-white">{project.name}</h2>
                        <p className="mt-2 flex items-center gap-1.5 truncate text-sm text-zinc-500">{project.visibility === "public" ? <Globe2 className="h-3.5 w-3.5 shrink-0" /> : <Lock className="h-3.5 w-3.5 shrink-0" />}{project.visibility === "public" ? project.subdomain : "仅自己可见"}</p>
                      </div>
                      <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-400">{project.visibility === "public" ? "已公开" : getStatusLabel(project.status)}</span>
                    </div>
                    <p className="mt-5 text-xs text-zinc-600">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN")}</p>
                    <div className="mt-auto flex items-center gap-2 pt-5">
                      <button className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-white/10 px-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/15" onClick={() => onNavigate(`${STUDIO_PROJECTS_PATH}/${project.id}`)} type="button">
                        管理项目<ArrowRight className="h-4 w-4" />
                      </button>
                      {project.publicUrl ? <a aria-label="访问站点" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white" href={project.publicUrl} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" /></a> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

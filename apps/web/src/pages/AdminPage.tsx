import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Crown, LayoutDashboard, Loader2, Lock, LogIn } from "lucide-react";
import { getAdminOverview, type AccountProfile, type AdminOverview } from "@/lib/api";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { RouteMessage, StudioLoading } from "@/app/feedback";
import { STUDIO_PATH } from "@/app/navigation";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_EYEBROW_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECONDARY_BUTTON_CLASS,
  STUDIO_TITLE_CLASS,
  STUDIO_SECTION_CLASS
} from "@/app/ui";
import { cn } from "@/lib/utils";

export function AdminPage({
  account,
  authReady,
  onNavigate,
  session
}: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session || account?.role !== "admin") return;

    let active = true;
    setLoading(true);
    setError(null);

    getAdminOverview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((adminError) => {
        const text = adminError instanceof Error ? adminError.message : "无法读取管理员数据";
        if (active) setError(text);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [account?.role, session]);

  if (!authReady) {
    return <StudioLoading account={account} active="admin" label="正在读取账号" onNavigate={onNavigate} />;
  }

  if (!session) {
    return (
      <RouteMessage
        actionLabel="登录"
        icon={LogIn}
        message="管理员面板需要登录。"
        onAction={() => onNavigate("/auth")}
        title="登录后继续"
      />
    );
  }

  if (account && account.role !== "admin") {
    return (
      <div className="min-h-dvh bg-black">
        <section className={STUDIO_SECTION_CLASS}>
          <div className={STUDIO_CONTENT_SHELL_CLASS}>
            <StudioSidebar account={account} active="admin" onNavigate={onNavigate} />
            <div className="mx-auto flex min-h-[calc(100dvh-6rem)] w-full min-w-0 max-w-5xl items-center justify-center">
              <div className="max-w-xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-md border border-white/20 bg-black text-white">
                  <Lock className="h-5 w-5" />
                </span>
                <h1 className="mt-5 text-4xl font-bold tracking-normal text-white">需要管理员权限</h1>
                <p className="mt-4 text-base leading-7 text-zinc-300">
                  当前账号是用户权限。管理员角色需要在 Supabase profiles.role 中由服务端或 SQL 设置。
                </p>
                <button
                  className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/20 bg-black px-5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white hover:text-black"
                  onClick={() => onNavigate(STUDIO_PATH)}
                  type="button"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  回到工作台
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const stats = overview
    ? [
        ["用户", overview.users],
        ["站点", overview.sites],
        ["已发布", overview.activeSites],
        ["待审核", overview.pendingReviewSites],
        ["部署", overview.deployments]
      ]
    : [];

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>

          <StudioSidebar account={account} active="admin" onNavigate={onNavigate} />

          <div className={STUDIO_MAIN_CLASS}>

        <div className={STUDIO_HEADER_CLASS}>
          <div>
            <p className={STUDIO_EYEBROW_CLASS}>
              <Crown className="h-4 w-4" />
              管理员
            </p>
            <h1 className={STUDIO_TITLE_CLASS}>平台概览</h1>
          </div>
          <button
            className={STUDIO_SECONDARY_BUTTON_CLASS}
            onClick={() => onNavigate(STUDIO_PATH)}
            type="button"
          >
            <LayoutDashboard className="h-4 w-4" />
            工作台
          </button>
        </div>

        {loading ? (
          <div className="mt-5 flex items-center gap-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取数据
          </div>
        ) : null}

        <ToastMessage message={error} />

        {overview ? (
          <div className={cn(STUDIO_PANEL_CLASS, "mt-5 grid overflow-hidden sm:grid-cols-2 lg:grid-cols-5")}>
            {stats.map(([label, value]) => (
              <div className="border-b border-white/20 p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:border-white/20 lg:border-b-0 lg:border-r lg:last:border-r-0" key={label}>
                <p className="text-sm font-medium text-zinc-500">{label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-normal text-white">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
          </div>

        </div>

      </section>
    </div>
  );
}

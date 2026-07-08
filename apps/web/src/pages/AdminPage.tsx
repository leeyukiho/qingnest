import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Crown, LayoutDashboard, Loader2, Lock, LogIn } from "lucide-react";
import { getAdminOverview, type AccountProfile, type AdminOverview } from "@/lib/api";
import { AuroraHero } from "@/components/ui/hero-2";
import { StudioSidebar } from "@/app/StudioSidebar";
import { LoadingScreen, RouteMessage } from "@/app/feedback";
import { STUDIO_PATH } from "@/app/navigation";

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
    return <LoadingScreen label="正在读取账号" />;
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
      <RouteMessage
        actionLabel="回到工作台"
        icon={Lock}
        message="当前账号是用户权限。管理员角色需要在 Supabase profiles.role 中由服务端或 SQL 设置。"
        onAction={() => onNavigate(STUDIO_PATH)}
        title="需要管理员权限"
      />
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
    <AuroraHero className="min-h-dvh">
      <section className="min-h-dvh w-full pb-10 pt-24">
        <div className="mx-auto grid w-[calc(100vw-32px)] max-w-[92rem] gap-y-5 sm:w-[calc(100vw-48px)] lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-20 xl:gap-x-28">

          <StudioSidebar account={account} active="admin" onNavigate={onNavigate} />

          <div className="mx-auto w-full max-w-5xl justify-self-center">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-100">
              <Crown className="h-4 w-4" />
              管理员
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white">平台概览</h1>
          </div>
          <button
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => onNavigate(STUDIO_PATH)}
            type="button"
          >
            <LayoutDashboard className="h-4 w-4" />
            工作台
          </button>
        </div>

        {loading ? (
          <div className="mt-8 flex items-center gap-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取数据
          </div>
        ) : null}

        {error ? (
          <p className="mt-8 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
            {error}
          </p>
        ) : null}

        {overview ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map(([label, value]) => (
              <div className="glass-surface rounded-lg p-4" key={label}>
                <p className="text-sm font-medium text-zinc-500">{label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-normal text-white">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
          </div>

        </div>

      </section>
    </AuroraHero>
  );
}

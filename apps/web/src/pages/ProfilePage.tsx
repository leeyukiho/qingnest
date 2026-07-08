import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BadgeCheck, Crown, LayoutDashboard, Loader2, Lock, LogOut, Plus, UserRound } from "lucide-react";
import type { AccountProfile } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { AuroraHero } from "@/components/ui/hero-2";
import { StudioSidebar } from "@/app/StudioSidebar";
import { isSessionEmailConfirmed } from "@/app/auth";
import { STUDIO_ADMIN_PATH, STUDIO_PATH } from "@/app/navigation";
import { LoadingScreen } from "@/app/feedback";
import { cn } from "@/lib/utils";

export function ProfilePage({
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
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authReady) {
    return <LoadingScreen label="正在读取账号" />;
  }

  if (!session) {
    return <LoadingScreen label="正在跳转登录" />;
  }

  const emailConfirmed = account?.emailConfirmed ?? isSessionEmailConfirmed(session);
  const roleLabel = account?.role === "admin" ? "管理员" : "用户";
  const displayEmail = account?.email ?? session.user.email ?? "未绑定邮箱";
  const createdAt = account?.createdAt ?? session.user.created_at;
  const createdDate = createdAt ? new Date(createdAt).toLocaleDateString("zh-CN") : "未知";

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);

    try {
      await supabase?.auth.signOut();
      onNavigate("/");
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "退出登录失败");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <AuroraHero className="min-h-dvh">
      <section className="min-h-dvh w-full pb-10 pt-24">
        <div className="mx-auto grid w-[calc(100vw-32px)] max-w-[92rem] gap-y-5 sm:w-[calc(100vw-48px)] lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-20 xl:gap-x-28">

          <StudioSidebar account={account} active="profile" onNavigate={onNavigate} />

          <div className="mx-auto w-full max-w-3xl justify-self-center">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100">
                <UserRound className="h-4 w-4" />
                个人中心
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white">账号信息</h1>
            </div>
            <button
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
              onClick={() => onNavigate(STUDIO_PATH)}
              type="button"
            >
              <Plus className="h-4 w-4" />
              创建站点
            </button>
          </div>

          <div className="glass-surface mt-6 rounded-lg p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white">
                {account?.role === "admin" ? <Crown className="h-6 w-6" /> : <UserRound className="h-6 w-6" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">{displayEmail}</p>
                <p className="mt-1 text-sm font-medium text-zinc-500">{roleLabel} · {account?.plan ?? "free"}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["邮箱状态", emailConfirmed ? "已验证" : "未验证"],
                ["套餐", account?.plan ?? "free"],
                ["注册时间", createdDate]
              ].map(([label, value]) => (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3" key={label}>
                  <p className="text-xs font-medium text-zinc-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-100">{value}</p>
                </div>
              ))}
            </div>

            <div
              className={cn(
                "mt-5 flex items-start gap-3 rounded-lg border px-3 py-3 text-sm leading-6",
                emailConfirmed
                  ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  : "border-amber-300/20 bg-amber-400/10 text-amber-100"
              )}
            >
              {emailConfirmed ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{emailConfirmed ? "邮箱已验证，可以发布站点。" : "邮箱未验证，创建站点前必须验证。"}</span>
            </div>

            {error ? (
              <p className="mt-4 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {account?.role === "admin" ? (
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={() => onNavigate(STUDIO_ADMIN_PATH)}
                  type="button"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  管理员面板
                </button>
              ) : null}
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                disabled={signingOut}
                onClick={handleSignOut}
                type="button"
              >
                {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                退出登录
              </button>
            </div>
          </div>
          </div>

        </div>
      </section>
    </AuroraHero>
  );
}

import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BadgeCheck, Crown, LayoutDashboard, Loader2, Lock, LogOut, Plus, UserRound } from "lucide-react";
import type { AccountProfile } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { StudioSidebar } from "@/app/StudioSidebar";
import { ToastMessage } from "@/app/toast";
import { isSessionEmailConfirmed } from "@/app/auth";
import { STUDIO_ADMIN_PATH, STUDIO_PATH } from "@/app/navigation";
import { StudioLoading } from "@/app/feedback";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_DETAIL_CELL_CLASS,
  STUDIO_DETAIL_GRID_CLASS,
  STUDIO_EYEBROW_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECONDARY_BUTTON_CLASS,
  STUDIO_TITLE_CLASS,
  STUDIO_SECTION_CLASS
} from "@/app/ui";
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
    return <StudioLoading account={account} active="profile" label="正在读取账号" onNavigate={onNavigate} />;
  }

  if (!session) {
    return <StudioLoading account={account} active="profile" label="正在跳转登录" onNavigate={onNavigate} />;
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
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>

          <StudioSidebar account={account} active="profile" onNavigate={onNavigate} />

          <div className={STUDIO_MAIN_CLASS}>
          <div className={STUDIO_HEADER_CLASS}>
            <div>
              <p className={STUDIO_EYEBROW_CLASS}>
                <UserRound className="h-4 w-4" />
                个人中心
              </p>
              <h1 className={STUDIO_TITLE_CLASS}>账号信息</h1>
            </div>
            <button
              className={STUDIO_SECONDARY_BUTTON_CLASS}
              onClick={() => onNavigate(STUDIO_PATH)}
              type="button"
            >
              <Plus className="h-4 w-4" />
              创建站点
            </button>
          </div>

          <div className={cn(STUDIO_PANEL_CLASS, "mt-5 p-5 sm:p-6")}>
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/20 bg-black text-white">
                {account?.role === "admin" ? <Crown className="h-6 w-6" /> : <UserRound className="h-6 w-6" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">{displayEmail}</p>
                <p className="mt-1 text-sm font-medium text-zinc-500">{roleLabel} · {account?.plan ?? "free"}</p>
              </div>
            </div>

            <div className={cn(STUDIO_DETAIL_GRID_CLASS, "mt-6 sm:grid-cols-3")}>
              {[
                ["邮箱状态", emailConfirmed ? "已验证" : "未验证"],
                ["套餐", account?.plan ?? "free"],
                ["注册时间", createdDate]
              ].map(([label, value]) => (
                <div className={STUDIO_DETAIL_CELL_CLASS} key={label}>
                  <p className="text-xs font-medium text-zinc-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-100">{value}</p>
                </div>
              ))}
            </div>

            <div
              className={cn(
                "mt-5 flex items-start gap-3 rounded-md border px-3 py-3 text-sm leading-6",
                emailConfirmed ? "border-white/30 bg-black text-zinc-200" : "border-white/30 bg-black text-zinc-200"
              )}
            >
              {emailConfirmed ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{emailConfirmed ? "邮箱已验证，可以发布站点。" : "邮箱未验证，创建站点前必须验证。"}</span>
            </div>

            <ToastMessage message={error} />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {account?.role === "admin" ? (
                <button
                  className={STUDIO_SECONDARY_BUTTON_CLASS}
                  onClick={() => onNavigate(STUDIO_ADMIN_PATH)}
                  type="button"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  管理员面板
                </button>
              ) : null}
              <button
                className={cn(STUDIO_SECONDARY_BUTTON_CLASS, "disabled:opacity-50")}
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
    </div>
  );
}

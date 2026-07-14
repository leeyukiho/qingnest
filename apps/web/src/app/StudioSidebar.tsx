import { FolderKanban, Plus, Settings, UserRound, type LucideIcon } from "lucide-react";
import type { AccountProfile } from "@/lib/api";
import { STUDIO_ADMIN_PATH, STUDIO_PATH, STUDIO_PROFILE_PATH, STUDIO_PROJECTS_PATH } from "@/app/navigation";
import { cn } from "@/lib/utils";

type StudioNavItem = {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

export function StudioSidebar({
  account,
  active,
  onNavigate
}: {
  account: AccountProfile | null;
  active: "create" | "projects" | "profile" | "admin";
  onNavigate: (path: string) => void;
}) {
  const navItems: StudioNavItem[] = [
    {
      active: active === "create",
      icon: Plus,
      label: "新建项目",
      onClick: () => onNavigate(STUDIO_PATH)
    },
    {
      active: active === "projects",
      icon: FolderKanban,
      label: "我的项目",
      onClick: () => onNavigate(STUDIO_PROJECTS_PATH)
    },
    {
      active: active === "profile",
      icon: UserRound,
      label: "账户",
      onClick: () => onNavigate(STUDIO_PROFILE_PATH)
    },
    ...(account?.role === "admin"
      ? [
          {
            active: active === "admin",
            icon: Settings,
            label: "管理",
            onClick: () => onNavigate(STUDIO_ADMIN_PATH)
          }
        ]
      : [])
  ];

  return (
    <aside
      className="h-fit w-full min-w-0 overflow-hidden rounded-md border border-white/20 bg-black p-3 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:h-dvh lg:w-56 lg:overflow-visible lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:p-4 lg:pb-6 lg:pt-24"
    >
      <nav
        aria-label="Studio"
        className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
      >
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "group flex min-w-36 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors lg:min-w-0",
                item.active
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-transparent bg-transparent text-zinc-500 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200"
              )}
              key={item.label}
              onClick={item.onClick}
              type="button"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

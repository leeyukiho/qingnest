import { Rocket, Settings, UserRound, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { AccountProfile } from "@/lib/api";
import { STUDIO_ADMIN_PATH, STUDIO_PATH, STUDIO_PROFILE_PATH } from "@/app/navigation";
import { cn } from "@/lib/utils";

type StudioNavItem = {
  active: boolean;
  detail: string;
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
  active: "create" | "profile" | "admin";
  onNavigate: (path: string) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const navItems: StudioNavItem[] = [
    {
      active: active === "create",
      detail: "Upload and publish",
      icon: Rocket,
      label: "Create site",
      onClick: () => onNavigate(STUDIO_PATH)
    },
    {
      active: active === "profile",
      detail: "Profile and plan",
      icon: UserRound,
      label: "Account",
      onClick: () => onNavigate(STUDIO_PROFILE_PATH)
    },
    ...(account?.role === "admin"
      ? [
          {
            active: active === "admin",
            detail: "Platform settings",
            icon: Settings,
            label: "Admin",
            onClick: () => onNavigate(STUDIO_ADMIN_PATH)
          }
        ]
      : [])
  ];

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      className="h-fit w-full min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] will-change-transform lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:h-dvh lg:w-56 lg:overflow-visible lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:p-4 lg:pb-6 lg:pt-24"
      initial={shouldReduceMotion ? { opacity: 1, x: 0, filter: "blur(0px)" } : { opacity: 0, x: -32, filter: "blur(8px)" }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.nav
        animate="show"
        aria-label="Studio"
        className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
        initial={shouldReduceMotion ? "show" : "hidden"}
        variants={{
          hidden: {},
          show: {
            transition: {
              delayChildren: 0.08,
              staggerChildren: 0.045
            }
          }
        }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <motion.button
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "group flex min-w-44 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors lg:min-w-0",
                item.active
                  ? "border-black bg-white text-black"
                  : "border-transparent bg-black text-zinc-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
              )}
              key={item.label}
              onClick={item.onClick}
              type="button"
              variants={{
                hidden: { opacity: 0, x: -10 },
                show: { opacity: 1, x: 0 }
              }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className={cn("block truncate text-xs", item.active ? "text-black/55" : "text-zinc-600 group-hover:text-zinc-400")}>
                  {item.detail}
                </span>
              </span>
            </motion.button>
          );
        })}
      </motion.nav>
    </motion.aside>
  );
}

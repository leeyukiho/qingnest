import { type ReactNode, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type FloatingDockItem = {
  active?: boolean;
  href?: string;
  icon: ReactNode;
  onClick?: () => void;
  title: string;
};

interface FloatingDockProps {
  className?: string;
  items: FloatingDockItem[];
  mobileClassName?: string;
}

export function FloatingDock({ className, items, mobileClassName }: FloatingDockProps) {
  return (
    <div className={cn("flex w-full items-center justify-center", className, mobileClassName)}>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="flex h-16 items-center gap-2 rounded-full border border-white/10 bg-black/[0.58] p-2 shadow-[0_18px_70px_rgba(0,0,0,0.44),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl"
        initial={{ opacity: 0, y: 18 }}
        transition={{ delay: 0.18, duration: 0.45, ease: "easeOut" }}
      >
        {items.map((item) => (
          <DockItem item={item} key={item.title} />
        ))}
      </motion.div>
    </div>
  );
}

function DockItem({ item }: { item: FloatingDockItem }) {
  const [isHovered, setIsHovered] = useState(false);
  const sharedClassName = cn(
    "group relative flex h-12 w-12 items-center justify-center rounded-full border text-white outline-none transition-colors duration-200",
    "focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
    item.active
      ? "border-cyan-200/[0.45] bg-white/[0.16] shadow-[0_0_28px_rgba(34,211,238,0.2)]"
      : "border-white/[0.08] bg-white/[0.06] hover:border-white/20 hover:bg-white/[0.12]"
  );
  const sharedHandlers = {
    onBlur: () => setIsHovered(false),
    onFocus: () => setIsHovered(true),
    onMouseEnter: () => setIsHovered(true),
    onMouseLeave: () => setIsHovered(false)
  };
  const content = (
    <>
      <motion.span
        animate={{ scale: isHovered || item.active ? 1.12 : 1, y: isHovered ? -2 : 0 }}
        className="flex h-5 w-5 items-center justify-center"
        transition={{ type: "spring", stiffness: 360, damping: 24 }}
      >
        {item.icon}
      </motion.span>
      <motion.span
        animate={{ opacity: isHovered ? 1 : 0, y: isHovered ? -8 : -2, scale: isHovered ? 1 : 0.96 }}
        className="pointer-events-none absolute -top-11 whitespace-nowrap rounded-md border border-white/10 bg-zinc-950/[0.92] px-2.5 py-1 text-xs font-medium text-white shadow-xl"
        initial={false}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {item.title}
      </motion.span>
    </>
  );

  if (item.href) {
    return (
      <motion.a
        aria-label={item.title}
        className={sharedClassName}
        href={item.href}
        onClick={() => item.onClick?.()}
        whileTap={{ scale: 0.96 }}
        {...sharedHandlers}
      >
        {content}
      </motion.a>
    );
  }

  return (
    <motion.button
      aria-label={item.title}
      className={sharedClassName}
      onClick={() => {
        item.onClick?.();
      }}
      type="button"
      whileTap={{ scale: 0.96 }}
      {...sharedHandlers}
    >
      {content}
    </motion.button>
  );
}

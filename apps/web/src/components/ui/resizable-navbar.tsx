"use client";

import {
  createContext,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useState
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";
import { cn } from "@/lib/utils";

type NavItem = {
  name: string;
  link: string;
  onClick?: () => void;
};

type NavbarContextValue = {
  compact: boolean;
};

const NavbarContext = createContext<NavbarContextValue>({ compact: false });

function useNavbar() {
  return useContext(NavbarContext);
}

const navUnderlineClass =
  "relative inline-flex h-10 items-center justify-center text-sm font-medium tracking-normal text-zinc-300 transition-colors duration-200 hover:text-white focus:outline-none focus-visible:text-white after:pointer-events-none after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-center after:scale-x-0 after:opacity-0 after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35)_18%,rgba(255,255,255,1)_50%,rgba(255,255,255,0.35)_82%,transparent)] after:shadow-[0_0_10px_rgba(255,255,255,0.45)] after:transition-all after:duration-200 after:ease-out hover:after:scale-x-100 hover:after:opacity-100 focus-visible:after:scale-x-100 focus-visible:after:opacity-100";

export function Navbar({
  children,
  className,
  forceScrolled = false,
  showDivider = true
}: {
  children: ReactNode;
  className?: string;
  forceScrolled?: boolean;
  showDivider?: boolean;
}) {
  const [hasScrolled, setHasScrolled] = useState(false);
  const compact = forceScrolled || hasScrolled;

  useEffect(() => {
    const updateScrolled = () => setHasScrolled(window.scrollY > 18);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  return (
    <NavbarContext.Provider value={{ compact }}>
      <motion.header
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "fixed inset-x-0 top-0 z-50 w-screen bg-black/20 backdrop-blur-xl",
          showDivider ? "border-b border-white/15" : "border-b border-transparent",
          className
        )}
        initial={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.header>
    </NavbarContext.Provider>
  );
}

export function NavBody({ children, className }: { children: ReactNode; className?: string }) {
  const { compact } = useNavbar();

  return (
    <motion.nav
      animate={{
        backgroundColor: compact ? "rgba(0, 0, 0, 0.38)" : "rgba(0, 0, 0, 0.08)"
      }}
      className={cn(
        "flex h-14 w-full items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8",
        className
      )}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.nav>
  );
}

export function NavItems({ items, className }: { items: NavItem[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-6", className)}>
      {items.map((item) => (
        <a
          className={navUnderlineClass}
          href={item.link}
          key={item.name}
          onClick={() => item.onClick?.()}
        >
          {item.name}
        </a>
      ))}
    </div>
  );
}

export function NavbarLogo({
  animateSubtitle = false,
  className,
  layoutId,
  showUnderline = true,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  animateSubtitle?: boolean;
  layoutId?: string;
  showUnderline?: boolean;
}) {
  const [showAnimatedMark, setShowAnimatedMark] = useState(false);

  useEffect(() => {
    if (!animateSubtitle) {
      setShowAnimatedMark(false);
      return;
    }

    setShowAnimatedMark(true);
    const timeoutId = window.setTimeout(() => setShowAnimatedMark(false), 720);

    return () => window.clearTimeout(timeoutId);
  }, [animateSubtitle]);

  return (
    <a
      aria-label="QingNest 轻巢 home"
      className={cn(
        showUnderline ? navUnderlineClass : "relative inline-flex h-10 items-center justify-center",
        "h-11 gap-1 font-bold drop-shadow-[0_0_18px_rgba(125,211,252,0.28)]",
        className
      )}
      href="#"
      {...props}
    >
      {showAnimatedMark ? (
        <motion.span
          className="relative block aspect-[4/1] h-[1.6rem] shrink-0 overflow-visible sm:h-7"
          layout="preserve-aspect"
          layoutId={layoutId}
          transition={{ duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
        >
          <TextHoverEffect revealRadius={540} text="QingNest" />
        </motion.span>
      ) : (
        <motion.span
          animate={{ opacity: 1 }}
          className="inline-flex h-[1.6rem] w-[5.7rem] shrink-0 items-center bg-gradient-to-r from-white via-cyan-100 to-sky-200 bg-clip-text text-lg font-bold text-transparent [text-shadow:0_0_18px_rgba(125,211,252,0.24)] sm:h-7 sm:w-[6.35rem] sm:text-xl"
          initial={animateSubtitle ? { opacity: 0 } : false}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          QingNest
        </motion.span>
      )}
      <motion.span
        animate={{ opacity: 1, x: 0 }}
        className="text-base font-semibold text-cyan-100 sm:text-lg"
        initial={animateSubtitle ? { opacity: 0, x: 0 } : false}
        transition={{ delay: animateSubtitle ? 0.68 : 0, duration: 0.26, ease: "easeOut" }}
      >
        轻巢
      </motion.span>
    </a>
  );
}

export function NavbarButton({
  children,
  className,
  showUnderline = true,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  showUnderline?: boolean;
  variant?: "primary" | "secondary";
}) {
  const fullWidth = typeof className === "string" && className.includes("w-full");

  return (
    <button
      className={cn(
        showUnderline
          ? navUnderlineClass
          : "relative inline-flex h-10 items-center justify-center text-sm font-medium tracking-normal text-zinc-300 transition-colors duration-200 hover:text-white focus:outline-none focus-visible:text-white",
        "border-0 bg-transparent p-0 disabled:pointer-events-none disabled:opacity-50",
        fullWidth ? "w-full" : "w-auto",
        className
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function MobileNav({ children, className }: { children: ReactNode; className?: string }) {
  const { compact } = useNavbar();

  return (
    <motion.nav
      animate={{
        backgroundColor: compact ? "rgba(0, 0, 0, 0.38)" : "rgba(0, 0, 0, 0.08)"
      }}
      className={cn("w-full backdrop-blur-xl md:hidden", className)}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.nav>
  );
}

export function MobileNavHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex h-14 items-center justify-between px-4", className)}>{children}</div>;
}

export function MobileNavToggle({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) {
  const Icon = isOpen ? X : Menu;

  return (
    <button
      aria-label={isOpen ? "关闭导航菜单" : "打开导航菜单"}
      className={cn(navUnderlineClass, "h-9 w-9 p-0")}
      onClick={onClick}
      type="button"
    >
      <Icon
        aria-hidden="true"
        className="relative z-20 h-4 w-4 shrink-0"
        color="#ffffff"
        strokeWidth={2.4}
        style={{ flexShrink: 0, height: 16, minWidth: 16, width: 16 }}
      />
    </button>
  );
}

export function MobileNavMenu({
  children,
  className,
  isOpen,
  onClose
}: {
  children: ReactNode;
  className?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          animate={{ opacity: 1, y: 0, height: "auto" }}
          className={cn("overflow-hidden border-t border-white/10 px-4 py-4", className)}
          exit={{ opacity: 0, y: -8, height: 0 }}
          initial={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div className="flex flex-col gap-4" onClick={onClose}>
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

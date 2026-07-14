import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Globe2,
  LoaderCircle,
  Search,
  ShoppingBag,
} from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { StudioBreadcrumbTitle } from "@/app/StudioBreadcrumbTitle";
import { useToast } from "@/app/toast";
import { STUDIO_BILLING_PATH, STUDIO_DOMAINS_PATH } from "@/app/navigation";
import {
  STUDIO_CONTENT_SHELL_CLASS,
  STUDIO_HEADER_CLASS,
  STUDIO_MAIN_CLASS,
  STUDIO_PANEL_CLASS,
  STUDIO_SECTION_CLASS,
} from "@/app/ui";
import {
  checkSubdomain,
  getPlatformDomainCatalog,
  rentPublicSlot,
  type AccountProfile,
  type PlatformDomainOption,
  type SubdomainCheck,
} from "@/lib/api";
import { clientPlatformConfig } from "@/lib/platform";
import { validateSubdomain } from "@qingnest/shared/config/platform";

const domainRoot = clientPlatformConfig.domains.distributionRoot;

export function DomainPurchasePage({
  account,
  onNavigate,
}: {
  account: AccountProfile | null;
  onNavigate: (path: string) => void;
}) {
  const { showToast } = useToast();
  const [prefix, setPrefix] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<SubdomainCheck | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [domainOptions, setDomainOptions] = useState<PlatformDomainOption[]>([]);
  const [selectedSuffix, setSelectedSuffix] = useState(domainRoot);
  useEffect(() => {
    void getPlatformDomainCatalog().then((items) => {
      if (!items.length) return;
      setDomainOptions(items);
      setSelectedSuffix(items[0].hostname_suffix);
    }).catch(() => setDomainOptions([]));
  }, []);
  const localValidation = prefix.trim()
    ? validateSubdomain(prefix)
    : null;

  const handleCheck = async () => {
    const value = prefix.trim().toLowerCase();
    setCheck(null);
    if (!value) {
      return;
    }

    const validation = validateSubdomain(value);
    if (!validation.ok) {
      setChecking(false);
      setCheck({
        available: false,
        normalized: validation.normalized,
        reason: validation.reason,
      });
      return;
    }

    setChecking(true);
    try {
      setCheck(await checkSubdomain(validation.normalized, selectedSuffix));
    } catch (cause) {
      setCheck({
        available: false,
        normalized: value,
        reason: cause instanceof Error ? cause.message : "可用性检查失败",
      });
    } finally {
      setChecking(false);
    }
  };

  const handlePurchase = async () => {
    if (!check?.available || purchasing) return;
    setPurchasing(true);
    try {
      const slot = await rentPublicSlot(check.normalized, selectedSuffix);
      showToast(`${slot.hostname} 已添加到你的域名`, "success");
      onNavigate(STUDIO_DOMAINS_PATH);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "租赁失败";
      showToast(message, "error");
      setCheck({ ...check, available: false, reason: message });
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="billing" onNavigate={onNavigate} />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <div>
                <StudioBreadcrumbTitle
                  backLabel="套餐与账单"
                  currentLabel="租赁域名"
                  onBack={() => onNavigate(STUDIO_BILLING_PATH)}
                />
                <p className="mt-2 text-sm text-zinc-500">
                  选择平台已有域名，输入前缀即可检查并保留独立地址。
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}>
                <div className="flex items-start gap-3">
                  <Globe2 className="mt-0.5 h-5 w-5 text-zinc-400" />
                  <div>
                    <h2 className="text-base font-semibold">选择平台域名</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      当前开放以下域名。后续增加新后缀时会直接显示在这里。
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {(domainOptions.length ? domainOptions : [{ domain_type: "platform_subdomain", label: domainRoot, hostname_suffix: domainRoot, price_cents: 990, billing_period: "year" as const, enabled: true }]).map((option) => {
                    const selected = selectedSuffix === option.hostname_suffix;
                    return <button aria-pressed={selected} className={`flex min-h-20 cursor-pointer items-center justify-between rounded-md border p-4 text-left transition-colors ${selected ? "border-emerald-400/50 bg-emerald-400/[0.06]" : "border-white/15 hover:border-white/30"}`} key={option.domain_type} onClick={() => { setSelectedSuffix(option.hostname_suffix); setCheck(null); }} type="button"><span><span className="block text-sm font-semibold text-zinc-100">{option.hostname_suffix}</span><span className="mt-1 block text-xs text-zinc-500">¥{(option.price_cents / 100).toFixed(2)} / {option.billing_period === "month" ? "月" : option.billing_period === "year" ? "年" : "一次性"}</span></span>{selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" /> : null}</button>;
                  })}
                </div>

                <div className="mt-6">
                  <label className="text-sm font-medium text-zinc-200" htmlFor="domain-prefix">
                    地址前缀
                  </label>
                  <div className="mt-2 flex min-h-11 overflow-hidden rounded-md border border-white/15 bg-black focus-within:border-white/35">
                    <input
                      autoComplete="off"
                      className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-700"
                      disabled={checking}
                      id="domain-prefix"
                      onChange={(event) => {
                        const value = event.target.value.toLowerCase();
                        const validation = value.trim()
                          ? validateSubdomain(value)
                          : null;
                        setPrefix(value);
                        setCheck(
                          validation && !validation.ok
                            ? {
                                available: false,
                                normalized: validation.normalized,
                                reason: validation.reason,
                              }
                            : null,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void handleCheck();
                      }}
                      placeholder="例如 mypage"
                      spellCheck={false}
                      value={prefix}
                    />
                    <span className="flex shrink-0 items-center border-l border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-500">
                      .{selectedSuffix}
                    </span>
                  </div>

                  <div className="mt-3 flex min-h-10 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-h-5" aria-live="polite">
                      {checking ? (
                        <p className="flex items-center gap-2 text-sm text-zinc-500">
                          <LoaderCircle className="h-4 w-4 animate-spin" />正在检查
                        </p>
                      ) : check ? (
                        <p className={`flex items-center gap-2 text-sm ${check.available ? "text-emerald-400" : "text-red-400"}`}>
                          {check.available ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                          {check.available
                            ? `${check.normalized}.${selectedSuffix} 可以使用`
                            : check.reason ?? "该地址不可用"}
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-600">输入完成后点击检查</p>
                      )}
                    </div>
                    <button
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-white/20 bg-black px-3 text-sm font-medium text-zinc-200 transition-[border-color] hover:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!localValidation?.ok || checking}
                      onClick={() => void handleCheck()}
                      type="button"
                    >
                      {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      {checking ? "检查中" : "检查可用性"}
                    </button>
                  </div>
                </div>
              </div>

              <aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}>
                <ShoppingBag className="h-5 w-5 text-zinc-400" />
                <h2 className="mt-3 text-sm font-semibold">确认地址</h2>
                <p className="mt-2 break-all text-sm font-medium text-zinc-200">
                  {prefix.trim() ? `${prefix.trim()}.${selectedSuffix}` : `你的前缀.${selectedSuffix}`}
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-500">
                  当前未接入在线支付，本次确认不会扣款。地址会先保留在账户中，之后可绑定项目。
                </p>
                <button
                  className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white bg-white px-4 text-sm font-semibold text-black transition-[border-color,opacity] hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!check?.available || checking || purchasing}
                  onClick={handlePurchase}
                  type="button"
                >
                  {purchasing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {purchasing ? "正在保留" : "确认租赁"}
                </button>
                <button
                  className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/20 bg-black px-4 text-sm font-semibold text-zinc-200 transition-[border-color] hover:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  onClick={() => onNavigate(STUDIO_DOMAINS_PATH)}
                  type="button"
                >
                  管理已有地址
                </button>
              </aside>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

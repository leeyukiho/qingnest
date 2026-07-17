import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Globe2,
  Gift,
  LoaderCircle,
  Search,
  ShoppingBag,
} from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { useToast } from "@/app/toast";
import { STUDIO_MY_DOMAINS_PATH, STUDIO_WALLET_PATH } from "@/app/navigation";
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
  createDomainPayment,
  claimFreePublicSlot,
  type AccountProfile,
  type PlatformDomainOption,
  type SubdomainCheck,
} from "@/lib/api";
import { clientPlatformConfig } from "@/lib/platform";
import { validateSubdomain } from "@qingnest/shared/config/platform";
import { displayHostname } from "@qingnest/shared/config/domain";

const domainRoot = clientPlatformConfig.domains.distributionRoot;
const durationOptions = [
  { months: 1 as const, label: "月付", priceKey: "monthly_price_cents" as const },
  { months: 3 as const, label: "季付", priceKey: "quarterly_price_cents" as const },
  { months: 6 as const, label: "半年付", priceKey: "semiannual_price_cents" as const },
  { months: 12 as const, label: "年付", priceKey: "annual_price_cents" as const },
];

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
  const [domainQuery, setDomainQuery] = useState("");
  const [suffixFilter, setSuffixFilter] = useState("all");
  const [durationMonths, setDurationMonths] = useState<1 | 3 | 6 | 12>(12);
  const [purchaseMode, setPurchaseMode] = useState<"free" | "paid">("paid");
  const freeDomainLimit = account?.planConfig?.quotas.user.maxFreeDomains ?? 0;
  const freeDomainsRemaining = Math.max(
    0,
    freeDomainLimit - (account?.usage.freeDomains ?? 0),
  );
  const hasFreeDomainQuota = freeDomainsRemaining > 0;
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
  const availableOptions = domainOptions.length
    ? domainOptions
    : [{ domain_type: "platform_subdomain", label: domainRoot, hostname_suffix: domainRoot, price_cents: 990, billing_period: "year" as const, monthly_price_cents: 99, quarterly_price_cents: 279, semiannual_price_cents: 529, annual_price_cents: 990, enabled: true, free_claim_enabled: true }];
  const selectedOption = availableOptions.find((option) => option.hostname_suffix === selectedSuffix) ?? availableOptions[0];
  const canClaimSelectedForFree =
    hasFreeDomainQuota && selectedOption.free_claim_enabled;
  const isFreeClaim = canClaimSelectedForFree && purchaseMode === "free";
  useEffect(() => {
    setPurchaseMode(canClaimSelectedForFree ? "free" : "paid");
  }, [canClaimSelectedForFree, selectedSuffix]);
  const selectedDuration = durationOptions.find((option) => option.months === durationMonths)!;
  const selectedPrice = selectedOption[selectedDuration.priceKey];
  const suffixes = useMemo(
    () => Array.from(new Set(availableOptions.map((option) => displayHostname(option.hostname_suffix).split(".").at(-1) ?? ""))).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [domainOptions],
  );
  const filteredOptions = availableOptions.filter((option) => {
    const display = displayHostname(option.hostname_suffix);
    const query = domainQuery.trim().toLocaleLowerCase();
    return (!query || display.toLocaleLowerCase().includes(query) || option.hostname_suffix.toLowerCase().includes(query)) && (suffixFilter === "all" || display.split(".").at(-1) === suffixFilter);
  });

  const handlePurchase = async () => {
    if (purchasing || checking) return;
    const value = prefix.trim().toLowerCase();
    const validation = validateSubdomain(value);
    if (!validation.ok) {
      setCheck({ available: false, normalized: validation.normalized, reason: validation.reason });
      return;
    }
    setChecking(true);
    setCheck(null);
    let availability: SubdomainCheck;
    try {
      availability = await checkSubdomain(validation.normalized, selectedSuffix);
      setCheck(availability);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "可用性检查失败";
      setCheck({ available: false, normalized: validation.normalized, reason: message });
      setChecking(false);
      return;
    }
    setChecking(false);
    if (!availability.available) return;
    setPurchasing(true);
    try {
      if (isFreeClaim) {
        await claimFreePublicSlot(availability.normalized, selectedSuffix);
        showToast("免费域名领取成功", "success");
        onNavigate(STUDIO_MY_DOMAINS_PATH);
        return;
      }
      await createDomainPayment(`${availability.normalized}.${selectedSuffix}`, selectedSuffix, durationMonths);
      showToast("域名购买成功", "success");
      onNavigate(STUDIO_MY_DOMAINS_PATH);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "租赁失败";
      showToast(message, "error");
      setCheck({ ...availability, available: false, reason: message });
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="domains" onNavigate={onNavigate} />
          <div className={STUDIO_MAIN_CLASS}>
            <div className={STUDIO_HEADER_CLASS}>
              <div>
                <h1 className="text-xl font-semibold tracking-normal text-white sm:text-2xl">域名市场</h1>
                <p className="mt-2 text-sm text-zinc-500">
                  选择平台已有域名和租赁时长，输入前缀即可检查并保留独立地址。
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

                {hasFreeDomainQuota ? (
                  <div className="mt-5 flex items-start gap-3 rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
                    <Gift className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-100">
                        当前套餐还有 {freeDomainsRemaining} 个免费域名额度
                      </p>
                      <p className="mt-1 text-xs leading-5 text-emerald-200/60">
                        选择标有“可免费领取”的域名后，可直接使用额度，无需支付。
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-6 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label className="flex h-10 items-center gap-2 rounded-md border border-white/15 px-3 focus-within:border-white/35">
                    <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                    <span className="sr-only">搜索平台域名</span>
                    <input className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-700" onChange={(event) => setDomainQuery(event.target.value)} placeholder="搜索域名" value={domainQuery} />
                  </label>
                  <select aria-label="筛选域名后缀" className="h-10 cursor-pointer rounded-md border border-white/15 bg-black px-3 text-sm text-zinc-200 outline-none focus:border-white/35" onChange={(event) => setSuffixFilter(event.target.value)} value={suffixFilter}>
                    <option value="all">全部后缀</option>
                    {suffixes.map((suffix) => <option key={suffix} value={suffix}>.{suffix}</option>)}
                  </select>
                </div>
                {filteredOptions.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {filteredOptions.map((option) => {
                    const selected = selectedSuffix === option.hostname_suffix;
                    return <button aria-pressed={selected} className={`flex min-h-20 cursor-pointer items-center justify-between rounded-md border p-4 text-left transition-colors ${selected ? "border-emerald-400/50 bg-emerald-400/[0.06]" : "border-white/15 hover:border-white/30"}`} key={option.domain_type} onClick={() => { setSelectedSuffix(option.hostname_suffix); setPurchaseMode(option.free_claim_enabled && hasFreeDomainQuota ? "free" : "paid"); setCheck(null); }} type="button"><span><span className="block text-sm font-semibold text-zinc-100">{displayHostname(option.hostname_suffix)}</span><span className="mt-1 block text-xs text-zinc-500">{option.free_claim_enabled && hasFreeDomainQuota ? "可免费领取" : `¥${(option.monthly_price_cents / 100).toFixed(2)} 起`}</span></span>{selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" /> : null}</button>;
                  })}
                </div> : <div className="mt-3 rounded-md border border-dashed border-white/15 px-4 py-8 text-center text-sm text-zinc-500">没有符合条件的平台域名</div>}

                {canClaimSelectedForFree ? <div className="mt-6 grid grid-cols-2 rounded-md border border-white/15 p-1" role="group" aria-label="购买方式">
                  <button aria-pressed={purchaseMode === "free"} className={`h-9 rounded text-sm ${purchaseMode === "free" ? "bg-white text-black" : "text-zinc-400"}`} onClick={() => setPurchaseMode("free")} type="button">套餐免费</button>
                  <button aria-pressed={purchaseMode === "paid"} className={`h-9 rounded text-sm ${purchaseMode === "paid" ? "bg-white text-black" : "text-zinc-400"}`} onClick={() => setPurchaseMode("paid")} type="button">单独租赁</button>
                </div> : null}

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
                        if (event.key === "Enter") void handlePurchase();
                      }}
                      placeholder="例如 mypage"
                      spellCheck={false}
                      value={prefix}
                    />
                    <span className="flex shrink-0 items-center border-l border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-500">
                      .{displayHostname(selectedSuffix)}
                    </span>
                  </div>

                  <div className="mt-3 min-h-10">
                    <div className="min-h-5" aria-live="polite">
                      {checking ? (
                        <p className="flex items-center gap-2 text-sm text-zinc-500">
                          <LoaderCircle className="h-4 w-4 animate-spin" />正在检查
                        </p>
                      ) : check ? (
                        <p className={`flex items-center gap-2 text-sm ${check.available ? "text-emerald-400" : "text-red-400"}`}>
                          {check.available ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                          {check.available
                            ? `${check.normalized}.${displayHostname(selectedSuffix)} 可以使用`
                            : check.reason ?? "该地址不可用"}
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-600">输入完成后点击检查</p>
                      )}
                    </div>
                  </div>
                </div>

                {!isFreeClaim ? <div className="mt-6">
                  <p className="text-sm font-medium text-zinc-200">租赁时长</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {durationOptions.map((option) => (
                      <button aria-pressed={durationMonths === option.months} className={`min-h-16 rounded-md border px-3 py-2 text-left ${durationMonths === option.months ? "border-emerald-400/50 bg-emerald-400/[0.06]" : "border-white/15 hover:border-white/30"}`} key={option.months} onClick={() => setDurationMonths(option.months)} type="button">
                        <span className="block text-sm font-medium text-zinc-200">{option.label}</span>
                        <span className="mt-1 block text-xs text-zinc-500">¥{(selectedOption[option.priceKey] / 100).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div> : null}
              </div>

              <aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}>
                {isFreeClaim ? <Gift className="h-5 w-5 text-emerald-400" /> : <ShoppingBag className="h-5 w-5 text-zinc-400" />}
                <h2 className="mt-3 text-sm font-semibold">确认地址</h2>
                <p className="mt-2 break-all text-sm font-medium text-zinc-200">
                  {prefix.trim() ? `${prefix.trim()}.${displayHostname(selectedSuffix)}` : `你的前缀.${displayHostname(selectedSuffix)}`}
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-500">
                  {isFreeClaim ? "领取将消耗当前套餐的一个免费域名名额，无需进入支付页面。" : "域名将从账户余额即时扣款；余额不足时请先充值。"}
                </p>
                <div className="mt-4 flex items-baseline justify-between border-t border-white/10 pt-4">
                  <span className="text-xs text-zinc-500">{isFreeClaim ? "套餐权益" : `${selectedDuration.label} · ${durationMonths} 个月`}</span>
                  <strong className="text-lg text-white">{isFreeClaim ? "免费" : `¥${(selectedPrice / 100).toFixed(2)}`}</strong>
                </div>
                <button
                  className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white bg-white px-4 text-sm font-semibold text-black transition-[border-color,opacity] hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!localValidation?.ok || checking || purchasing || (!isFreeClaim && selectedPrice < 100)}
                  onClick={() => !isFreeClaim && (account?.walletBalanceCents ?? 0) < selectedPrice ? onNavigate(STUDIO_WALLET_PATH) : void handlePurchase()}
                  type="button"
                >
                  {checking || purchasing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {checking ? "正在检查" : purchasing ? (isFreeClaim ? "正在领取" : "正在扣款") : isFreeClaim ? "免费领取" : (account?.walletBalanceCents ?? 0) < selectedPrice ? "余额不足，去充值" : "余额支付"}
                </button>
                <button
                  className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/20 bg-black px-4 text-sm font-semibold text-zinc-200 transition-[border-color] hover:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  onClick={() => onNavigate(STUDIO_MY_DOMAINS_PATH)}
                  type="button"
                >
                  管理我的域名
                </button>
              </aside>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

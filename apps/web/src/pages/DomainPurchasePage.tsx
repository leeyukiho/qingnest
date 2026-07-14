import { ArrowLeft, Globe2, ShoppingBag } from "lucide-react";
import { StudioSidebar } from "@/app/StudioSidebar";
import { STUDIO_DOMAINS_PATH } from "@/app/navigation";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_HEADER_CLASS, STUDIO_MAIN_CLASS, STUDIO_PANEL_CLASS, STUDIO_SECONDARY_BUTTON_CLASS, STUDIO_SECTION_CLASS, STUDIO_TITLE_CLASS } from "@/app/ui";
import type { AccountProfile } from "@/lib/api";

export function DomainPurchasePage({ account, onNavigate }: { account: AccountProfile | null; onNavigate: (path: string) => void }) {
  return <div className="min-h-dvh bg-black"><section className={STUDIO_SECTION_CLASS}><div className={STUDIO_CONTENT_SHELL_CLASS}>
    <StudioSidebar account={account} active="domains" onNavigate={onNavigate} />
    <div className={STUDIO_MAIN_CLASS}>
      <button className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white" onClick={() => onNavigate(STUDIO_DOMAINS_PATH)} type="button"><ArrowLeft className="h-4 w-4" />返回域名管理</button>
      <div className={STUDIO_HEADER_CLASS}><div><h1 className={STUDIO_TITLE_CLASS}>购买平台地址</h1><p className="mt-2 text-sm text-zinc-500">购买一个由平台分发的独立三级域名，不会改变当前套餐的存储和部署额度。</p></div></div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={`${STUDIO_PANEL_CLASS} p-5 sm:p-6`}><div className="flex items-start gap-3"><Globe2 className="mt-0.5 h-5 w-5 text-zinc-400" /><div><h2 className="text-base font-semibold">额外平台地址</h2><p className="mt-1 text-sm leading-6 text-zinc-500">地址格式为 name.985201314.xyz。购买后会作为独立地址保留，可在项目之间换绑。</p></div></div><div className="mt-6 grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">{[["类型", "平台三级域名"], ["绑定", "一次绑定一个项目"], ["变更冷却", "10 分钟"]].map(([label, value]) => <div className="bg-black p-4" key={label}><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-sm font-medium text-zinc-100">{value}</p></div>)}</div><p className="mt-5 text-sm leading-6 text-zinc-500">支付和订单接口尚未接入。此页面已与套餐升级分离，后续购买流程将在这里完成，不会再跳转到套餐页。</p></div>
        <aside className={`${STUDIO_PANEL_CLASS} h-fit p-5`}><ShoppingBag className="h-5 w-5 text-zinc-400" /><h2 className="mt-3 text-sm font-semibold">当前状态</h2><p className="mt-2 text-sm leading-6 text-zinc-500">购买功能准备中。现有赠送地址仍可正常绑定和管理。</p><button className={`${STUDIO_SECONDARY_BUTTON_CLASS} mt-5 w-full`} onClick={() => onNavigate(STUDIO_DOMAINS_PATH)} type="button">管理已有地址</button></aside>
      </div>
    </div>
  </div></section></div>;
}

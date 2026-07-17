import { md5 } from "@noble/hashes/legacy";
import { bytesToHex } from "@noble/hashes/utils";
import { normalizeHostname } from "@qingnest/shared/config/domain";
import { createServiceSupabase, hasServiceSupabase, type Database } from "./supabase";
import type { Env } from "./types";
import { deleteDomainCache, type AuthenticatedUser } from "./state";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type CheckoutDuration = 1 | 3 | 6 | 12;
type FmSource = "notify" | "query" | "admin";

export type OrderView = {
  id: string;
  orderNo: string;
  type: OrderRow["type"] | "wallet_topup";
  status: OrderRow["status"];
  amountCents: number;
  actualAmountCents: number | null;
  productName: string;
  productSnapshot: OrderRow["product_snapshot"];
  expiresAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  failureMessage: string | null;
  payUrl: string | null;
  createdAt: string;
};

type FmConfig = {
  apiBaseUrl: string;
  merchantNum: string;
  secret: string;
  notifyUrl: string;
  returnUrl: string;
};

type VerifiedFmPayment = {
  orderNo: string;
  providerOrderId: string;
  channelOrderNo: string;
  amountCents: number;
  actualAmountCents: number;
  payType: string;
  payee: string;
  paidAt: string;
  rawPayload: Record<string, string>;
};

function fmConfig(env: Env): FmConfig {
  const values = {
    apiBaseUrl: env.FM_API_BASE_URL?.replace(/\/$/, "") ?? "",
    merchantNum: env.FM_MERCHANT_NUM ?? "",
    secret: env.FM_SECRET ?? "",
    notifyUrl: env.FM_NOTIFY_URL ?? "",
    returnUrl: env.FM_RETURN_URL ?? "",
  };
  if (!Object.values(values).every(Boolean)) throw new Error("FM 支付尚未完成服务端配置");
  for (const url of [values.apiBaseUrl, values.notifyUrl, values.returnUrl]) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && env.ENVIRONMENT === "production") throw new Error("生产环境 FM 地址必须使用 HTTPS");
  }
  return values;
}

function digest(value: string) {
  return bytesToHex(md5(new TextEncoder().encode(value)));
}

function timingSafeTextEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left.toLowerCase());
  const b = new TextEncoder().encode(right.toLowerCase());
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index]! ^ b[index]!;
  return mismatch === 0;
}

export function centsFromFmAmount(value: string) {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) throw new Error("FM 金额格式无效");
  const [yuan, fraction = ""] = value.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("FM 金额超出范围");
  return cents;
}

export function fmAmountFromCents(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("订单金额无效");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function fmDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("FM 支付时间格式无效");
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("FM 支付时间无效");
  return parsed.toISOString();
}

function orderNo() {
  return `KP${crypto.randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
}

function checkoutExpiry() {
  return new Date(Date.now() + 10 * 60_000).toISOString();
}

async function expirePendingOrders(env: Env) {
  const now = new Date().toISOString();
  const { error } = await createServiceSupabase(env).from("orders")
    .update({ status: "expired", updated_at: now })
    .eq("status", "pending").lt("expires_at", now);
  if (error) throw new Error(error.message);
}

async function createFmPayment(env: Env, order: OrderRow) {
  if (order.status === "pending" && order.pay_url && order.provider_order_id
      && Date.parse(order.expires_at) > Date.now()) {
    return { orderId: order.id, orderNo: order.order_no, payUrl: order.pay_url, expiresAt: order.expires_at };
  }
  const config = fmConfig(env);
  const amount = fmAmountFromCents(order.amount_cents);
  const params = new URLSearchParams({
    merchantNum: config.merchantNum,
    orderNo: order.order_no,
    amount,
    notifyUrl: config.notifyUrl,
    payType: "aloop",
    sign: digest(`${config.merchantNum}${order.order_no}${amount}${config.notifyUrl}${config.secret}`),
    returnUrl: config.returnUrl,
    returnType: "json",
    apiMode: "post_form",
    payDuration: "10",
    subject: `KuaiPage - ${order.product_name}`.slice(0, 100),
    body: `KuaiPage 订单 ${order.order_no}`,
    attch: order.id,
  });

  const response = await fetch(`${config.apiBaseUrl}/startOrder?${params}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`FM 创建订单失败（HTTP ${response.status}）`);
  const payload = await response.json() as { success?: boolean; code?: number; msg?: string; data?: { id?: string; payUrl?: string } | null };
  if (!payload.success || payload.code !== 200 || !payload.data?.id || !payload.data.payUrl) {
    throw new Error(payload.msg?.slice(0, 200) || "FM 创建订单失败");
  }
  const payUrl = new URL(payload.data.payUrl);
  if (!['http:', 'https:'].includes(payUrl.protocol)) throw new Error("FM 返回了无效支付地址");
  if (env.ENVIRONMENT === "production" && payUrl.protocol !== "https:") throw new Error("FM 返回的支付地址不是 HTTPS");
  const configuredPayHosts = (env.FM_PAY_URL_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowedHosts = new Set([new URL(config.apiBaseUrl).hostname, ...configuredPayHosts]);
  if (configuredPayHosts.length > 0 && !allowedHosts.has(payUrl.hostname)) {
    throw new Error(`FM 返回了未授权的支付域名：${payUrl.hostname}。请将该主机名加入 FM_PAY_URL_HOSTS`);
  }

  const supabase = createServiceSupabase(env);
  const { error } = await supabase.from("orders").update({
    provider_order_id: payload.data.id,
    pay_url: payUrl.toString(),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).eq("status", "pending");
  if (error) throw new Error(error.message);
  return { orderId: order.id, orderNo: order.order_no, payUrl: payUrl.toString(), expiresAt: order.expires_at };
}

async function runCheckout(env: Env, create: () => Promise<OrderRow>) {
  if (!hasServiceSupabase(env)) throw new Error("支付需要配置 Supabase");
  const order = await create();
  try {
    return await createFmPayment(env, order);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "创建支付失败";
    await createServiceSupabase(env).from("orders").update({
      status: "payment_failed",
      failure_code: "FM_CREATE_FAILED",
      failure_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", order.id).eq("status", "pending");
    throw new Error(message);
  }
}

async function createFmTopupPayment(env: Env, topup: Database["public"]["Tables"]["wallet_topups"]["Row"]) {
  const config = fmConfig(env);
  const amount = fmAmountFromCents(topup.amount_cents);
  const params = new URLSearchParams({
    merchantNum: config.merchantNum, orderNo: topup.order_no, amount,
    notifyUrl: config.notifyUrl, payType: "aloop",
    sign: digest(`${config.merchantNum}${topup.order_no}${amount}${config.notifyUrl}${config.secret}`),
    returnUrl: config.returnUrl, returnType: "json", apiMode: "post_form",
    payDuration: "10", subject: "KuaiPage - 余额充值", body: `KuaiPage 充值 ${topup.order_no}`, attch: topup.id,
  });
  const response = await fetch(`${config.apiBaseUrl}/startOrder?${params}`, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`FM 创建充值订单失败（HTTP ${response.status}）`);
  const payload = await response.json() as { success?: boolean; code?: number; msg?: string; data?: { id?: string; payUrl?: string } | null };
  if (!payload.success || payload.code !== 200 || !payload.data?.id || !payload.data.payUrl) throw new Error(payload.msg?.slice(0, 200) || "FM 创建充值订单失败");
  const payUrl = new URL(payload.data.payUrl);
  if (!['http:', 'https:'].includes(payUrl.protocol)) throw new Error("FM 返回了无效支付地址");
  if (env.ENVIRONMENT === "production" && payUrl.protocol !== "https:") throw new Error("FM 返回的支付地址不是 HTTPS");
  const configuredPayHosts = (env.FM_PAY_URL_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configuredPayHosts.length > 0 && !new Set([new URL(config.apiBaseUrl).hostname, ...configuredPayHosts]).has(payUrl.hostname)) throw new Error(`FM 返回了未授权的支付域名：${payUrl.hostname}`);
  const { error } = await createServiceSupabase(env).from("wallet_topups").update({ provider_order_id: payload.data.id,
    pay_url: payUrl.toString(), updated_at: new Date().toISOString() }).eq("id", topup.id).eq("status", "pending");
  if (error) throw new Error(error.message);
  return { orderId: topup.id, orderNo: topup.order_no, payUrl: payUrl.toString(), expiresAt: topup.expires_at };
}

export async function createWalletTopupCheckout(env: Env, user: AuthenticatedUser, amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 500) throw new Error("充值金额不能低于 5 元");
  const { data, error } = await createServiceSupabase(env).rpc("create_wallet_topup", {
    p_user_id: user.id, p_order_no: orderNo(), p_amount_cents: amountCents, p_expires_at: checkoutExpiry(),
  });
  if (error || !data) throw new Error(error?.message ?? "充值订单创建失败");
  try { return await createFmTopupPayment(env, data); }
  catch (cause) {
    const message = cause instanceof Error ? cause.message : "创建充值支付失败";
    await createServiceSupabase(env).from("wallet_topups").update({ status: "payment_failed", updated_at: new Date().toISOString() }).eq("id", data.id);
    throw new Error(message);
  }
}

export async function getWallet(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  await supabase.from("wallet_accounts").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  const [{ data: account, error }, { data: ledger, error: ledgerError }] = await Promise.all([
    supabase.from("wallet_accounts").select("balance_cents").eq("user_id", user.id).single(),
    supabase.from("wallet_ledger").select("id, amount_cents, balance_after_cents, kind, description, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (error || ledgerError) throw new Error(error?.message ?? ledgerError?.message ?? "余额读取失败");
  return { balanceCents: Number(account.balance_cents), ledger: ledger ?? [] };
}

export async function purchaseDomainWithWallet(env: Env, user: AuthenticatedUser, hostname: string, hostnameSuffix: string, durationMonths: CheckoutDuration) {
  const normalized = normalizeHostname(hostname); const suffix = normalizeHostname(hostnameSuffix);
  if (!normalized.ok) throw new Error(normalized.reason); if (!suffix.ok) throw new Error(suffix.reason);
  const { data, error } = await createServiceSupabase(env).rpc("purchase_domain_with_wallet", {
    p_user_id: user.id, p_hostname: normalized.ascii, p_hostname_suffix: suffix.ascii, p_duration_months: durationMonths,
  });
  if (error) throw new Error(error.message); return data;
}

export async function renewDomainWithWallet(env: Env, user: AuthenticatedUser, domainId: string, durationMonths: CheckoutDuration) {
  const { data, error } = await createServiceSupabase(env).rpc("renew_domain_with_wallet", { p_user_id: user.id, p_domain_id: domainId, p_duration_months: durationMonths });
  if (error) throw new Error(error.message); return data;
}

export async function purchasePlanWithWallet(env: Env, user: AuthenticatedUser, planKey: string, durationMonths: CheckoutDuration) {
  const { data, error } = await createServiceSupabase(env).rpc("purchase_plan_with_wallet", { p_user_id: user.id, p_plan_key: planKey, p_duration_months: durationMonths });
  if (error) throw new Error(error.message); return data;
}

function rpcRow<T>(data: T | T[] | null): T {
  if (!data) throw new Error("订单创建失败");
  return Array.isArray(data) ? data[0]! : data;
}

export async function createPlanCheckout(env: Env, user: AuthenticatedUser, planKey: string, durationMonths: CheckoutDuration) {
  return runCheckout(env, async () => {
    const { data, error } = await createServiceSupabase(env).rpc("create_plan_payment_order", {
      p_user_id: user.id, p_order_no: orderNo(), p_plan_key: planKey,
      p_duration_months: durationMonths, p_expires_at: checkoutExpiry(),
    });
    if (error) throw new Error(error.message);
    return rpcRow(data) as OrderRow;
  });
}

export async function createDomainCheckout(env: Env, user: AuthenticatedUser, hostname: string, hostnameSuffix: string, durationMonths: CheckoutDuration) {
  const normalizedResult = normalizeHostname(hostname);
  const normalizedSuffixResult = normalizeHostname(hostnameSuffix);
  if (!normalizedResult.ok) throw new Error(normalizedResult.reason);
  if (!normalizedSuffixResult.ok) throw new Error(normalizedSuffixResult.reason);
  const normalized = normalizedResult.ascii;
  const normalizedSuffix = normalizedSuffixResult.ascii;
  return runCheckout(env, async () => {
    const { data, error } = await createServiceSupabase(env).rpc("create_domain_payment_order", {
      p_user_id: user.id, p_order_no: orderNo(), p_hostname: normalized,
      p_hostname_suffix: normalizedSuffix, p_duration_months: durationMonths,
      p_expires_at: checkoutExpiry(),
    });
    if (error) throw new Error(error.message);
    return rpcRow(data) as OrderRow;
  });
}

export async function createDomainRenewalCheckout(env: Env, user: AuthenticatedUser, domainId: string, durationMonths: CheckoutDuration) {
  return runCheckout(env, async () => {
    const { data, error } = await createServiceSupabase(env).rpc("create_domain_renewal_order", {
      p_user_id: user.id, p_order_no: orderNo(), p_domain_id: domainId,
      p_duration_months: durationMonths, p_expires_at: checkoutExpiry(),
    });
    if (error) throw new Error(error.message);
    return rpcRow(data) as OrderRow;
  });
}

export async function getDomainRenewalEligibility(env: Env, user: AuthenticatedUser, domainId: string) {
  const supabase = createServiceSupabase(env);
  const { data: domain, error } = await supabase.from("domains").select("id, user_id, hostname, type, status, expires_at, entitlement_source").eq("id", domainId).eq("user_id", user.id).single();
  if (error) throw new Error(error.message);
  if (domain.type !== "platform_subdomain" || domain.status === "deleted") return { eligible: false, reason: "该域名不支持在线续费", allowedDurations: [] as number[] };
  if (domain.entitlement_source === "plan_grant") return { eligible: false, reason: "套餐赠送域名无需单独续费", allowedDurations: [] as number[] };
  const { data: prices, error: priceError } = await supabase.from("domain_pricing").select("hostname_suffix, renewal_window_days, max_advance_months").eq("enabled", true).eq("setup_status", "active");
  if (priceError) throw new Error(priceError.message);
  const price = (prices ?? []).filter((item) => domain.hostname.toLowerCase().endsWith(`.${item.hostname_suffix.toLowerCase()}`)).sort((a, b) => b.hostname_suffix.length - a.hostname_suffix.length)[0];
  if (!price) return { eligible: false, reason: "域名价格配置不存在", allowedDurations: [] as number[] };
  const now = Date.now();
  const expiresAt = Date.parse(domain.expires_at);
  if (expiresAt <= now) return { eligible: false, reason: "域名已经到期，请联系管理员处理", allowedDurations: [] as number[], renewalWindowDays: price.renewal_window_days };
  if (expiresAt > now + price.renewal_window_days * 86_400_000) return { eligible: false, reason: `到期前 ${price.renewal_window_days} 天开放续费`, allowedDurations: [] as number[], renewalWindowDays: price.renewal_window_days };
  const allowedDurations = ([1, 3, 6, 12] as const).filter((months) => {
    const next = new Date(domain.expires_at);
    next.setTime(next.getTime() + (months === 12 ? 365 : months * 30) * 86_400_000);
    const maximum = new Date();
    maximum.setTime(maximum.getTime() + (price.max_advance_months === 12 ? 365 : price.max_advance_months * 30) * 86_400_000);
    return next <= maximum;
  });
  return { eligible: allowedDurations.length > 0, reason: allowedDurations.length ? null : "已达到最长持有期限",
    allowedDurations, renewalWindowDays: price.renewal_window_days, maxAdvanceMonths: price.max_advance_months };
}

function safePayload(params: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const key of ["merchantNum", "orderNo", "type", "amount", "platformOrderNo", "actualPayAmount", "state", "payee", "payTime", "channelOrderNo", "attch"]) {
    const value = params.get(key);
    if (value !== null) result[key] = value.slice(0, 500);
  }
  return result;
}

export function verifyFmNotification(env: Env, params: URLSearchParams): VerifiedFmPayment {
  const config = fmConfig(env);
  const required = ["merchantNum", "orderNo", "type", "amount", "platformOrderNo", "actualPayAmount", "state", "payee", "payTime", "sign"];
  for (const key of required) if (!params.get(key)) throw new Error(`FM 回调缺少 ${key}`);
  const merchantNum = params.get("merchantNum")!;
  const state = params.get("state")!;
  const callbackOrderNo = params.get("orderNo")!;
  const amount = params.get("amount")!;
  if (merchantNum !== config.merchantNum || state !== "1") throw new Error("FM 商户号或状态无效");
  if (!/^[A-Za-z0-9]{8,32}$/.test(callbackOrderNo)) throw new Error("FM 订单号无效");
  const expected = digest(`${state}${merchantNum}${callbackOrderNo}${amount}${config.secret}`);
  if (!timingSafeTextEqual(expected, params.get("sign")!)) throw new Error("FM 回调签名无效");
  return {
    orderNo: callbackOrderNo,
    providerOrderId: params.get("platformOrderNo")!.slice(0, 100),
    channelOrderNo: (params.get("channelOrderNo") ?? "").slice(0, 100),
    amountCents: centsFromFmAmount(amount),
    actualAmountCents: centsFromFmAmount(params.get("actualPayAmount")!),
    payType: params.get("type")!.slice(0, 50),
    payee: params.get("payee")!.slice(0, 100),
    paidAt: fmDate(params.get("payTime")!),
    rawPayload: safePayload(params),
  };
}

async function confirmPayment(env: Env, payment: VerifiedFmPayment, source: FmSource) {
  const { data, error } = await createServiceSupabase(env).rpc("confirm_fm_payment", {
    p_order_no: payment.orderNo,
    p_provider_order_id: payment.providerOrderId,
    p_channel_order_no: payment.channelOrderNo,
    p_amount_cents: payment.amountCents,
    p_actual_amount_cents: payment.actualAmountCents,
    p_pay_type: payment.payType,
    p_payee: payment.payee,
    p_paid_at: payment.paidAt,
    p_source: source,
    p_raw_payload: payment.rawPayload,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function handleFmNotification(request: Request, env: Env) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 8_192) throw new Error("FM 回调请求过大");
  const params = request.method === "POST"
    ? new URLSearchParams((await request.text()).slice(0, 8_193))
    : new URL(request.url).searchParams;
  if (params.toString().length > 8_192) throw new Error("FM 回调请求过大");
  const payment = verifyFmNotification(env, params);
  const supabase = createServiceSupabase(env);
  const { data: topup } = await supabase.from("wallet_topups").select("id").eq("order_no", payment.orderNo).maybeSingle();
  if (topup) {
    const { data, error } = await supabase.rpc("confirm_wallet_topup", {
      p_order_no: payment.orderNo, p_provider_order_id: payment.providerOrderId,
      p_amount_cents: payment.amountCents, p_actual_amount_cents: payment.actualAmountCents, p_paid_at: payment.paidAt,
    });
    if (error) throw new Error(error.message);
    return data;
  }
  return confirmPayment(env, payment, "notify");
}

function orderView(row: OrderRow, actualAmountCents: number | null): OrderView {
  return { id: row.id, orderNo: row.order_no, type: row.type, status: row.status,
    amountCents: row.amount_cents, actualAmountCents, productName: row.product_name,
    productSnapshot: row.product_snapshot, expiresAt: row.expires_at, paidAt: row.paid_at,
    fulfilledAt: row.fulfilled_at, failureMessage: row.failure_message,
    payUrl: row.status === "pending" && Date.parse(row.expires_at) > Date.now() ? row.pay_url : null,
    createdAt: row.created_at };
}

export async function listUserOrders(env: Env, user: AuthenticatedUser) {
  await expirePendingOrders(env);
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((item) => item.id);
  const payments = ids.length ? await supabase.from("payments").select("order_id, actual_amount_cents").in("order_id", ids).eq("status", "success") : { data: [], error: null };
  if (payments.error) throw new Error(payments.error.message);
  const amounts = new Map((payments.data ?? []).map((item) => [item.order_id, item.actual_amount_cents]));
  return (data ?? []).map((item) => orderView(item, amounts.get(item.id) ?? null));
}

export async function getUserOrder(env: Env, user: AuthenticatedUser, id: string) {
  await expirePendingOrders(env);
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).eq("user_id", user.id).single();
  if (error) throw new Error(error.message);
  const { data: payment } = await supabase.from("payments").select("actual_amount_cents").eq("order_id", id).eq("status", "success").maybeSingle();
  return orderView(data, payment?.actual_amount_cents ?? null);
}

export async function getUserOrderByNumber(env: Env, user: AuthenticatedUser, orderNo: string) {
  await expirePendingOrders(env);
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("orders").select("*").eq("order_no", orderNo).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: topup, error: topupError } = await supabase.from("wallet_topups").select("*").eq("order_no", orderNo).eq("user_id", user.id).single();
    if (topupError) throw new Error(topupError.message);
    return { id: topup.id, orderNo: topup.order_no, type: "wallet_topup" as const, status: topup.status === "paid" ? "fulfilled" as const : topup.status,
      amountCents: topup.amount_cents, actualAmountCents: topup.actual_amount_cents,
      productName: "余额充值", productSnapshot: {}, expiresAt: topup.expires_at,
      paidAt: topup.paid_at, fulfilledAt: topup.paid_at, failureMessage: null,
      payUrl: topup.status === "pending" ? topup.pay_url : null, createdAt: topup.created_at };
  }
  const { data: payment } = await supabase.from("payments").select("actual_amount_cents").eq("order_id", data.id).eq("status", "success").maybeSingle();
  return orderView(data, payment?.actual_amount_cents ?? null);
}

export async function cancelUserOrder(env: Env, user: AuthenticatedUser, orderId: string) {
  await expirePendingOrders(env);
  const { data, error } = await createServiceSupabase(env).rpc("cancel_payment_order", {
    p_user_id: user.id,
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message);
  return orderView(rpcRow(data) as OrderRow, null);
}

async function queryFmOrder(env: Env, order: OrderRow) {
  if (env.FM_QUERY_ENABLED !== "true") throw new Error("FM 主动查询尚未开通；需要 VIP 并联系 FM 开通接口权限");
  const config = fmConfig(env);
  const params = new URLSearchParams({ merchantNum: config.merchantNum, orderNo: order.order_no,
    sign: digest(`${config.merchantNum}${order.order_no}${config.secret}`) });
  const response = await fetch(`${config.apiBaseUrl}/queryOutOrder?${params}`, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`FM 查询失败（HTTP ${response.status}）`);
  const payload = await response.json() as { success?: boolean; code?: number; msg?: string; data?: Record<string, string> };
  if (!payload.success || payload.code !== 200 || !payload.data) throw new Error(payload.msg || "FM 查询失败");
  return payload.data;
}

export async function reconcileOrder(env: Env, orderId: string) {
  const supabase = createServiceSupabase(env);
  const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (error) throw new Error(error.message);
  const remote = await queryFmOrder(env, order);
  if (remote.orderState !== "4") return { remoteState: remote.orderState, remoteStateDescription: remote.orderStateDesc ?? "未支付" };
  const payment: VerifiedFmPayment = {
    orderNo: order.order_no, providerOrderId: remote.orderId, channelOrderNo: "",
    amountCents: centsFromFmAmount(remote.amount), actualAmountCents: centsFromFmAmount(remote.tradeMoney || remote.amount),
    payType: remote.payType || "aloop", payee: "", paidAt: fmDate(remote.payTime), rawPayload: { ...remote },
  };
  return confirmPayment(env, payment, "query");
}

export async function listAdminOrders(env: Env) {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  const userIds = [...new Set((data ?? []).map((order) => order.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [], error: null };
  if (profileError) throw new Error(profileError.message);
  const emails = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));
  return (data ?? []).map((order) => ({ ...order, user_email: emails.get(order.user_id) ?? null }));
}

export async function retryOrderFulfillment(env: Env, orderId: string) {
  const supabase = createServiceSupabase(env);
  const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (error) throw new Error(error.message);
  const { data: payment, error: paymentError } = await supabase.from("payments").select("*").eq("order_id", order.id).eq("status", "success").single();
  if (paymentError) throw new Error(paymentError.message);
  return confirmPayment(env, { orderNo: order.order_no, providerOrderId: payment.provider_order_id,
    channelOrderNo: payment.channel_order_no ?? "", amountCents: payment.amount_cents,
    actualAmountCents: payment.actual_amount_cents, payType: payment.pay_type, payee: payment.payee ?? "",
    paidAt: payment.paid_at, rawPayload: { adminRetry: "true" } }, "admin");
}

export async function replaceFailedDomain(env: Env, orderId: string, hostname: string) {
  const normalizedResult = normalizeHostname(hostname);
  if (!normalizedResult.ok) throw new Error(normalizedResult.reason);
  const normalized = normalizedResult.ascii;
  const supabase = createServiceSupabase(env);
  const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).eq("type", "domain_rental").eq("status", "fulfillment_failed").single();
  if (error) throw new Error(error.message);
  const snapshot = order.product_snapshot as Record<string, unknown>;
  const suffix = String(snapshot.hostnameSuffix ?? "");
  if (!suffix || !normalized.endsWith(`.${suffix}`)) throw new Error("替换域名与原订单后缀不一致");
  const { data: existing } = await supabase.from("domains").select("id").eq("hostname", normalized).neq("status", "deleted").maybeSingle();
  if (existing) throw new Error("替换域名已被占用");
  const { error: updateError } = await supabase.from("orders").update({ product_name: normalized,
    product_snapshot: { ...snapshot, hostname: normalized }, updated_at: new Date().toISOString() }).eq("id", order.id);
  if (updateError) throw new Error(updateError.message);
  return retryOrderFulfillment(env, order.id);
}

export async function recordAdminRefund(env: Env, operator: AuthenticatedUser, orderId: string, input: { reason: string; channelReference: string }) {
  if (!input.reason.trim() || !input.channelReference.trim()) throw new Error("退款原因和支付宝退款凭证必填");
  const { data, error } = await createServiceSupabase(env).rpc("record_order_refund", {
    p_order_id: orderId, p_operator_id: operator.id, p_reason: input.reason,
    p_channel_reference: input.channelReference,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function runPaymentLifecycle(env: Env) {
  if (!hasServiceSupabase(env)) return;
  const supabase = createServiceSupabase(env);
  const now = new Date().toISOString();
  const { data, error } = await (supabase as any).rpc("run_payment_maintenance", { p_now: now });
  if (error) throw new Error(error.message);
  await Promise.all((data?.reclaimed_hostnames ?? []).map((hostname: string) => deleteDomainCache(env, hostname)));
  for (const orderId of data?.failed_order_ids ?? []) {
    try { await retryOrderFulfillment(env, orderId); } catch { /* The job keeps its failure state for admin review. */ }
  }
}

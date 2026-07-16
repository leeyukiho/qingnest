# KuaiPage 支付方案与 FM API 对接文档

> 本文面向 KuaiPage 当前业务：套餐购买/续费、平台域名租赁及续期。FM 只负责收款和支付结果通知；订单、权益、到期时间、退款与对账由 KuaiPage 负责。

## 1. 结论

### 1.1 推荐方案

第一阶段采用**商品直购**，暂不提供“充值到项目余额”：

- 套餐：用户选择套餐和周期，创建业务订单，支付成功后升级或顺延 `profiles.plan_expires_at`。
- 平台域名：用户选择后缀、前缀和 1/3/6/12 个月，创建业务订单，支付成功后占用域名并写入/顺延 `domains.expires_at`。
- 免费商品不经过 FM，后端直接完成业务动作。
- FM 回调只确认收款；具体权益通过本项目的交付任务异步执行。

不建议第一阶段使用余额充值，原因如下：

1. 当前收入项是低频、明确价格的套餐与域名租赁，并非高频按量消费，余额不会明显缩短购买路径。
2. 余额需要额外实现资金账户、不可变流水、冻结/扣减、并发锁、退款回退、过期处理、人工调账、风控和财务对账，复杂度远高于直购。
3. 用户充值后未消费会形成平台负债；还会引入余额退款、注销清退、优惠赠送余额与现金余额分离等问题。
4. 直购订单天然保存“买了什么、价格快照、应交付什么”，更适合套餐和域名到期模型。
5. FM 的职责只是收款通知，它不会替 KuaiPage 提供可靠的钱包账本。

只有出现以下需求时，再评估余额体系：大量小额按次消费、AI 生成/构建按量计费、频繁购买增量配额、企业预存款或单笔金额低于 FM 最低 1 元。届时应新增独立钱包账本，而不是把 `profiles` 上的一个数值字段当余额。

### 1.2 能否支撑本项目

FM 可以支撑当前项目的**单次支付宝收款入口**，但不能单独构成完整支付系统。上线至少还需由 KuaiPage 实现：

- 本地订单与商品价格快照；
- 支付记录与回调原文；
- 签名校验、金额校验、幂等与原子事务；
- 套餐/域名权益交付及失败重试；
- 订单查询页、超时关闭、人工补单与日常对账；
- 退款业务流程。FM 当前资料未在本文确认可编程退款 API，因此第一版按“人工原路退款 + 本地退款记录 + 权益处理”设计，不能把退款能力视为已具备。

此外，免签免挂依赖到账监控、金额匹配和个人支付宝账号稳定性。它适合作为 MVP 或低并发渠道，但生产商业化前应确认服务条款、账户风控、并发容量和长期可用性，并预留更换支付提供商的适配层。

## 2. 当前项目计费模型

项目现有模型决定了支付应围绕“订单与权益”建设：

| 业务 | 当前数据 | 购买结果 | 推荐订单类型 |
| --- | --- | --- | --- |
| 套餐 | `plan_catalog`、`profiles.plan`、`profiles.plan_expires_at` | 开通/续费套餐配额 | `plan_subscription` |
| 平台域名 | `domain_pricing`、`domains.expires_at` | 租赁/续期 1/3/6/12 个月 | `domain_rental` |
| 免费套餐/免费商品 | 价格为 0 | 直接交付 | 可留业务审计记录，不创建 FM 订单 |

套餐控制项目数、公开站点数、存储、发布次数、域名数等多项配额。域名价格已按月、季、半年和年保存。创建订单时必须复制商品名称、价格、周期和权益参数作为快照，支付回调时不得重新读取当前目录价格，否则管理员改价会导致老订单金额或交付内容漂移。

## 3. 推荐架构

```text
Web 选择商品
  -> Worker 创建 KuaiPage 订单（pending）
  -> Worker 服务端签名并调用 FM /startOrder
  -> Web 跳转 FM payUrl
  -> 支付宝付款
  -> FM 调用公开 notifyUrl
  -> Worker 验签并在数据库事务中记支付成功 + 创建交付任务
  -> 后台任务交付套餐或域名权益
  -> Web 轮询本地订单状态并展示结果
```

前端跳转参数和 `returnUrl` 只用于展示，绝不能据此标记支付成功。支付成功的唯一自动依据是通过验签、商户号、订单号、状态和金额校验的服务端回调；人工补单必须留下管理员审计记录。

建议通过 `PaymentProvider` 适配层封装 FM：

```ts
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<{ providerOrderId: string; payUrl: string }>;
  verifyNotification(input: URLSearchParams): VerifiedPaymentNotification;
}
```

业务订单和权益交付不应依赖 `aloop`、FM 字段名或 MD5 细节，便于以后替换渠道。

## 4. 数据模型

### 4.1 `orders`

建议字段：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `order_no` | 对外订单号，唯一，仅字母数字且不超过 32 字符 |
| `user_id` | 下单用户 |
| `type` | `plan_subscription` / `domain_rental` |
| `status` | 见下方状态机 |
| `currency` | 第一版固定 `CNY` |
| `amount_cents` | 应付金额，整数分，唯一金额事实来源 |
| `product_key` | 套餐 key 或域名价格项标识 |
| `product_name` | 下单时名称快照 |
| `product_snapshot` | JSON；周期、套餐、域名、前缀、后缀、权益等不可变参数 |
| `provider` | 第一版 `fm` |
| `provider_order_id` | FM `data.id`，成功创建后写入 |
| `expires_at` | 本地支付截止时间，与 FM `payDuration` 一致 |
| `paid_at` / `fulfilled_at` | 收款和交付时间 |
| `failure_code` / `failure_message` | 创建支付或交付失败原因 |
| `created_at` / `updated_at` | 审计时间 |

关键约束：`order_no` 唯一；`amount_cents >= 0`；付费订单必须至少 100 分；订单归属用户只允许读取自己的记录；客户端不得提交最终价格。

### 4.2 `payments`

建议字段：`id`、`order_id`、`provider`、`provider_order_id`、`channel_order_no`、`status`、`amount_cents`、`actual_amount_cents`、`pay_type`、`payee`、`paid_at`、`signature_valid`、`raw_payload`、`received_at`。

关键约束：

- `unique(provider, provider_order_id)`，阻止同一 FM 支付重复入账；
- 一个业务订单第一阶段只允许一笔成功支付，可用成功状态的唯一索引约束；
- 原始回调要脱敏后保存，严禁保存 FM 密钥；
- 金额始终解析为整数分，禁止用浮点数比较。

### 4.3 `fulfillment_jobs`

建议字段：`id`、`order_id`（唯一）、`type`、`status`、`attempts`、`next_attempt_at`、`last_error`、`created_at`、`completed_at`。

交付任务必须幂等：

- 套餐续费使用确定的订单 ID 作为幂等键；同一订单只能延长一次。
- 域名租赁必须在下单阶段短暂预留，或在支付前再次检查并锁定；不能先收款后才发现域名已被其他用户占用。
- 如果域名最终无法交付，订单进入 `fulfillment_failed`，由人工换域名或退款，不能静默失败。

### 4.4 订单状态机

```text
pending -> paid -> fulfilling -> fulfilled
   |                 |
   +-> expired       +-> fulfillment_failed
   +-> payment_failed

fulfilled -> refund_pending -> refunded
```

支付成功后不要把订单重新置为 `pending`。重复回调命中已支付订单时，应核对其是否为同一笔支付；一致则确保交付任务存在并返回 `success`，不一致则告警并返回 `fail`。

## 5. FM 接口约定

以下字段基于文末 FM 资料。生产接入前必须在 FM 测试环境或真实小额订单中再次核对，尤其是签名金额字符串、通知方法、重试规则和退款能力。

### 5.1 服务端配置

```env
FM_API_BASE_URL=
FM_MERCHANT_NUM=
FM_SECRET=
FM_PAY_TYPE=aloop
FM_NOTIFY_URL=https://<api-domain>/api/payments/fm/notify
FM_RETURN_URL=https://<web-domain>/studio/billing/payment-result
FM_PAY_URL_HOSTS=<FM 支付页域名，多个用逗号分隔>
FM_QUERY_ENABLED=false
```

`FM_QUERY_ENABLED` 只有在 FM 账号为 VIP 且客服已开通 `/queryOutOrder` 权限后才能设为 `true`。未开通时管理员仍可在 FM 商户后台人工确认/补单，再等待回调；后台“对账”按钮会明确提示未开通查询权限。

已有支付宝免挂 APPID 可以复用，但必须同时满足：它属于实际收款的同一个支付宝主账号、已开通资金流水查询、应用状态为“审核完成/已上线”，且 FM 与支付宝开放平台中的 RSA 密钥对保持一致。不要为了 KuaiPage 重新生成密钥并覆盖另一个项目正在使用的配置。若另一个项目需要独立轮换密钥、独立停用或属于不同收款账号，应新建应用；否则复用已审核 APPID 更稳妥。

所有配置仅放 Worker Secret/服务端环境变量。密钥不得进入 Vite 客户端变量、日志、数据库回调原文或错误响应。建议同时配置请求超时，并对 FM 主机名做固定允许列表，避免可配置 URL 导致 SSRF。

### 5.2 创建订单

- 请求：`POST [FM_API_BASE_URL]/startOrder`
- 参数：Query 或 `application/x-www-form-urlencoded`，不要发送 JSON body
- 默认支付方式：`aloop`
- 签名：`md5(merchantNum + orderNo + amount + notifyUrl + secret)`
- `returnType`：固定 `json`
- `apiMode`：建议固定 `post_form`；若实际联调不稳定则使用默认 GET，并让回调路由兼容 GET/POST 表单
- `payDuration`：建议 10 分钟，最大 15 分钟；本地 `expires_at` 必须一致

必要参数：

| 参数 | 处理规则 |
| --- | --- |
| `merchantNum` | 来自服务端 Secret |
| `orderNo` | 使用本地 `orders.order_no` |
| `amount` | 从 `amount_cents` 格式化为两位小数；签名与请求必须使用同一字符串 |
| `notifyUrl` | 公网 HTTPS、无登录、无重定向、无查询参数 |
| `payType` | 默认 `aloop` |
| `sign` | 服务端生成的 32 位小写 MD5 |
| `returnUrl` | 仅展示支付结果 |
| `subject` | `KuaiPage - {product_name}`，不超过 100 字符 |
| `body` | 订单摘要，不放用户隐私，不超过 200 字符 |
| `attch` | 可放不可猜的订单追踪标识；不能依赖它鉴权 |

仅当 HTTP 请求成功、响应 `success=true`、`code=200` 且同时存在 `data.id`、合法的 `data.payUrl` 时，才向前端返回支付链接。`payUrl` 必须校验为 `http/https` 且主机符合 FM 预期。FM 创建失败时保留本地订单和失败信息，允许按业务规则重试，但重试前要避免为同一订单创建多个有效支付单。

### 5.3 异步回调

- 路由：`GET/POST /api/payments/fm/notify`
- 不要求登录，不走普通用户鉴权；需要独立限流和安全日志
- 回调签名：`md5(state + merchantNum + orderNo + amount + secret)`
- 成功响应：HTTP 200、纯文本 `success`
- 拒绝响应：纯文本 `fail`，同时记录结构化安全事件

处理顺序：

1. 限制请求体大小，仅接受预期参数和表单编码。
2. 读取原始字段，校验必填项和长度；不要先信任 `attch`。
3. 常量时间比较签名，并校验 `merchantNum`。
4. 校验 `state == 1`。
5. 查询 `orderNo`，校验订单存在、`provider=fm` 且商品快照完整。
6. 将回调 `amount` 严格解析为整数分，必须等于 `orders.amount_cents`。
7. 校验 `platformOrderNo` 与本地已保存的 FM 订单标识一致；若 FM 创建接口与回调标识语义不同，联调确认后分别保存。
8. 在单个数据库事务/RPC 内锁定订单，插入支付记录，将订单从 `pending` 原子更新为 `paid`，并插入唯一交付任务。
9. 事务提交后立即返回 `success`；域名分配、套餐更新及外部调用不在回调请求内执行。
10. 重复回调若所有关键字段一致，补齐缺失交付任务并返回 `success`；字段冲突则告警并返回 `fail`。

数据库原子操作建议实现为受限的 Supabase PostgreSQL RPC，仅授予 Worker 使用的服务端角色，不暴露给 `anon`/`authenticated`。仅靠 Worker 中连续执行多条数据库写入无法保证原子性。

### 5.4 金额浮动与并发

免签渠道可能通过小额浮动区分同收款号的同金额订单：

- `amount` 是本地应付金额，也是签名与业务校验金额；
- `actualPayAmount` 是用户实际支付金额，只用于入账、对账和客服排查；
- 两者都保存为整数分，不因 `actualPayAmount` 浮动改变商品权益；
- 前端提示用户严格按照 FM 页面显示金额付款；
- 同金额并发容量取决于 FM 收款号、码类型和浮动范围，不能视为无限；
- 订单超时后付款、用户擅自改金额或监控异常时进入人工对账，不凭截图直接交付。

## 6. 具体权益规则

### 6.1 套餐购买与续费

- 第一版建议只支持同级续费和升级，不做自动续费。免签渠道不具备可靠代扣语义。
- 到期时间规则：同套餐续费从 `max(now(), plan_expires_at)` 顺延；首次购买从支付成功时间起算。
- 升级规则必须在上线前二选一并固化：立即生效、按新周期全价购买；或按剩余价值补差价。第一版推荐前者，规则简单且可审计。
- 降级不在支付链路即时执行，可在当前套餐到期后生效。
- 后台任务更新 `profiles.plan` 和 `plan_expires_at` 后，账号接口与所有配额校验应立即读取到新权益。
- 必须增加到期降级任务：到期后恢复 `free`，并明确超额项目只读/禁止新建策略，不能删除用户数据。

当前 `plan_catalog` 只有月价格和续费价格。如要展示季付/年付，先扩展套餐周期定价；不能由前端临时乘月价作为最终结算价格。

### 6.2 平台域名租赁

- 下单参数为规范化前缀、`hostname_suffix` 与周期；价格由服务端读取 `domain_pricing`。
- 付款前要解决并发占用：推荐创建有过期时间的域名预留记录，并用数据库唯一约束保证同一 hostname 只有一个有效占用者。
- 支付成功后将预留转为正式租赁并写入 `domains.expires_at`。
- 续期从 `max(now(), expires_at)` 顺延，但项目当前约束要求租期不超过创建时间后一年；续费上线前必须调整该约束或采用租期记录表，否则一年期域名无法再次续期。
- 支付超时释放预留；已付款但交付失败必须进入人工处理队列。

### 6.3 退款

第一版不提供用户自助即时退款。管理员审核后：

1. 将订单置为 `refund_pending` 并记录原因、金额和操作者。
2. 在 FM/支付宝侧人工退款，保存渠道凭证。
3. 确认资金退回后写 `refunds` 记录并置为 `refunded`。
4. 按公布规则回收或缩短权益；域名已发生资源成本时需明确是否可退。
5. 所有操作写入 `audit_events`。

不得先回收权益却未退款，也不得只退款而不更新本地订单。部分退款若非上线必需，第一版明确不支持。

## 7. API 建议

| API | 鉴权 | 作用 |
| --- | --- | --- |
| `POST /api/orders/plan` | 用户 | 服务端校验套餐/周期并创建订单 |
| `POST /api/orders/domain` | 用户 | 校验并预留域名、创建订单 |
| `POST /api/orders/:id/payment` | 用户且订单归属校验 | 调 FM 创建支付并返回 `payUrl` |
| `GET /api/orders/:id` | 用户且订单归属校验 | 前端轮询本地状态 |
| `GET /api/orders` | 用户 | 账单页订单列表 |
| `GET/POST /api/payments/fm/notify` | FM 验签 | 收款通知 |
| `POST /api/admin/orders/:id/reconcile` | 管理员 | 人工补单/纠错，强制审计 |
| `POST /api/admin/orders/:id/refund` | 管理员 | 记录退款流程 |

订单创建接口应接受商品标识和周期，不接受可信价格。前端提交的金额只能用于显示或乐观校验，服务端必须重新定价。所有写接口使用已有认证、限流和审计机制；支付回调使用独立策略。

## 8. 上线清单

### 8.1 必须完成

- 新增订单、支付、交付任务及退款记录表和约束。
- 使用 PostgreSQL RPC 实现“确认支付 + 创建交付任务”的原子幂等事务。
- 实现 FM 服务端适配器、超时、响应校验和脱敏日志。
- 完成套餐开通/续费、域名预留/交付、失败重试和到期处理。
- 定价页接创建订单，域名页不再在未付款时直接调用 `rentPublicSlot`。
- 账单页展示真实订单、支付、交付与退款状态。
- 增加定时任务：关闭超时订单、释放域名预留、重试交付、处理套餐到期、生成对账异常。
- 增加管理员订单查询、补单、退款和审计界面。

### 8.2 测试矩阵

- 正常套餐购买、同套餐续费、升级、免费商品。
- 正常域名购买、同名并发抢购、支付超时释放、续期。
- 回调重复、乱序、签名错误、商户号错误、金额错误、订单号不存在。
- FM 创建超时但实际创建成功、FM 返回缺字段或非法支付 URL。
- 数据库事务中途失败、交付失败后重试、重复任务执行。
- 用户支付后不跳回、伪造 `returnUrl` 参数、越权读取他人订单。
- 订单超时后到账、实际付款金额浮动、人工补单和人工退款。

### 8.3 生产验证

用真实小额订单完成端到端验证：FM 创建成功、支付宝实际到账、FM 状态已支付、KuaiPage 收到回调、返回纯文本 `success`、本地订单只记账一次、权益只交付一次。随后核对 FM 账单、支付宝流水、`payments` 与 `orders` 四方金额和订单号。

## 9. FM 免签配置与排查

### 9.1 前置配置

- FM 商户后台在“免签类型 -> 收款码”配置支付宝收款账号、PID/user_id、设备编号和免挂监测。
- `PID` 填支付宝 `user_id`/`pid`，不是开放平台 `APPID`。
- 设备编号应与监控端一致。支付宝开放平台 RSA 配置和 FM 后台必须一致。
- 生产前确认是否允许配置 IP 白名单；不要照搬过期地址段。IP 白名单只能作为附加限制，不能替代验签。
- 第一版使用 `aloop`；收款号和轮询策略在 FM 后台维护，业务数据库不保存支付宝账号或私钥。

支付宝 user_id 查询地址：

```text
https://b.alipay.com/page/store-management/infomanage
```

### 9.2 常见问题

| 问题 | 检查项 |
| --- | --- |
| 创建订单签名错误 | 金额字符串、通知 URL、商户号、密钥、拼接顺序、MD5 小写 |
| 金额格式错误/低于最低金额 | 必须使用两位小数字符串，免签订单至少 1 元 |
| 无可用收款方式 | `aloop` 收款号、码配置、浮动范围、同金额待支付并发 |
| FM 已支付但本地未交付 | 回调公网可达、无重定向、快速响应；查看验签、金额、事务和交付任务 |
| 用户付款但 FM 未匹配 | 免挂监测、PID、设备号、支付金额、订单有效期 |
| 客户端拉起失败 | 提供浏览器打开或扫码方案，不依赖内嵌 WebView |

## 10. 资料来源

- <https://docs.zhifux.com/read/zhifufm/index>
- <https://docs.zhifux.com/read/zhifufm/personstep>
- <https://docs.zhifux.com/read/zhifufm/startorder>
- <https://docs.zhifux.com/read/zhifufm/notify>
- <https://docs.zhifux.com/read/zhifufm/qrappid>
- <https://docs.zhifux.com/read/zhifufm/qrconfig>
- <https://docs.zhifux.com/read/zhifufm/personali>
- <https://docs.zhifux.com/read/zhifufm/paytype>
- <https://docs.zhifux.com/read/zhifufm/apiqa>

> 资料链接属于第三方支付服务。接口字段、IP、限制和合规状态可能变化，上线前应以 FM 后台当前文档、实际联调结果及适用法律/平台规则为准。

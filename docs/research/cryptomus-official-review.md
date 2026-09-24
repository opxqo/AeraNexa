# Cryptomus 官方资料核验（只读）

核验日期：2026-09-22（Asia/Shanghai）  
范围：仅访问 Cryptomus 官方 API 文档、官方 FAQ 与官方法律页面链接；未注册账户、未提交身份资料、未创建订单、未发起支付，也未写入任何密钥。

## 核验结论

**技术上可以**把 Cryptomus 作为 AeraNexa 的第三方、托管式加密货币收款网关：官方文档明确提供商户 API 创建 invoice、指定支付币种/网络、托管支付页、状态查询、签名 Webhook、退款和商户钱包出款 API。它不是自托管钱包或自行部署的链上监听器。

**USDC 可以作为候选支付资产，但不能在未开户前承诺某条链一定可用。** 官方支持币种/网络参考页列出 USDC 的 `arbitrum`、`avalanche`、`bsc`、`eth`、`polygon`、`tron` 网络；同一商户 API 的“List of services”规定实际可用服务由 API 返回，含 `is_available`、最小/最大金额和费率。AeraNexa 应在商户账户/生产环境调用该服务清单后，只启用一个返回可用的 `USDC + network` 组合；不可只显示“USDC”。

个人身份**并非免验证路线**：官方 FAQ 当前写明 KYC 对所有用户强制，且其商户接入流程要求为网站/Telegram 项目申请 API key、等待审核并完成域名/项目所有权验证。对“个人能否以 AeraNexa 所在司法辖区、当前业务类型获批商户收款”的问题，现有公开材料不足以作肯定结论；必须在注册、KYC、项目审核和书面确认后才知道。

## 直接适配的支付链路

```text
AeraNexa 服务器创建本地订单
  → 服务器使用 Merchant ID + Payment API Key 签名 POST /v1/payment
  → 固定 to_currency=USDC、network=<生产服务清单核验后的单链>
  ← invoice UUID、支付页 URL、链上地址、报价/状态
  → 浏览器仅跳转 Cryptomus 托管支付页
Cryptomus → AeraNexa url_callback（带签名、状态、网络、txid）
  → 验签 + IP 限制 + 以 UUID/order_id 主动查单
  → 仅 paid（或经业务规则允许的 paid_over）且金额/资产/网络一致
  → 现有幂等 settleOrder() 履约
```

不要让浏览器持有 Payment API Key；请求由服务端创建，Webhook 不能只依赖前端“成功”信号。官方请求格式采用 `merchant` 头和 `sign` 头，签名规则为 `MD5(base64(POST body) + API key)`；Webhook 也携带 `sign`，官方要求逐个验证，并建议只允许其公布的回调来源 IP `91.227.144.54`。这仍是托管商的共享密钥方案，AeraNexa 应把密钥加密保存、使用常量时间比较、保留原始事件、并在 Webhook 后主动查询 invoice。

## 官方证据与可核验 URL

| 事项 | 官方结论 | 官方来源（2026-09-22 访问） |
| --- | --- | --- |
| 创建支付/API | `POST https://api.cryptomus.com/v1/payment` 创建 invoice；返回 UUID、订单号、支付页 URL、地址、网络、交易哈希、支付状态等。若传加密货币 `currency`/`to_currency` 和 `network`，创建时即获得特定资产和地址。 | [Creating an invoice](https://doc.cryptomus.com/merchant-api/payments/creating-invoice) |
| USDC 与网络 | 官方参考页列出 `USDC` 的 `arbitrum`、`avalanche`、`bsc`、`eth`、`polygon`、`tron` 网络；服务清单接口返回每项 `currency`、`network`、`is_available`、限额与手续费。参考清单不是对每个商户或地区的保证。 | [Supported currencies and networks](https://doc.cryptomus.com/reference)；[List of services](https://doc.cryptomus.com/merchant-api/payments/list-of-services) |
| 网络选择 | invoice 接受 `network`；若只设法币，付款人在托管页选择资产/网络。为避免错链，应在服务端同时固定 `to_currency=USDC` 和 `network`。 | [Creating an invoice](https://doc.cryptomus.com/merchant-api/payments/creating-invoice) |
| Webhook 与验签 | 状态变化 POST 到 `url_callback`；载荷含 `network`、`currency`、`payer_currency`、`txid`、`sign`。官方给出签名计算、`hash_equals` 校验与 IP allowlist 建议。 | [Payment webhook](https://doc.cryptomus.com/merchant-api/payments/webhook)；[Request format](https://doc.cryptomus.com/merchant-api/request-format) |
| 最终支付状态 | `confirm_check` 意为已见链上交易、仍等待所需确认数；`paid` 是按要求金额成功付款；`paid_over` 为多付；还定义 AML 锁定、退款处理/成功/失败状态。 | [Payment statuses](https://doc.cryptomus.com/merchant-api/payments/payment-statuses) |
| 主动查单 | 支持以 Cryptomus UUID 或本站 `order_id` 查 invoice 状态。 | [Payment information](https://doc.cryptomus.com/merchant-api/payments/payment-information) |
| 退款 | `POST /v1/payment/refund`；需提供退款地址与手续费承担方式，且官方规定仅可退已完成付款，退款额不得超过已付额。 | [Refund](https://doc.cryptomus.com/merchant-api/payments/refund) |
| 结算/出款 | 资金在商户业务钱包；文档提供商户钱包→个人钱包转账，以及 API 出款到外部地址。外部出款需要网络、地址、唯一 `order_id`，并从业务钱包余额发起。 | [Transfer to personal wallet](https://doc.cryptomus.com/merchant-api/payouts/transfer-to-personal)；[Creating a payout](https://doc.cryptomus.com/merchant-api/payouts/creating-payout) |
| KYC、项目审核 | FAQ 称 KYC 对所有用户强制；商户接入需提交项目 URL/名称、等待审核并选域名验证方法。 | [Do I have to go through KYC?](https://cryptomus.com/faq/do-i-have-to-go-through-kyc)；[How do I integrate Cryptomus into my project?](https://cryptomus.com/faq/how-do-i-integrate-cryptomus-into-my-project) |

## 准入、地区与业务边界：证据状态

- **已核验**：KYC 是官方 FAQ 所说的全用户必经项；接入收款 API 还要项目审核和域名/项目所有权验证。因此它不解决“个人身份无需授权/无需实名”的问题。
- **未证实，不能假设可用**：个人而非公司是否可获商户审核；AeraNexa 当前业务在你的国家/地区是否准入；受限国家/制裁地区列表；被禁止商品/服务类别；具体证件、税务/KYB、额度、费率与结算周期。
- **原因**：官方站点可访问的 FAQ/API 文档提供上述 KYC 与审核事实；`https://cryptomus.com/tos` 和 `https://cryptomus.com/aml` 在本次只读访问中返回访问防护页，未能取得可逐条核对的正文。不要用缓存、第三方转载或旧营销文案替代条款核验。

## 给 AeraNexa 的接入门槛

1. 先完成账号 KYC、项目审核和域名验证，要求客服/书面条款确认 AeraNexa 的主体、业务、地域和 USDC 指定网络均获准。
2. 用测试或小额真实订单调用“List of services”，将唯一选定的 `USDC` + `network`、最小金额、费率记录到支付方式配置；不要硬编码文档示例。
3. 新增 `CryptomusAdapter`，只提供服务端 create invoice、验签 webhook、主动查询、退款四项；密钥绝不发往前端、日志或数据库明文配置。
4. Webhook 只入原始事件账本；验证签名/IP 后以 UUID/order ID 主动查单，严格核对订单金额、`payer_currency=USDC`、`network`、状态和 finality。仅在 `paid`（是否接收 `paid_over` 由退款/超额策略决定）时经现有幂等入口开通权益；`confirm_check`、`process`、`locked`、退款状态均不得履约。保存 `txid` 供对账，但不将其作为唯一成功依据：官方说明内部 P2P 或人工标记已付时它可能为空。
5. 退款由后台人工复核发起，保存 Cryptomus 退款/出款 ID，并用回调和主动查询同步 `refund_process` / `refund_paid` / `refund_fail`；早期不要对用户自填地址做自动打款。

## 决策

如果 Cryptomus 对你的 KYC、项目和地区审批通过，它是比“固定 USDC 地址 + 用户报交易哈希”更完整的托管支付网关候选项，且可适配 AeraNexa 现有订单、回调事件、对账和幂等履约结构。它的代价是资金和支付确认由第三方托管、共享 API key 签名以及持续的平台/合规依赖；如果目标是完全自托管或规避身份审核，它不符合该目标。

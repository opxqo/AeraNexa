import { localApiRequest, localApiRequestFull } from "./client";
import type { CheckoutResult, OrderItem, PagedMeta, PaymentMethod } from "./types";

export interface SaveOrderParams {
  plan_id: number;
  period: string;
  coupon_code?: string;
}

export interface CheckoutParams {
  trade_no: string;
  method: number; // payment_methods.id
}

export interface OrderStatusResult {
  status: number;
  status_label: string;
}

export const orderApi = {
  /** 分页获取订单列表，同时返回分页元信息。 */
  async fetchOrderPage(options: { status?: number; page?: number; pageSize?: number } = {}): Promise<{
    items: OrderItem[];
    meta: PagedMeta;
  }> {
    const response = await localApiRequestFull<OrderItem[]>("client/orders", {
      params: { status: options.status, page: options.page, page_size: options.pageSize },
    });
    const meta = response.meta as Partial<PagedMeta> | undefined;
    return {
      items: response.data,
      meta: {
        total: Number(meta?.total ?? response.data.length),
        page: Number(meta?.page ?? 1),
        page_size: Number(meta?.page_size ?? response.data.length),
        has_more: Boolean(meta?.has_more),
      },
    };
  },

  /** 仅取订单数组，兼容不需要分页信息的调用方。 */
  async fetchOrders(status?: number): Promise<OrderItem[]> {
    const { items } = await orderApi.fetchOrderPage({ status });
    return items;
  },

  async fetchOrderDetail(trade_no: string): Promise<OrderItem> {
    return localApiRequest<OrderItem>(`client/orders/${encodeURIComponent(trade_no)}`);
  },

  /** 创建订单，成功返回订单号。 */
  async saveOrder(params: SaveOrderParams): Promise<string> {
    return localApiRequest<string>("client/orders", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return localApiRequest<PaymentMethod[]>("client/payment-methods");
  },

  /** 发起支付。返回结构对齐真实网关：type 0 = 本地/二维码收银台，1 = 外部跳转。 */
  async checkout(params: CheckoutParams): Promise<CheckoutResult> {
    return localApiRequest<CheckoutResult>("client/orders/checkout", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },

  async checkStatus(trade_no: string): Promise<OrderStatusResult> {
    return localApiRequest<OrderStatusResult>("client/orders/status", { params: { trade_no } });
  },

  async cancelOrder(trade_no: string): Promise<boolean> {
    return localApiRequest<boolean>("client/orders/cancel", {
      method: "POST",
      body: { trade_no } as unknown as Record<string, unknown>,
    });
  },

  /** 模拟支付确认。接入真实渠道后由支付回调替代，前端调用点可直接移除。 */
  async confirmMockPayment(params: { trade_no: string; transaction_id: number }): Promise<OrderItem> {
    return localApiRequest<OrderItem>("client/orders/mock-confirm", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },
};

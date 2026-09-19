import { localApiRequest } from "./client";
import type { OrderItem, PaymentMethod } from "./types";

export interface SaveOrderParams {
  plan_id: number;
  period: string;
  coupon_code?: string;
}

export interface CheckoutParams {
  trade_no: string;
  method: number; // payment_id
}

export const orderApi = {
  // 获取订单列表
  async fetchOrders(status?: number): Promise<OrderItem[]> {
    return localApiRequest<OrderItem[]>("client/orders", {
      params: { status },
    });
  },

  // 获取订单详情
  async fetchOrderDetail(trade_no: string): Promise<OrderItem> {
    return localApiRequest<OrderItem>(`client/orders/${encodeURIComponent(trade_no)}`);
  },

  // 创建订单
  async saveOrder(params: SaveOrderParams): Promise<string> {
    // 成功返回 trade_no
    return localApiRequest<string>("client/orders", {
      method: "POST",
      body: params as any,
    });
  },

  // 获取可用支付方式
  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return localApiRequest<PaymentMethod[]>("client/payment-methods");
  },

  // 发起结账支付
  async checkout(params: CheckoutParams): Promise<any> {
    return localApiRequest<any>("client/orders/checkout", {
      method: "POST",
      body: params as any,
    });
  },

  // 轮询订单支付状态 (0 待支付, 1 开通中, 2 已取消, 3 已完成)
  async checkStatus(trade_no: string): Promise<number> {
    return localApiRequest<number>("client/orders/status", {
      params: { trade_no },
    });
  },

  // 取消未支付订单
  async cancelOrder(trade_no: string): Promise<boolean> {
    return localApiRequest<boolean>("client/orders/cancel", {
      method: "POST",
      body: { trade_no } as any,
    });
  },
  async confirmMockPayment(params: { trade_no: string; transaction_id: number }): Promise<OrderItem> {
    return localApiRequest<OrderItem>("client/orders/mock-confirm", { method: "POST", body: params });
  },
};

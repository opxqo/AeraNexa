import { localApiRequest } from "./client";
import type { Plan, CouponVerifyResult } from "./types";

export const planApi = {
  // 获取所有可见套餐列表
  async fetchPlans(): Promise<Plan[]> {
    return localApiRequest<Plan[]>("client/plans");
  },

  // 获取特定套餐详情
  async fetchPlanDetail(id: number): Promise<Plan> {
    const plans = await localApiRequest<Plan[]>("client/plans");
    const plan = plans.find((item) => item.id === id);
    if (!plan) throw new Error("套餐不存在");
    return plan;
  },

  /**
   * 验证优惠券。
   * 必须同时传入 period，服务端才能按「所选周期原价」计算抵扣金额，
   * 否则会退化为按月价格计算，导致前端展示与实际应付不一致。
   */
  async checkCoupon(code: string, plan_id: number, period?: string): Promise<CouponVerifyResult> {
    return localApiRequest<CouponVerifyResult>("client/coupons/check", {
      method: "POST",
      body: { code, plan_id, period } as unknown as Record<string, unknown>,
    });
  },
};

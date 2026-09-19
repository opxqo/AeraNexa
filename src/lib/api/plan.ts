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

  // 验证优惠券
  async checkCoupon(code: string, plan_id: number): Promise<CouponVerifyResult> {
    return localApiRequest<CouponVerifyResult>("client/coupons/check", {
      method: "POST",
      body: { code, plan_id } as any,
    });
  },
};

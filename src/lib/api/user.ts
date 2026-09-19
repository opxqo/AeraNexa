import { localApiRequest } from "./client";
import type { UserInfo, UserSubscribe, UserStat, TrafficRecord } from "./types";

export const userApi = {
  // 获取个人资料与基础配置
  async fetchInfo(): Promise<UserInfo> {
    return localApiRequest<UserInfo>("user/info", { silentUnauthorized: true });
  },

  // 获取订阅详情与当前可用流量
  async fetchSubscribe(): Promise<UserSubscribe> {
    return localApiRequest<UserSubscribe>("user/getSubscribe", { silentUnauthorized: true });
  },

  // 获取统计数据 [未支付订单, 待处理工单, 累计邀请]
  async fetchStat(): Promise<UserStat> {
    return localApiRequest<UserStat>("user/getStat", { silentUnauthorized: true });
  },

  // 重置订阅 Token 与链接
  async resetSecurity(): Promise<string> {
    return localApiRequest<string>("user/resetSecurity");
  },

  // 修改密码
  async changePassword(params: { old_password: string; new_password: string }): Promise<boolean> {
    return localApiRequest<boolean>("user/changePassword", {
      method: "POST",
      body: params as any,
    });
  },

  // 更新用户信息或通知开关
  async update(params: {
    remind_expire?: number;
    remind_traffic?: number;
  }): Promise<boolean> {
    return localApiRequest<boolean>("user/update", {
      method: "POST",
      body: params as any,
    });
  },

  // 划转佣金至可用余额
  async transfer(transfer_amount: number): Promise<boolean> {
    return localApiRequest<boolean>("client/commission/transfer", {
      method: "POST",
      body: { transfer_amount } as any,
    });
  },

  // 获取近几日流量日志
  async fetchTrafficLog(): Promise<TrafficRecord[]> {
    return localApiRequest<TrafficRecord[]>("client/traffic");
  },
};

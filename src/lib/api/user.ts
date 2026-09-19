import { localApiRequest } from "./client";
import type { UserInfo, UserSubscribe, UserStat, TrafficRecord } from "./types";

/** resetSecurity 返回的新订阅凭据。 */
export interface ResetSecurityResult {
  token: string;
  uuid: string;
  subscribe_url: string;
}

export const userApi = {
  // 获取个人资料与基础配置
  async fetchInfo(): Promise<UserInfo> {
    return localApiRequest<UserInfo>("user/info", { silentUnauthorized: true });
  },

  // 获取订阅详情与当前可用流量
  async fetchSubscribe(): Promise<UserSubscribe> {
    return localApiRequest<UserSubscribe>("user/getSubscribe", { silentUnauthorized: true });
  },

  // 获取统计数据：未支付订单、待处理工单、累计邀请
  async fetchStat(): Promise<UserStat> {
    return localApiRequest<UserStat>("user/getStat", { silentUnauthorized: true });
  },

  /**
   * 重置订阅 Token 与 UUID。
   * 服务端会同时轮换 uuid 与订阅 token，因此返回完整的新凭据而不是单个 token。
   * 该操作会改变服务端状态，使用 POST。
   */
  async resetSecurity(): Promise<ResetSecurityResult> {
    return localApiRequest<ResetSecurityResult>("user/resetSecurity", { method: "POST" });
  },

  // 修改密码
  async changePassword(params: { old_password: string; new_password: string }): Promise<boolean> {
    return localApiRequest<boolean>("user/changePassword", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },

  // 更新用户信息或通知开关
  async update(params: {
    nickname?: string;
    remind_expire?: number;
    remind_traffic?: number;
  }): Promise<boolean> {
    return localApiRequest<boolean>("user/update", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },

  // 划转佣金至可用余额
  async transfer(transfer_amount: number): Promise<boolean> {
    return localApiRequest<boolean>("client/commission/transfer", {
      method: "POST",
      body: { transfer_amount } as unknown as Record<string, unknown>,
    });
  },

  // 获取近几日流量日志
  async fetchTrafficLog(days = 30): Promise<TrafficRecord[]> {
    return localApiRequest<TrafficRecord[]>("client/traffic", { params: { days } });
  },
};

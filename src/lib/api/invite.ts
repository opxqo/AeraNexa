import { localApiRequest } from "./client";
import type { InviteFetch, InviteDetailItem } from "./types";

export const inviteApi = {
  // 获取我的邀请概览与已有邀请码
  async fetchInvite(): Promise<InviteFetch> {
    return localApiRequest<InviteFetch>("client/invites");
  },

  // 生成新的邀请码
  async generateCode(): Promise<boolean> {
    return localApiRequest<boolean>("client/invites", { method: "POST" });
  },

  // 获取佣金与邀请详细记录
  async fetchDetails(): Promise<InviteDetailItem[]> {
    return Promise.resolve([]);
  },
};

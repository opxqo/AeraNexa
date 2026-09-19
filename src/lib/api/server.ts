import { localApiRequest } from "./client";
import type { ServerNode } from "./types";

export const serverApi = {
  // 获取用户可用节点列表
  async fetchServers(): Promise<ServerNode[]> {
    return localApiRequest<ServerNode[]>("client/nodes");
  },
};

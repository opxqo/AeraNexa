import { localApiRequest } from "./client";
import type { Notice } from "./types";

export interface NoticeFetchResult {
  data: Notice[];
  total: number;
}

/** 公告接口可能直接返回数组，也可能包一层 { data, total }。 */
type NoticePayload = Notice[] | { data?: Notice[] } | null;

export const noticeApi = {
  // 获取公告列表
  async fetchNotices(current: number = 1): Promise<Notice[]> {
    const res = await localApiRequest<NoticePayload>("client/notices", {
      params: { current },
    });
    // 部分后端直接返回 Notice[] 或返回 { data: Notice[], total }
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  },
};

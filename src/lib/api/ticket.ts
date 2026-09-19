import { localApiRequest } from "./client";
import type { Ticket } from "./types";

export interface SaveTicketParams {
  subject: string;
  level: number; // 0 低, 1 中, 2 高
  message: string;
}

export const ticketApi = {
  // 获取工单列表
  async fetchTickets(): Promise<Ticket[]> {
    return localApiRequest<Ticket[]>("client/tickets");
  },

  // 创建工单，返回新工单 id
  async saveTicket(params: SaveTicketParams): Promise<number> {
    return localApiRequest<number>("client/tickets", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },

  // 回复工单
  async replyTicket(params: { id: number; message: string }): Promise<boolean> {
    return localApiRequest<boolean>("client/tickets/reply", {
      method: "POST",
      body: params as unknown as Record<string, unknown>,
    });
  },

  // 关闭工单
  async closeTicket(id: number): Promise<boolean> {
    return localApiRequest<boolean>("client/tickets/close", {
      method: "POST",
      body: { id } as unknown as Record<string, unknown>,
    });
  },
  async fetchTicket(id: number): Promise<Ticket> {
    return localApiRequest<Ticket>(`client/tickets/${id}`);
  },
};

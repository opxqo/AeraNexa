import { localApiRequest, localApiRequestFull } from "./client";
import type { WalletTransaction } from "./types";

export const walletApi = {
  async redeem(code: string): Promise<{ balance: number; credited_amount: number; transaction_id: number }> {
    return localApiRequest("client/wallet/recharge", { method: "POST", body: { code } });
  },
  async transactions(page = 1, pageSize = 10): Promise<{ items: WalletTransaction[]; total: number }> {
    const response = await localApiRequestFull<WalletTransaction[]>("client/wallet/transactions", {
      params: { page, page_size: pageSize },
    });
    return { items: response.data, total: Number(response.meta?.total ?? response.data.length) };
  },
};

import { localApiRequest } from "./client";
import type { AuthData } from "./types";

export interface LoginParams {
  email: string;
  password: string;
}

export interface RegisterParams {
  email: string;
  password: string;
  password_confirmation?: string;
  email_code?: string;
  invite_code?: string;
}

export interface ForgetParams {
  email: string;
  email_code: string;
  password: string;
  password_confirmation?: string;
}

export const authApi = {
  // 登录
  async login(params: LoginParams): Promise<AuthData> {
    return localApiRequest<AuthData>("auth/login", {
      method: "POST",
      body: { ...params },
    });
  },

  // 注册
  async register(params: RegisterParams): Promise<AuthData> {
    return localApiRequest<AuthData>("auth/register", {
      method: "POST",
      body: { ...params },
    });
  },

  // 发送邮箱验证码
  async sendEmailVerify(email: string, purpose: "register" | "reset-password" = "register"): Promise<{ message: string }> {
    return localApiRequest<{ message: string }>("auth/send-email-verify", {
      method: "POST",
      body: { email, purpose },
    });
  },

  // 找回密码
  async forget(params: ForgetParams): Promise<boolean> {
    return localApiRequest<boolean>("auth/forget", {
      method: "POST",
      body: { ...params },
    });
  },

  // 登出
  async logout(): Promise<boolean> {
    return localApiRequest<boolean>("auth/logout", { method: "POST" });
  },
};

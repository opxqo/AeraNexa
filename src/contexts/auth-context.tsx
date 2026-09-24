"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clearAuthToken } from "@/lib/api/client";
import { authApi } from "@/lib/api/auth";
import { userApi } from "@/lib/api/user";
import type { UserInfo, UserSubscribe, UserStat } from "@/lib/api/types";

interface AuthContextType {
  user: UserInfo | null;
  subscribe: UserSubscribe | null;
  stat: UserStat | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface SessionSnapshot {
  user: UserInfo | null;
  subscribe: UserSubscribe | null;
  stat: UserStat | null;
}

/**
 * 拉取用户、订阅与统计三份数据。
 * 定义在组件外，只做请求与聚合，不触碰任何 React 状态，
 * 由调用方决定如何写入（effect 中首次加载 / 事件回调中刷新）。
 */
async function fetchSessionSnapshot(): Promise<SessionSnapshot> {
  const [userInfo, subInfo, statInfo] = await Promise.allSettled([
    userApi.fetchInfo(),
    userApi.fetchSubscribe(),
    userApi.fetchStat(),
  ]);

  return {
    user: userInfo.status === "fulfilled" ? userInfo.value : null,
    subscribe: subInfo.status === "fulfilled" ? subInfo.value : null,
    stat: statInfo.status === "fulfilled" ? statInfo.value : null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [user, setUser] = useState<UserInfo | null>(null);
  const [subscribe, setSubscribe] = useState<UserSubscribe | null>(null);
  const [stat, setStat] = useState<UserStat | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** 把快照写入状态；失败的单项保留原值，避免界面被清空。 */
  const applySnapshot = useCallback((snapshot: SessionSnapshot) => {
    setUser((prev) => snapshot.user ?? prev);
    setSubscribe((prev) => snapshot.subscribe ?? prev);
    setStat((prev) => snapshot.stat ?? prev);
  }, []);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      applySnapshot(await fetchSessionSnapshot());
    } finally {
      setIsLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAuthToken();
      setUser(null);
      setSubscribe(null);
      setStat(null);
      router.push("/login");
    };

    window.addEventListener("v2:unauthorized", handleUnauthorized);

    // isLoading 初值即为 true，首屏加载结果只在异步回调中写入状态。
    void fetchSessionSnapshot().then((snapshot) => {
      applySnapshot(snapshot);
      setIsLoading(false);
    });

    return () => window.removeEventListener("v2:unauthorized", handleUnauthorized);
  }, [applySnapshot, router]);

  const logout = async () => {
    await authApi.logout().catch(() => undefined);
    clearAuthToken();
    setUser(null);
    setSubscribe(null);
    setStat(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        subscribe,
        stat,
        isLoading,
        isAuthenticated: !!user,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<UserInfo | null>(null);
  const [subscribe, setSubscribe] = useState<UserSubscribe | null>(null);
  const [stat, setStat] = useState<UserStat | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isDemo = pathname.startsWith("/demo");

  const refreshUser = useCallback(async () => {
    if (isDemo) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [userInfo, subInfo, statInfo] = await Promise.allSettled([
        userApi.fetchInfo(),
        userApi.fetchSubscribe(),
        userApi.fetchStat(),
      ]);

      if (userInfo.status === "fulfilled") setUser(userInfo.value);
      if (subInfo.status === "fulfilled") setSubscribe(subInfo.value);
      if (statInfo.status === "fulfilled") setStat(statInfo.value);
    } catch {
      // 忽略单个失败
    } finally {
      setIsLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    refreshUser();

    const handleUnauthorized = () => {
      clearAuthToken();
      setUser(null);
      setSubscribe(null);
      setStat(null);
      router.push("/login");
    };

    window.addEventListener("v2:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("v2:unauthorized", handleUnauthorized);
  }, [refreshUser, router]);

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

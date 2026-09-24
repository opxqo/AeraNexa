import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { getCurrentUser } from "@/lib/server/users";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  // 已登录用户不再停留在登录 / 注册页；与门户 layout 用同一个校验（含会话吊销与账户停用），不会互相重定向成环
  if (await getCurrentUser()) redirect("/dashboard");
  const resolved = await searchParams;
  const code = Array.isArray(resolved.code) ? resolved.code[0] : resolved.code;
  return <AuthCard mode="register" initialInviteCode={code?.trim().slice(0, 64) ?? ""} />;
}

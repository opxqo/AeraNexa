import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { HOME_LOCALE_COOKIE, toHomeLocale } from "@/lib/home-copy";
import { getCurrentUser } from "@/lib/server/users";

export default async function LoginPage() {
  // 已登录用户不再停留在登录 / 注册页；与门户 layout 用同一个校验（含会话吊销与账户停用），不会互相重定向成环
  if (await getCurrentUser()) redirect("/dashboard");
  return <AuthCard mode="login" initialLocale={toHomeLocale((await cookies()).get(HOME_LOCALE_COOKIE)?.value)} />;
}

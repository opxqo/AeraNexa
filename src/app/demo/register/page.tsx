import { AuthCard } from "@/components/auth-card";

export default async function DemoRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const resolved = await searchParams;
  const code = Array.isArray(resolved.code) ? resolved.code[0] : resolved.code;
  return <AuthCard mode="register" initialInviteCode={code?.trim().slice(0, 64) ?? ""} />;
}

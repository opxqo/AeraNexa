"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { useDemoLocale } from "@/lib/demo-site/locale";
import { useSession } from "@/lib/demo-site/session";
import { useEntering } from "@/lib/enter-panel";

/**
 * The sign-in, sign-up and reset pages (src/app/login and friends) for the static demo site: the language and the invite
 * code are read in the browser, and someone already signed in goes straight to the panel.
 */
export function DemoAuth({ mode }: { mode: "login" | "register" | "forget" }) {
  return (
    <Suspense>
      <Page mode={mode} />
    </Suspense>
  );
}

function Page({ mode }: { mode: "login" | "register" | "forget" }) {
  const session = useSession();
  const router = useRouter();
  const locale = useDemoLocale();
  const entering = useEntering();
  const code = useSearchParams().get("code");

  // Not while the sign-in hand-over is running: it takes the page to the panel itself.
  useEffect(() => {
    if (session && !entering) router.replace("/dashboard");
  }, [session, entering, router]);

  // The card keeps its own copy of the language, so it is only drawn once the browser has been asked for the stored one.
  if (session === undefined) return null;
  return <AuthCard mode={mode} initialInviteCode={code?.trim().slice(0, 64) ?? ""} initialLocale={locale} />;
}

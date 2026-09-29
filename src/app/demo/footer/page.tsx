import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SiteFooter } from "@/components/footer/site-footer";
import { HOME_LOCALE_COOKIE, toHomeLocale } from "@/lib/home-copy";

export const metadata: Metadata = {
  title: "页脚 Demo",
  description: "AeraNexa 页脚演示，版式参照 unitedcarriers.com。",
};

// The footer on its own, under a black band as on the page it follows.
export default async function FooterDemoPage() {
  const locale = toHomeLocale((await cookies()).get(HOME_LOCALE_COOKIE)?.value);
  return (
    <main>
      <div style={{ height: "56vh", minHeight: 360, background: "#111" }} aria-hidden="true" />
      <SiteFooter locale={locale} />
    </main>
  );
}

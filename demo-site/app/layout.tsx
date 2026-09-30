import type { Metadata } from "next";
import "@/app/globals.css";
import { EnterSplash } from "@/components/enter-splash";

export const metadata: Metadata = {
  title: { default: "AeraNexa", template: "%s · AeraNexa" },
  description: "AeraNexa secure network service portal (demo)",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

// The same shell as src/app/layout.tsx; the demo site has its own copy so the main app stays untouched.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}else{document.documentElement.removeAttribute('data-theme');}}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement,s='off';try{var p=location.pathname;if((p==='/'||p==='/index.html')&&!sessionStorage.getItem('aeranexa-splash')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)s='on';}catch(e){}d.setAttribute('data-splash',s);})();`,
          }}
        />
        {children}
        <EnterSplash />
      </body>
    </html>
  );
}

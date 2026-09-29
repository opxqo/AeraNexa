import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AeraNexa",
    template: "%s · AeraNexa",
  },
  description: "AeraNexa secure network service portal",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}else{document.documentElement.removeAttribute('data-theme');}}catch(e){}})();`,
          }}
        />
        {/* The opening splash runs on the first visit of a session, when the page loaded at "/".
            This marks it before the first paint so a cover (globals.css) hides the page until the
            splash mounts; without JS nothing is marked, so nothing is covered. See lib/splash-state.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement,s='off';try{if(location.pathname==='/'&&!sessionStorage.getItem('aeranexa-splash')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)s='on';}catch(e){}d.setAttribute('data-splash',s);})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}

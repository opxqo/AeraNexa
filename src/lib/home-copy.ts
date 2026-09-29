// Home page copy in both languages. The two entries share one shape, so
// TypeScript flags any key missing from either language.

export type HomeLocale = "zh" | "en";

export const HOME_LOCALE_COOKIE = "aeranexa_locale";

export function toHomeLocale(value: string | undefined): HomeLocale {
  return value === "en" ? "en" : "zh";
}

type MenuEntry = { label: string; href: string };
type MenuSection = { heading: string; entries: MenuEntry[] };

type HomeCopy = {
  lang: string;
  meta: { title: string; description: string };
  header: {
    homeLabel: string;
    navLabel: string;
    mobileNavLabel: string;
    languageLabel: string;
    product: string;
    nodes: string;
    pricing: string;
    help: string;
    menus: { product: MenuSection[]; help: MenuSection[] };
    login: string;
    getStarted: string;
    viewNodes: string;
    menuTitle: string;
    openMenu: string;
    closeMenu: string;
  };
  hero: {
    // Rendered as: lead <br> <highlight>tail
    lead: string;
    highlight: string;
    tail: string;
    description: string;
    primary: string;
    secondary: string;
    mapLabel: string;
    mapImageLabel: string;
  };
};

export const homeCopy: Record<HomeLocale, HomeCopy> = {
  zh: {
    lang: "zh-CN",
    meta: { title: "AeraNexa", description: "AeraNexa 提供高速、稳定、安全的全球节点，让你随时随地连接更广阔的世界。" },
    header: {
      homeLabel: "AeraNexa 首页",
      navLabel: "网站导航",
      mobileNavLabel: "手机网站导航",
      languageLabel: "选择语言",
      product: "产品",
      nodes: "节点",
      pricing: "价格",
      help: "帮助",
      menus: {
        product: [
          { heading: "探索产品", entries: [{ label: "产品概览", href: "/" }, { label: "全球节点", href: "/node" }] },
          { heading: "开始使用", entries: [{ label: "套餐价格", href: "/pricing" }, { label: "创建账户", href: "/register" }] },
        ],
        help: [
          { heading: "支持资源", entries: [{ label: "使用文档", href: "/knowledge" }] },
          { heading: "账户服务", entries: [{ label: "登录账户", href: "/login" }, { label: "创建账户", href: "/register" }] },
        ],
      },
      login: "登录",
      getStarted: "立即开始",
      viewNodes: "查看节点",
      menuTitle: "菜单",
      openMenu: "打开导航菜单",
      closeMenu: "关闭导航菜单",
    },
    hero: {
      lead: "更快，更稳定的",
      highlight: "全球网络",
      tail: "连接。",
      description: "AeraNexa 提供高速、稳定、安全的全球节点，让你随时随地连接更广阔的世界。",
      primary: "立即开始",
      secondary: "查看套餐",
      mapLabel: "全球节点网络示意图",
      mapImageLabel: "球冠式半球世界陆地点阵，地图贴合倾斜球面，边缘向后弯曲",
    },
  },
  en: {
    lang: "en",
    meta: { title: "AeraNexa", description: "Fast, stable and secure nodes around the world — so you can reach further, from anywhere." },
    header: {
      homeLabel: "AeraNexa home",
      navLabel: "Main navigation",
      mobileNavLabel: "Mobile navigation",
      languageLabel: "Choose language",
      product: "Product",
      nodes: "Nodes",
      pricing: "Pricing",
      help: "Help",
      menus: {
        product: [
          { heading: "Explore", entries: [{ label: "Overview", href: "/" }, { label: "Global nodes", href: "/node" }] },
          { heading: "Get started", entries: [{ label: "Pricing", href: "/pricing" }, { label: "Create account", href: "/register" }] },
        ],
        help: [
          { heading: "Support", entries: [{ label: "Documentation", href: "/knowledge" }] },
          { heading: "Account", entries: [{ label: "Log in", href: "/login" }, { label: "Create account", href: "/register" }] },
        ],
      },
      login: "Log in",
      getStarted: "Get started",
      viewNodes: "View nodes",
      menuTitle: "Menu",
      openMenu: "Open navigation",
      closeMenu: "Close navigation",
    },
    hero: {
      lead: "A faster, more reliable",
      highlight: "global network",
      tail: ".",
      description: "Fast, stable and secure nodes around the world — so you can reach further, from anywhere.",
      primary: "Get started",
      secondary: "View plans",
      mapLabel: "Map of the global node network",
      mapImageLabel: "Dot map of the world curving over a globe",
    },
  },
};

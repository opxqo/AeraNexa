// Mock data for the Cursor-style account dashboard demo (/demo/cursor-dashboard). Everything here
// is made up; the strings follow the reference screenshots so the pages read the same.

export type Plan = "free" | "pro";

export const USER = { first: "alex", last: "smith", org: "samleemobbin-dot" };

export const PLANS = [
  {
    id: "pro",
    name: "Pro",
    price: "$20",
    blurb: "Entry-level plan with access to premium models, unlimited Tab completions, and more.",
    short: "Entry-level plan with access to premium models, unlimited Tab completions, and more.",
    features: ["Extended limits on Agent", "Unlimited Tab completions", "Background Agents", "Maximum context windows"],
  },
  {
    id: "pro-plus",
    name: "Pro+",
    price: "$60",
    blurb: "Get 3x more usage than Pro and unlock higher limits on Agent and premium models.",
    short: "Get 3x more usage than Pro, unlock higher limits on Agent, and more.",
    features: ["Everything in Pro", "3x usage on OpenAI, Claude, and Gemini models", "Higher Agent limits", "Priority access to premium capacity"],
  },
  {
    id: "ultra",
    name: "Ultra",
    price: "$200",
    blurb: "Get maximum value with 20x usage limits and early access to advanced features.",
    short: "Get maximum value with 20x usage limits and early access to advanced features.",
    features: ["Everything in Pro+", "20x usage on OpenAI, Claude, and Gemini models", "Priority access to new features", "Highest throughput and limits"],
  },
] as const;

export const TEAM_PLAN = {
  name: "Team",
  price: "$40/user/mo.",
  blurb: "Everything in Pro, plus collaboration and centralized billing.",
  features: ["Shared chats, commands, and rules", "Centralized team billing", "Usage analytics and reporting", "Role-based access control", "Org-wide privacy mode controls", "SAML/OIDC SSO"],
};

/** AI Line Edits heat map: 53 weeks × 7 days; one lit cell (March 24, 2026) in the third row. */
export const HEATMAP = {
  columns: 53,
  rows: 7,
  months: ["A", "M", "J", "J", "A", "S", "O", "N", "D", "J", "F", "M"],
  /** Centre x of each month letter, measured on the reference (1920 wide), from the page's left edge. */
  monthCenters: [686, 768, 867, 948, 1031, 1132, 1215, 1296, 1398, 1476, 1579, 1662],
  lit: { column: 52, row: 2, level: 4, date: "Tuesday, March 24, 2026", lines: 853 },
};

export const INTEGRATIONS = [
  { id: "github", name: "GitHub", text: "Connect GitHub for Cloud Agents, Bugbot and enhanced codebase context", connected: `Connected as ${USER.org} to repositories in organizations: ${USER.org}` },
  { id: "gitlab", name: "GitLab", text: "Connect GitLab for Cloud Agents, Bugbot and enhanced codebase context", connected: "Connected as samleemobbin to repositories in organizations: samleemobbin" },
  { id: "slack", name: "Slack", text: "Work with Cloud Agents from Slack", connected: "Connected to the samleemobbin workspace" },
  { id: "linear", name: "Linear", text: "Connect a Linear workspace to delegate issues to Cloud Agents", connected: "Connected to the samleemobbin workspace" },
] as const;

export const REPOS = ["astrowind-lp", "docs", "doggy-stickers", "mini-landing-page", "openreact-lp", "tailwind-lp"];

/** The demo's "today": the billing cycle started Mar 24 and resets Apr 24, 2026. */
export const TODAY = new Date(2026, 2, 26);

// A small seeded generator so the made-up usage is the same on every render and every reload.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Daily spend in USD for the 90 days up to TODAY, split into API and Auto + Composer. */
export const USAGE_DAYS = (() => {
  const random = seeded(7);
  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(TODAY);
    date.setDate(date.getDate() - (89 - index));
    const scale = date.getDay() === 0 || date.getDay() === 6 ? 0.35 : 1;
    const api = Math.round((0.4 + random() * 3.2) * scale * 100) / 100;
    const auto = Math.round((0.1 + random() * 1.4) * scale * 100) / 100;
    return { date: iso(date), api, auto };
  });
})();

export const MODELS = ["gpt-5.3-codex-high", "claude-4.6-opus-high-thinking", "claude-4.6-sonnet", "gemini-3-pro", "Auto + Composer"] as const;

export type UsageEvent = { id: string; date: string; model: (typeof MODELS)[number]; kind: "Included" | "On-demand"; tokens: number; cost: number };

/** About a hundred requests spread over the same 90 days, newest first. */
export const USAGE_EVENTS: UsageEvent[] = (() => {
  const random = seeded(21);
  const rows: UsageEvent[] = [];
  for (let index = 0; index < 96; index += 1) {
    const date = new Date(TODAY);
    date.setDate(date.getDate() - Math.floor(random() * random() * 90));
    const model = MODELS[Math.floor(random() * MODELS.length)];
    const tokens = Math.round((20 + random() * 900) * 1000);
    rows.push({ id: `evt-${index}`, date: iso(date), model, kind: random() > 0.92 ? "On-demand" : "Included", tokens, cost: Math.round(tokens * 0.0000035 * 100) / 100 });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
})();

export const SESSIONS = [
  { id: "s1", device: "Chrome on macOS", place: "Tokyo, JP", seen: "Active now", current: true },
  { id: "s2", device: "Safari on iPhone", place: "Tokyo, JP", seen: "2 hours ago", current: false },
  { id: "s3", device: "Firefox on Windows", place: "Osaka, JP", seen: "Mar 21, 2026", current: false },
];

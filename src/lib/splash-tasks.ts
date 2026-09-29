import { fetchBytesTracked, loadCapLand } from "@/lib/splash-data";

/** One thing the splash waits for. `run` reports its own 0–1 progress; `weight` is its share of the bar. */
export type SplashTask = {
  id: string;
  weight: number;
  run: (report: (fraction: number) => void) => Promise<unknown>;
};

type SplashTaskOptions = {
  /** Stagger the tasks so the bar visibly steps (demo: simulates a slow network). */
  slow?: boolean;
  /** Skip the HTTP cache so a replay downloads the files again (demo). */
  fresh?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the home page needs before its first paint of the map feels finished. */
export function createSplashTasks({ slow = false, fresh = false }: SplashTaskOptions = {}): SplashTask[] {
  const staged = (delay: number, work: (report: (fraction: number) => void) => Promise<unknown>) =>
    async (report: (fraction: number) => void) => {
      if (slow) await sleep(delay);
      await work(report);
      report(1);
    };

  return [
    {
      id: "fonts",
      weight: 1,
      run: staged(300, () => document.fonts.ready),
    },
    {
      id: "map-frame",
      weight: 2,
      run: staged(900, (report) => fetchBytesTracked("/demo/world-map-cap-desktop.svg", report, fresh)),
    },
    {
      id: "cap-land",
      weight: 3,
      run: staged(1300, (report) => loadCapLand({ report, fresh })),
    },
    {
      id: "globe-points",
      weight: 4,
      run: staged(1700, (report) => fetchBytesTracked("/demo/world-globe-points.json", report, fresh)),
    },
    {
      id: "three",
      weight: 3,
      run: staged(2400, () => import("three")),
    },
  ];
}

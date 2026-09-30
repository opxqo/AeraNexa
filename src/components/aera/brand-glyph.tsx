import { siCloudflare, siDatadog, siFigma, siGithub, siGitlab, siJfrog, siLinear, siPlanetscale, siRender } from "simple-icons";

// Brand glyphs for the integration and plugin tiles. simple-icons no longer ships Slack's, so its
// four-bar mark is drawn here; Pendo, Langfuse and the rest fall back to an initial.

const SLACK =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z";

const PATHS: Record<string, string> = {
  github: siGithub.path,
  gitlab: siGitlab.path,
  linear: siLinear.path,
  figma: siFigma.path,
  datadog: siDatadog.path,
  render: siRender.path,
  cloudflare: siCloudflare.path,
  planetscale: siPlanetscale.path,
  jfrog: siJfrog.path,
  slack: SLACK,
};

export function BrandGlyph({ name, size = 20, title }: { name: string; size?: number; title?: string }) {
  const path = PATHS[name];
  if (!path) {
    return (
      <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: size, height: size, fontSize: size * 0.72, fontWeight: 600, lineHeight: 1 }}>
        {(title ?? name).charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 0 24 24" width={size}>
      <path d={path} />
    </svg>
  );
}

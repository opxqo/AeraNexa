import type { ReactNode } from "react";
import { siClaude, siGooglegemini, siHbomax, siNetflix, siPerplexity, siSpotify, siYoutube } from "simple-icons";
import { chatgpt, disneyPlus, grok, primeVideo, type BrandIcon } from "@/lib/brand-icons";

/** The services a plan unlocks: a brand-coloured tile with the white mark, as the "Trusted by" row of the reference. */
export type BrandTile = { name: string; color: string; icon: BrandIcon };

const si = (icon: { path: string }): BrandIcon => ({ path: icon.path });

export const AI_TILES: BrandTile[] = [
  { name: "ChatGPT", color: "#10A37F", icon: chatgpt },
  { name: "Claude", color: `#${siClaude.hex}`, icon: si(siClaude) },
  { name: "Gemini", color: `#${siGooglegemini.hex}`, icon: si(siGooglegemini) },
  { name: "Perplexity", color: `#${siPerplexity.hex}`, icon: si(siPerplexity) },
  { name: "Grok", color: "#262626", icon: grok },
];

export const STREAMING_TILES: BrandTile[] = [
  { name: "Netflix", color: `#${siNetflix.hex}`, icon: si(siNetflix) },
  { name: "YouTube", color: `#${siYoutube.hex}`, icon: si(siYoutube) },
  { name: "Disney+", color: "#113CCF", icon: disneyPlus },
  { name: "Prime Video", color: "#00A8E1", icon: primeVideo },
  { name: "HBO Max", color: `#${siHbomax.hex}`, icon: si(siHbomax) },
  { name: "Spotify", color: `#${siSpotify.hex}`, icon: si(siSpotify) },
];

/** A caption and a row of 30px tiles, 4px apart (measured on the reference). */
export function BrandTiles({ label, tiles }: { label: ReactNode; tiles: BrandTile[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs/[19.2px] text-stone-500">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {tiles.map((tile) => (
          <li key={tile.name} title={tile.name} className="grid size-[30px] place-items-center rounded-[3px] text-white" style={{ backgroundColor: tile.color }}>
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" role="img" aria-label={tile.name}>
              <path d={tile.icon.path} fillRule={tile.icon.fillRule} />
            </svg>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { cn } from "cn";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** The default avatars: DiceBear "Notionists Neutral" (CC0) saved as static SVGs in public/avatars. */
export const AVATARS = [
  { id: "ash", label: "Ash" },
  { id: "bay", label: "Bay" },
  { id: "cedar", label: "Cedar" },
  { id: "dune", label: "Dune" },
  { id: "ember", label: "Ember" },
  { id: "fern", label: "Fern" },
  { id: "glen", label: "Glen" },
  { id: "haze", label: "Haze" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

export const DEFAULT_AVATAR: AvatarId = "ash";

/** A user's avatar: their chosen default, with the initial as a fallback while it loads. */
export function UserAvatar({ avatar = DEFAULT_AVATAR, name = "", size, className }: { avatar?: AvatarId; name?: string; size?: "sm" | "default" | "lg"; className?: string }) {
  return (
    <Avatar size={size} className={cn(className)}>
      <AvatarImage src={`/avatars/${avatar}.svg`} alt="" />
      <AvatarFallback>{(name.trim().charAt(0) || "A").toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

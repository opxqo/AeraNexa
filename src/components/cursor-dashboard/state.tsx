"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Plan } from "@/lib/demo/cursor-mock";
import { USER } from "@/lib/demo/cursor-mock";
import { DEFAULT_AVATAR, type AvatarId } from "@/components/aera/avatars";

// The little state the pages share (the sidebar shows the name and plan, Overview and Integrations
// both show the connections, ...). All of it lives in memory: reloading starts over.

type Connections = Record<"github" | "gitlab" | "slack" | "linear", boolean>;

type CursorState = {
  plan: Plan;
  setPlan: (plan: Plan) => void;
  first: string;
  last: string;
  setName: (first: string, last: string) => void;
  avatar: AvatarId;
  setAvatar: (avatar: AvatarId) => void;
  connections: Connections;
  setConnected: (id: keyof Connections, value: boolean) => void;
  onDemand: { enabled: boolean; mode: "fixed" | "unlimited"; limit: number };
  setOnDemand: (next: { enabled: boolean; mode: "fixed" | "unlimited"; limit: number }) => void;
};

const Context = createContext<CursorState | null>(null);

export function useCursorState() {
  const value = useContext(Context);
  if (!value) throw new Error("useCursorState needs <CursorStateProvider>");
  return value;
}

export function CursorStateProvider({ initialPlan, children }: { initialPlan: Plan; children: ReactNode }) {
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [name, setNameState] = useState({ first: USER.first, last: USER.last });
  const [avatar, setAvatar] = useState<AvatarId>(DEFAULT_AVATAR);
  const [connections, setConnections] = useState<Connections>({ github: initialPlan === "pro", gitlab: false, slack: false, linear: false });
  const [onDemand, setOnDemand] = useState({ enabled: true, mode: "fixed" as "fixed" | "unlimited", limit: 5 });

  const value = useMemo<CursorState>(
    () => ({
      plan,
      setPlan,
      first: name.first,
      last: name.last,
      setName: (first, last) => setNameState({ first, last }),
      avatar,
      setAvatar,
      connections,
      setConnected: (id, connected) => setConnections((current) => ({ ...current, [id]: connected })),
      onDemand,
      setOnDemand,
    }),
    [plan, name, avatar, connections, onDemand],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

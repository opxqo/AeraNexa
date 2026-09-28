import type { Metadata } from "next";
import { NetworkTopologyDemo } from "@/components/network-topology-demo";

export const metadata: Metadata = {
  title: "全球连接拓扑 Demo · AeraNexa",
  description: "以 AeraNexa 三点 A 形标记呈现服务请求、全球节点与地球之间的连接关系。",
};

export default function NetworkTopologyPage() {
  return <NetworkTopologyDemo />;
}

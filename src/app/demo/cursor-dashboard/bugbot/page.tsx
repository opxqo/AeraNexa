import { BugOff } from "lucide-react";
import { ComingSoon } from "@/components/aera/coming-soon";

export default function Page() {
  return <ComingSoon title="Bugbot" description="Automated code review on your pull requests." icon={BugOff} />;
}

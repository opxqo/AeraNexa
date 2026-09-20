import { redirect } from "next/navigation";

export default async function TelegramAdminPage() {
  redirect("/admin/settings");
}

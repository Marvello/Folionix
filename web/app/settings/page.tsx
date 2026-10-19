import { getPool } from "@/lib/db";
import SettingsClient, { type SettingRow } from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { rows } = await getPool().query(
    "SELECT key, value, updated_at, updated_by FROM app_settings ORDER BY key",
  );
  return <SettingsClient rows={rows as SettingRow[]} />;
}

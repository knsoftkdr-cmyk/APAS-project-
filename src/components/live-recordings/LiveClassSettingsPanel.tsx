import { LiveAttendanceRulesCard } from "@/components/live-attendance/LiveAttendanceRulesCard";
import { LiveRecordingSettingsCard } from "@/components/live-recordings/LiveRecordingSettingsCard";

/**
 * School-wide settings for Live Classes (virtual classrooms): automatic recording and automatic attendance rules.
 * Rendered as a tab inside the existing Admin Panel and School Admin pages, where administrators already work,
 * so no new menu or page is needed. Only admin, principal and school admin can save; HODs see it read-only.
 */
export function LiveClassSettingsPanel() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Settings for Live Classes (virtual classrooms) in your school. Teachers see the effect on their Recordings and Attendance screens.
      </p>
      <LiveRecordingSettingsCard />
      <LiveAttendanceRulesCard />
    </div>
  );
}

export default LiveClassSettingsPanel;

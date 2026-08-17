import { v4 as uuid } from "uuid";
import { store } from "../data/store";
import { AttendanceRecord, AttendanceStatus, ScanEvent } from "../models/types";

class AttendanceSyncService {
  /**
   * Build/refresh attendance records for a given date by pairing up each
   * student's boarding and drop scans for that day.
   *   - Both boarding & drop scan present -> PRESENT
   *   - Only one of the two present         -> PARTIAL (needs review)
   *   - Neither present but student has an active card -> ABSENT (not produced
   *     here since we only have scan data; left for a caller with the full
   *     student roster to fill in)
   */
  syncAttendanceForDate(date: string): AttendanceRecord[] {
    const scansForDate = store.scans.filter((s) => s.scanTime.startsWith(date));

    const scansByStudent = new Map<string, ScanEvent[]>();
    for (const scan of scansForDate) {
      const list = scansByStudent.get(scan.studentId) ?? [];
      list.push(scan);
      scansByStudent.set(scan.studentId, list);
    }

    const results: AttendanceRecord[] = [];

    for (const [studentId, scans] of scansByStudent.entries()) {
      const boardingScan = scans
        .filter((s) => s.scanType === "BOARDING")
        .sort((a, b) => a.scanTime.localeCompare(b.scanTime))[0];
      const dropScan = scans
        .filter((s) => s.scanType === "DROP")
        .sort((a, b) => a.scanTime.localeCompare(b.scanTime))[0];

      let status: AttendanceStatus;
      if (boardingScan && dropScan) {
        status = "PRESENT";
      } else if (boardingScan || dropScan) {
        status = "PARTIAL";
      } else {
        status = "ABSENT";
      }

      const key = `${studentId}_${date}`;
      const record: AttendanceRecord = {
        attendanceId: store.attendance.get(key)?.attendanceId ?? uuid(),
        studentId,
        date,
        boardingScan,
        dropScan,
        status,
        syncedAt: new Date().toISOString(),
      };

      store.attendance.set(key, record);
      results.push(record);
    }

    return results;
  }

  getAttendanceForDate(date: string): AttendanceRecord[] {
    return [...store.attendance.values()].filter((a) => a.date === date);
  }

  getAttendanceForStudent(studentId: string): AttendanceRecord[] {
    return [...store.attendance.values()].filter((a) => a.studentId === studentId);
  }
}

export const attendanceSyncService = new AttendanceSyncService();

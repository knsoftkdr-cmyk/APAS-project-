/**
 * Domain types for the RFID Attendance module.
 * These are intentionally plain interfaces - no ORM / DB decorators -
 * since this module has no external connections yet.
 */

export interface RfidCard {
  cardId: string;        // UUID generated when the card is assigned
  rfidTagNumber: string; // Physical RFID tag/chip number printed on the card
  studentId: string;
  studentName: string;
  classSection: string;
  assignedOn: string;    // ISO timestamp
  status: "ACTIVE" | "INACTIVE" | "LOST";
}

export type ScanType = "BOARDING" | "DROP";

export interface ScanEvent {
  scanId: string;
  rfidTagNumber: string;
  studentId: string;
  scanType: ScanType;
  scanTime: string;       // ISO timestamp
  vehicleOrGate: string;  // Bus number / school gate identifier
}

export type AttendanceStatus = "PRESENT" | "ABSENT" | "PARTIAL";

export interface AttendanceRecord {
  attendanceId: string;
  studentId: string;
  date: string;            // YYYY-MM-DD
  boardingScan?: ScanEvent;
  dropScan?: ScanEvent;
  status: AttendanceStatus;
  syncedAt: string;        // ISO timestamp of when synchronization was run
}

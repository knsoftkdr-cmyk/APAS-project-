import { RfidCard, ScanEvent, AttendanceRecord } from "../models/types";

/**
 * In-memory store.
 *
 * This module is deliberately NOT wired up to any database, message
 * queue, or external service. It only holds data in process memory so
 * the module can be developed and tested in isolation. Swap this file
 * out for a real repository (Postgres/Supabase/etc.) later without
 * touching the services/controllers above it.
 */
class InMemoryStore {
  public cards: Map<string, RfidCard> = new Map();          // key: rfidTagNumber
  public scans: ScanEvent[] = [];
  public attendance: Map<string, AttendanceRecord> = new Map(); // key: `${studentId}_${date}`
}

export const store = new InMemoryStore();

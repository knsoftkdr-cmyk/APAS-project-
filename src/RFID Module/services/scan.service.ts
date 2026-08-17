import { v4 as uuid } from "uuid";
import { store } from "../data/store";
import { ScanEvent, ScanType } from "../models/types";
import { cardAssignmentService } from "./cardAssignment.service";

export interface RecordScanInput {
  rfidTagNumber: string;
  vehicleOrGate: string;
  scanTime?: string; // defaults to now; accepted so a scanner device can send its own timestamp
}

class ScanService {
  private recordScan(input: RecordScanInput, scanType: ScanType): ScanEvent {
    const card = cardAssignmentService.getCardByTag(input.rfidTagNumber);
    if (!card) {
      throw new Error(`Unrecognized or inactive RFID tag: ${input.rfidTagNumber}`);
    }

    const event: ScanEvent = {
      scanId: uuid(),
      rfidTagNumber: input.rfidTagNumber,
      studentId: card.studentId,
      scanType,
      scanTime: input.scanTime ?? new Date().toISOString(),
      vehicleOrGate: input.vehicleOrGate,
    };

    store.scans.push(event);
    return event;
  }

  /** Record a student boarding the bus / entering the school gate. */
  recordBoardingScan(input: RecordScanInput): ScanEvent {
    return this.recordScan(input, "BOARDING");
  }

  /** Record a student dropping off the bus / exiting the school gate. */
  recordDropScan(input: RecordScanInput): ScanEvent {
    return this.recordScan(input, "DROP");
  }

  getScansForStudent(studentId: string): ScanEvent[] {
    return store.scans.filter((s) => s.studentId === studentId);
  }

  getScansForDate(date: string): ScanEvent[] {
    return store.scans.filter((s) => s.scanTime.startsWith(date));
  }
}

export const scanService = new ScanService();

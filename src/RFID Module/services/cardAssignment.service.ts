import { v4 as uuid } from "uuid";
import { store } from "../data/store";
import { RfidCard } from "../models/types";

export interface AssignCardInput {
  rfidTagNumber: string;
  studentId: string;
  studentName: string;
  classSection: string;
}

export class CardAssignmentService {
  /** Assign a new RFID card to a student, or re-activate an existing tag. */
  assignCard(input: AssignCardInput): RfidCard {
    const { rfidTagNumber, studentId, studentName, classSection } = input;

    if (!rfidTagNumber || !studentId) {
      throw new Error("rfidTagNumber and studentId are required");
    }

    const existing = store.cards.get(rfidTagNumber);
    if (existing && existing.status === "ACTIVE" && existing.studentId !== studentId) {
      throw new Error(
        `RFID tag ${rfidTagNumber} is already assigned to another active student (${existing.studentId})`
      );
    }

    const card: RfidCard = {
      cardId: existing?.cardId ?? uuid(),
      rfidTagNumber,
      studentId,
      studentName,
      classSection,
      assignedOn: new Date().toISOString(),
      status: "ACTIVE",
    };

    store.cards.set(rfidTagNumber, card);
    return card;
  }

  /** Mark a card as lost/inactive so it can no longer be used for scans. */
  deactivateCard(rfidTagNumber: string, status: "INACTIVE" | "LOST" = "INACTIVE"): RfidCard {
    const card = store.cards.get(rfidTagNumber);
    if (!card) {
      throw new Error(`No card found for tag ${rfidTagNumber}`);
    }
    card.status = status;
    store.cards.set(rfidTagNumber, card);
    return card;
  }

  getCardByTag(rfidTagNumber: string): RfidCard | undefined {
    return store.cards.get(rfidTagNumber);
  }

  getCardByStudent(studentId: string): RfidCard | undefined {
    return [...store.cards.values()].find(
      (c) => c.studentId === studentId && c.status === "ACTIVE"
    );
  }

  listCards(): RfidCard[] {
    return [...store.cards.values()];
  }
}

export const cardAssignmentService = new CardAssignmentService();

import { Request, Response } from "express";
import { cardAssignmentService } from "../services/cardAssignment.service";

export const assignCard = (req: Request, res: Response): void => {
  try {
    const card = cardAssignmentService.assignCard(req.body);
    res.status(201).json({ success: true, data: card });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deactivateCard = (req: Request, res: Response): void => {
  try {
    const { rfidTagNumber } = req.params;
    const { status } = req.body; // "INACTIVE" | "LOST"
    const card = cardAssignmentService.deactivateCard(rfidTagNumber, status);
    res.status(200).json({ success: true, data: card });
  } catch (err: any) {
    res.status(404).json({ success: false, message: err.message });
  }
};

export const getCardByTag = (req: Request, res: Response): void => {
  const card = cardAssignmentService.getCardByTag(req.params.rfidTagNumber);
  if (!card) {
    res.status(404).json({ success: false, message: "Card not found" });
    return;
  }
  res.status(200).json({ success: true, data: card });
};

export const getCardByStudent = (req: Request, res: Response): void => {
  const card = cardAssignmentService.getCardByStudent(req.params.studentId);
  if (!card) {
    res.status(404).json({ success: false, message: "No active card for this student" });
    return;
  }
  res.status(200).json({ success: true, data: card });
};

export const listCards = (_req: Request, res: Response): void => {
  res.status(200).json({ success: true, data: cardAssignmentService.listCards() });
};

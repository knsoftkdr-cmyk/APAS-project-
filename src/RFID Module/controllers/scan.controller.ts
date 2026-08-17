import { Request, Response } from "express";
import { scanService } from "../services/scan.service";

export const boardingScan = (req: Request, res: Response): void => {
  try {
    const event = scanService.recordBoardingScan(req.body);
    res.status(201).json({ success: true, data: event });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const dropScan = (req: Request, res: Response): void => {
  try {
    const event = scanService.recordDropScan(req.body);
    res.status(201).json({ success: true, data: event });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getScansForStudent = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: scanService.getScansForStudent(req.params.studentId),
  });
};

export const getScansForDate = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: scanService.getScansForDate(req.params.date),
  });
};

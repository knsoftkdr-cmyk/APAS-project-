import { Request, Response } from "express";
import { attendanceSyncService } from "../services/attendanceSync.service";

export const syncAttendance = (req: Request, res: Response): void => {
  try {
    const { date } = req.body; // "YYYY-MM-DD"
    if (!date) {
      res.status(400).json({ success: false, message: "date (YYYY-MM-DD) is required" });
      return;
    }
    const records = attendanceSyncService.syncAttendanceForDate(date);
    res.status(200).json({ success: true, data: records });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getAttendanceForDate = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: attendanceSyncService.getAttendanceForDate(req.params.date),
  });
};

export const getAttendanceForStudent = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: attendanceSyncService.getAttendanceForStudent(req.params.studentId),
  });
};

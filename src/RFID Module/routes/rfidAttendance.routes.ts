import { Router } from "express";
import * as cardController from "../controllers/cardAssignment.controller";
import * as scanController from "../controllers/scan.controller";
import * as syncController from "../controllers/attendanceSync.controller";

const router = Router();

// --- RFID Card Assignment ---
router.post("/cards", cardController.assignCard);
router.patch("/cards/:rfidTagNumber/deactivate", cardController.deactivateCard);
router.get("/cards", cardController.listCards);
router.get("/cards/tag/:rfidTagNumber", cardController.getCardByTag);
router.get("/cards/student/:studentId", cardController.getCardByStudent);

// --- Boarding Scan ---
router.post("/scans/boarding", scanController.boardingScan);

// --- Drop Scan ---
router.post("/scans/drop", scanController.dropScan);

// --- Scan history ---
router.get("/scans/student/:studentId", scanController.getScansForStudent);
router.get("/scans/date/:date", scanController.getScansForDate);

// --- Attendance Synchronization ---
router.post("/attendance/sync", syncController.syncAttendance);
router.get("/attendance/date/:date", syncController.getAttendanceForDate);
router.get("/attendance/student/:studentId", syncController.getAttendanceForStudent);

export default router;

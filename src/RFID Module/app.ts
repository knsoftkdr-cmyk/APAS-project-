import express, { Application } from "express";
import rfidAttendanceRoutes from "./routes/rfidAttendance.routes";

export const createApp = (): Application => {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", module: "rfid-attendance" });
  });

  // All module routes are namespaced under /api/rfid-attendance
  app.use("/api/rfid-attendance", rfidAttendanceRoutes);

  return app;
};

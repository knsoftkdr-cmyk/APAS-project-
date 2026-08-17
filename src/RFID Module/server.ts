import { createApp } from "./app";

const PORT = process.env.PORT ?? 4000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`RFID Attendance module running standalone on port ${PORT}`);
});

import express, { Request, Response } from "express";
import { collectDefaultMetrics, register } from "prom-client";
import pool from "./db";

const app = express();
const port = 3000;

collectDefaultMetrics();

app.get("/", (_req: Request, res: Response) => {
  res.send("Hello world");
});

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1"); // checks DB is reachable too
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err: any) {
    res.status(500).json({ status: "error", db: err.message });
  }
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

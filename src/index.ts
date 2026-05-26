import express, { Request, Response } from "express";
import { collectDefaultMetrics, register } from "prom-client";

const app = express();
const port = 3000;

collectDefaultMetrics();

app.get("/", (_req: Request, res: Response) => {
  res.send("Hello world");
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

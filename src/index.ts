import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import securityMiddleware from "./middleware/security";
import requestLogger from "./middleware/requestLogger";
import rateLimiter from "./middleware/rateLimiter";
import identifyRoutes from "./routes/identify";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// --- Security middleware stack (in order) ---
// 1. Helmet, CORS, HPP, Body parser (bundled in security middleware)
app.use(securityMiddleware);

// 2. Request logging
app.use(requestLogger);

// 3. Rate limiting
app.use(rateLimiter);

// --- Routes ---
app.use("/", identifyRoutes);

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "BiteSpeed Identity Reconciliation" });
});

// --- Global error handler ---
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[ERROR]", err);

  // Handle JSON parse errors (malformed body)
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON in request body" });
    return;
  }

  // Handle payload too large
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;

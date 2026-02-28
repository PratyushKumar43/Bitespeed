import helmet from "helmet";
import cors, { CorsOptions } from "cors";
import hpp from "hpp";
import express from "express";
import { Router } from "express";

const securityMiddleware = Router();

// Helmet — HTTP security headers
securityMiddleware.use(helmet());

// CORS configuration
const corsOptions: CorsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? process.env.CORS_ORIGIN?.split(",")
      : "*",
  methods: ["POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
};
securityMiddleware.use(cors(corsOptions));

// HPP — HTTP Parameter Pollution protection
securityMiddleware.use(hpp());

// JSON body parser with 10KB payload limit
securityMiddleware.use(express.json({ limit: "10kb" }));

export default securityMiddleware;

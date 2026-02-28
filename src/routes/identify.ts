import { Router } from "express";
import { handleIdentify } from "../controllers/identifyController";
import {
  identifyValidationRules,
  handleValidationErrors,
} from "../middleware/validator";

const router = Router();

router.post("/identify", identifyValidationRules, handleValidationErrors, handleIdentify);

export default router;

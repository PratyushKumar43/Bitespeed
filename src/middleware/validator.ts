import { body, validationResult } from "express-validator";
import { Request, Response, NextFunction } from "express";

export const identifyValidationRules = [
  body("email")
    .optional({ values: "null" })
    .isEmail()
    .withMessage("Must be a valid email address")
    .normalizeEmail()
    .trim()
    .escape(),

  body("phoneNumber")
    .optional({ values: "null" })
    .isString()
    .withMessage("Must be a string")
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage("Must be between 1 and 20 characters")
    .matches(/^\d+$/)
    .withMessage("Must contain only digits"),
];

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(422).json({
      errors: errors.array().map((err) => ({
        field: "param" in err ? err.param : "unknown",
        message: err.msg,
      })),
    });
    return;
  }

  // At least one of email or phoneNumber must be provided
  const { email, phoneNumber } = req.body;
  if (!email && !phoneNumber) {
    res.status(400).json({ error: "email or phoneNumber is required" });
    return;
  }

  next();
};

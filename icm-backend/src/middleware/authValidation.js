import { body, validationResult } from "express-validator";

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const mapped = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
    }));
    const firstMessage = mapped[0]?.message || "Validation failed";
    return res.status(400).json({
      success: false,
      message: firstMessage,
      error: {
        code: "VALIDATION_FAILED",
        message: firstMessage,
      },
      errors: mapped,
    });
  }
  next();
};

export const validateRegister = [
  body("firstName")
    .trim()
    .notEmpty()
    .withMessage("First name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters"),
  body("lastName")
    .trim()
    .notEmpty()
    .withMessage("Last name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters"),
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail()
    .toLowerCase(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number",
    ),
  body("role")
    .optional()
    .isIn([
      "admin",
      "superAdmin",
      "certAdmin",
      "sodAdmin",
      "manager",
      "viewer",
      "auditAnalytics",
    ])
    .withMessage("Invalid role"),
  body("department")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .escape()
    .customSanitizer((v) => (v === "" ? null : v)),
  body("phoneNumber")
    .optional()
    .custom((v) => {
      if (!v) return true;
      if (!/^\+?[1-9]\d{1,14}$/.test(v))
        throw new Error("Invalid phone number");
      return true;
    }),
  handleValidationErrors,
];

export const validateLogin = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email or User ID is required")
    .isLength({ max: 254 })
    .withMessage("Email or User ID is too long")
    .toLowerCase(),
  body("password").notEmpty().withMessage("Password is required"),
  handleValidationErrors,
];

export const validateChangePassword = [
  body("oldPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "New password must contain at least one uppercase letter, one lowercase letter, and one number",
    ),
  handleValidationErrors,
];

export const validateUpdateProfile = [
  body("firstName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("First name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters"),
  body("lastName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Last name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters"),
  body("department")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 100 })
    .withMessage("Department must be at most 100 characters"),
  body("phoneNumber")
    .optional({ values: "falsy" })
    .customSanitizer((v) => String(v || "").replace(/[\s()-]/g, ""))
    .custom((v) => {
      if (!v) return true;
      if (!/^\+?[1-9]\d{7,14}$/.test(v)) {
        throw new Error("Invalid phone number");
      }
      return true;
    }),
  handleValidationErrors,
];

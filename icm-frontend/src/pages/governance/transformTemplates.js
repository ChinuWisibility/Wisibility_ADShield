/** Predefined JSON transform templates for the editor. */

export const TRANSFORM_TEMPLATES = [
  {
    id: "email-lower-concat",
    label: "Email (lower + concat)",
    description: "Lowercase email built from fn, dot, ln",
    json: {
      type: "lower",
      attributes: {
        input: {
          type: "concat",
          attributes: {
            values: ["fn", ".", "ln", "@", "example.com"],
          },
        },
      },
    },
  },
  {
    id: "display-name",
    label: "Display name",
    description: "Concatenate first and last with space",
    json: {
      type: "concat",
      attributes: {
        values: ["fn", " ", "ln"],
      },
    },
  },
  {
    id: "first-valid-email",
    label: "First valid email",
    description: "Pick first non-empty email field",
    json: {
      type: "firstValid",
      attributes: {
        candidates: ["workEmail", "personalEmail", "email"],
      },
    },
  },
  {
    id: "department-lookup",
    label: "Department label",
    description: "Map code to display name",
    json: {
      type: "lookup",
      attributes: {
        input: "departmentCode",
        map: {
          IT: "Information Technology",
          HR: "Human Resources",
        },
        default: "Unknown",
      },
    },
  },
];

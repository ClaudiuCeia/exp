const UNKNOWN_THROWN_VALUE_MESSAGE = "unknown thrown value";

/** Describe a thrown value without invoking object accessors or coercion hooks. */
export const describeThrownValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint") return `${value}`;
  if (typeof value === "string") return value;
  if (typeof value === "symbol") return UNKNOWN_THROWN_VALUE_MESSAGE;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "message");
    if (
      descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
    ) {
      return descriptor.value;
    }
  } catch {
    return UNKNOWN_THROWN_VALUE_MESSAGE;
  }

  return UNKNOWN_THROWN_VALUE_MESSAGE;
};

/**
 * Converts a hexadecimal string to a base64-encoded string.
 * @param {string} hex - The hexadecimal string to convert.
 * @returns {string} The base64-encoded string representation of the input.
 */
export function h2b(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

/**
 * Converts a base64-encoded string to a hexadecimal string.
 * @param {string} base64 - The base64-encoded string to convert.
 * @returns {string} The hexadecimal string representation of the input.
 */
export function b2h(base64: string): string {
  return Buffer.from(base64, "base64").toString("hex");
}

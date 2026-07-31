import { C402Error } from "./errors.js";

export function encodeHeaderJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeHeaderJson<T>(value: string | null | undefined, headerName: string): T {
  if (!value) {
    throw new C402Error("missing_header", `${headerName} header is required`, 400);
  }

  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch (error) {
    throw new C402Error("invalid_header", `${headerName} is not valid base64url JSON`, 400, { cause: String(error) });
  }
}

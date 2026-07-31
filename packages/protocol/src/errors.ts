export class C402Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "C402Error";
  }
}

export function assertC402(condition: unknown, code: string, message: string, status = 400): asserts condition {
  if (!condition) {
    throw new C402Error(code, message, status);
  }
}

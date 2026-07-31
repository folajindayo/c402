export type RequestState =
  | "quoted"
  | "payment_authorized"
  | "submitted_to_tee"
  | "executed"
  | "receipt_verified"
  | "settled"
  | "delivered"
  | "failed";

const allowedTransitions: Record<RequestState, RequestState[]> = {
  quoted: ["payment_authorized", "failed"],
  payment_authorized: ["submitted_to_tee", "failed"],
  submitted_to_tee: ["executed", "failed"],
  executed: ["receipt_verified", "failed"],
  receipt_verified: ["settled", "failed"],
  settled: ["delivered", "failed"],
  delivered: ["delivered"],
  failed: ["failed"]
};

export interface RequestRecord {
  requestId: string;
  state: RequestState;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
  requirementHash?: string;
  paymentId?: string;
  receipt?: unknown;
  encryptedResult?: unknown;
}

export class RequestStore {
  private readonly records = new Map<string, RequestRecord>();

  create(requestId: string, requirementHash: string): RequestRecord {
    const now = new Date().toISOString();
    const record: RequestRecord = { requestId, state: "quoted", createdAt: now, updatedAt: now, requirementHash };
    this.records.set(requestId, record);
    return record;
  }

  get(requestId: string): RequestRecord | undefined {
    return this.records.get(requestId);
  }

  list(): RequestRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  transition(requestId: string, next: RequestState, patch: Partial<RequestRecord> = {}): RequestRecord {
    const record = this.records.get(requestId);
    if (!record) {
      throw new Error(`unknown request ${requestId}`);
    }
    if (!allowedTransitions[record.state].includes(next)) {
      throw new Error(`invalid state transition ${record.state} -> ${next}`);
    }
    const updated = {
      ...record,
      ...patch,
      state: next,
      updatedAt: new Date().toISOString()
    };
    this.records.set(requestId, updated);
    return updated;
  }
}

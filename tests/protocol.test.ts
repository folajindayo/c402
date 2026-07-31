import test from "node:test";
import assert from "node:assert/strict";
import {
  commitment,
  decryptJson,
  encodeHeaderJson,
  decodeHeaderJson,
  encryptJson,
  envelopeCommitment,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  objectWithoutSignature,
  signObject,
  verifyObjectSignature,
  type ComputeReceipt
} from "@c402/protocol";

test("canonical commitments are stable across object key order", () => {
  assert.equal(commitment({ b: 2, a: 1 }), commitment({ a: 1, b: 2 }));
});

test("header JSON round trips", () => {
  const encoded = encodeHeaderJson({ hello: "world" });
  assert.deepEqual(decodeHeaderJson(encoded, "X-TEST"), { hello: "world" });
});

test("hybrid encryption handles statement-sized payloads", () => {
  const keys = generateEncryptionKeyPair();
  const value = { transactions: Array.from({ length: 50 }, (_, index) => ({ index, amountCents: index * 100 })) };
  const envelope = encryptJson(keys.publicKey, value);
  assert.equal(envelope.algorithm, "RSA-OAEP-256+A256GCM");
  assert.equal(envelopeCommitment(envelope), commitment(envelope));
  assert.deepEqual(decryptJson(keys.privateKey, envelope), value);
});

test("receipt signatures reject tampering", () => {
  const keys = generateSigningKeyPair();
  const unsigned = {
    protocol: "c402",
    version: 1,
    requestId: "req",
    paymentId: "pay",
    inputCommitment: "0xin",
    outputCommitment: "0xout",
    codeHash: "0xcode",
    teeId: "tee",
    extensionId: "ext",
    outputSchema: "credit-score-v1",
    status: "success",
    priceAtomic: "100000",
    timestamp: 1
  } satisfies Omit<ComputeReceipt, "signature">;
  const receipt = { ...unsigned, signature: signObject(keys.privateKey, unsigned) };
  assert.equal(verifyObjectSignature(keys.publicKey, objectWithoutSignature(receipt), receipt.signature), true);
  assert.equal(verifyObjectSignature(keys.publicKey, { ...objectWithoutSignature(receipt), status: "failed" }, receipt.signature), false);
});

import {
  createPrivateKey,
  createPublicKey,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  privateDecrypt,
  publicEncrypt,
  sign,
  timingSafeEqual,
  verify,
  createHmac
} from "node:crypto";
import { canonicalJson, commitment } from "./canonical.js";
import type { EncryptedEnvelope } from "./types.js";

export interface RsaKeyPairPem {
  publicKey: string;
  privateKey: string;
}

export interface Ed25519KeyPairPem {
  publicKey: string;
  privateKey: string;
}

export function randomHex(bytes = 16): string {
  return `0x${randomBytes(bytes).toString("hex")}`;
}

export function generateEncryptionKeyPair(): RsaKeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  return { publicKey, privateKey };
}

export function generateSigningKeyPair(): Ed25519KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  return { publicKey, privateKey };
}

export function encryptJson(publicKeyPem: string, value: unknown): EncryptedEnvelope {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(canonicalJson(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(
    {
      key: createPublicKey(publicKeyPem),
      oaepHash: "sha256"
    },
    key
  );
  return {
    algorithm: "RSA-OAEP-256+A256GCM",
    encryptedKey: encryptedKey.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

export function decryptJson<T>(privateKeyPem: string, envelope: EncryptedEnvelope): T {
  const key = privateDecrypt(
    {
      key: createPrivateKey(privateKeyPem),
      oaepHash: "sha256"
    },
    Buffer.from(envelope.encryptedKey, "base64url")
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function signObject(privateKeyPem: string, value: unknown): string {
  return sign(null, Buffer.from(canonicalJson(value), "utf8"), createPrivateKey(privateKeyPem)).toString("base64url");
}

export function verifyObjectSignature(publicKeyPem: string, value: unknown, signature: string): boolean {
  return verify(
    null,
    Buffer.from(canonicalJson(value), "utf8"),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, "base64url")
  );
}

export function objectWithoutSignature<T extends { signature?: string }>(value: T): Omit<T, "signature"> {
  const { signature: _signature, ...unsigned } = value;
  return unsigned;
}

export function hmacSignature(secret: string, value: unknown): string {
  return createHmac("sha256", secret).update(canonicalJson(value)).digest("base64url");
}

export function verifyHmac(secret: string, value: unknown, expected: string): boolean {
  const actual = Buffer.from(hmacSignature(secret, value), "base64url");
  const candidate = Buffer.from(expected, "base64url");
  return actual.length === candidate.length && timingSafeEqual(actual, candidate);
}

export function envelopeCommitment(envelope: EncryptedEnvelope): string {
  return commitment(envelope);
}

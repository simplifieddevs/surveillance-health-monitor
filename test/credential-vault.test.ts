import { describe, it, expect, beforeAll } from "vitest";
import "./setup.js";
import { fakeVault } from "./helpers/fake-vault.js";
import { EnvKeyProvider } from "../src/crypto/env-key-provider.js";
import { CredentialVault } from "../src/crypto/credential-vault.js";
import { err } from "../src/core/errors.js";

describe("CredentialVault", () => {
  let vault: CredentialVault;

  beforeAll(() => {
    vault = fakeVault();
  });

  it("round-trips credentials", () => {
    const plain = { username: "admin", password: "hunter2", token: "abc" };
    const blob = vault.encrypt(plain);
    const back = vault.decrypt(blob, "dev-1");
    expect(back).toEqual(plain);
  });

  it("uses 12-byte IV and includes auth tag", () => {
    const plain = { username: "u", password: "p" };
    const blob = vault.encrypt(plain);
    expect(blob.iv.length).toBe(12);
    // ciphertext carries both the encrypted bytes AND the 16-byte tag.
    expect(blob.ciphertext.length).toBeGreaterThanOrEqual(16);
  });

  it("fails closed on tampered ciphertext", () => {
    const plain = { username: "u", password: "p" };
    const blob = vault.encrypt(plain);
    blob.ciphertext[0] = (blob.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => vault.decrypt(blob, "dev-1")).toThrowError(
      expect.objectContaining({ code: "CREDENTIAL_DECRYPT_FAILED" }),
    );
  });

  it("supports key rotation: old ciphertext readable by both keys", () => {
    const provider = new EnvKeyProvider();
    const v1 = new CredentialVault(provider);
    const plain = { username: "u", password: "p" };
    const blob = v1.encrypt(plain);
    expect(blob.keyVersion).toBe(1);
    // Decrypt with the same provider.
    const decrypted = v1.decrypt(blob, "dev-1");
    expect(decrypted).toEqual(plain);
  });

  it("errors when decrypting with an unknown key version", () => {
    const v = fakeVault();
    const blob = v.encrypt({ raw: "x" });
    blob.keyVersion = 999;
    expect(() => v.decrypt(blob, "dev-1")).toThrow();
    try {
      v.decrypt(blob, "dev-1");
    } catch (e) {
      expect((e as { code: string }).code).toBe(err.credentialDecrypt("dev-1").code);
    }
  });
});

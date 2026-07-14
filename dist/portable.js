import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const FORMAT = "pathmark-encrypted-v1";
export async function encryptPortableExport(plaintext, passphrase) {
    if (!passphrase)
        throw new Error("PATHMARK_EXPORT_KEY is required for encrypted export");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = (await scrypt(passphrase, salt, 32));
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const envelope = {
        format: FORMAT,
        kdf: "scrypt",
        cipher: "aes-256-gcm",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
    };
    return `${JSON.stringify(envelope)}\n`;
}
export async function decryptPortableExport(input, passphrase) {
    const envelope = parseEnvelope(input);
    if (!envelope)
        return input;
    if (!passphrase)
        throw new Error("PATHMARK_EXPORT_KEY is required to import this encrypted Pathmark export");
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const key = (await scrypt(passphrase, salt, 32));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function parseEnvelope(input) {
    try {
        const value = JSON.parse(input);
        if (value.format !== FORMAT ||
            value.kdf !== "scrypt" ||
            value.cipher !== "aes-256-gcm" ||
            typeof value.salt !== "string" ||
            typeof value.iv !== "string" ||
            typeof value.tag !== "string" ||
            typeof value.ciphertext !== "string") {
            return undefined;
        }
        return value;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=portable.js.map
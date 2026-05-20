import { randomBytes } from "./random-bytes.js";
import { createHash } from "./create-hash.js";
import { scrypt } from "./scrypt.js";
import { randomUUID } from "./random-uuid.js";

export const cryptoShim = {
  randomBytes,
  createHash,
  scrypt,
  randomUUID,
};

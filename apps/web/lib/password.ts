import type { Options } from '@node-rs/argon2';

/**
 * Pinned argon2 parameters shared by every hash/verify site so stored hashes
 * stay consistent. These are the OWASP Password Storage Cheat Sheet baseline
 * for argon2id: 19 MiB memory, 2 iterations, 1 lane.
 */
export const ARGON2_OPTIONS: Options = {
  // Algorithm.Argon2id — it's an ambient const enum, which isolatedModules
  // forbids importing as a value, so use its numeric value directly.
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

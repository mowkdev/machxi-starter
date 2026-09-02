import { defaultArgon2Params, type Argon2Params } from "@repo/crypto";

import { readInt } from "./env.js";

/**
 * The `ARGON2_*` variables, defaulted from `@repo/crypto` so the seeder hashes
 * with exactly the parameters the API verifies against (ADR-0008). Values
 * below the OWASP floor are rejected by `createArgon2Hasher`, not here — one
 * check, in the package that owns the algorithm.
 *
 * **A file of its own since `D14.3`, and only because of what it imports.**
 * `@repo/crypto` pulls in `argon2`, a native CJS addon whose `.node` binary no
 * bundler can inline. While this lived in `tooling/env.ts` — which
 * `src/migrate.ts` reads for the connection string and the migrations folder —
 * the bundled `dist/migrate.js` (ADR-0059 §5) carried `import "argon2"` as a
 * side-effect import that survived tree-shaking, so a migration runner that
 * hashes nothing could not start unless the addon happened to be resolvable
 * beside it. Splitting the import out is what makes that bundle self-contained.
 * Nothing else about the seed path changed.
 */
export const readArgon2Params = (): Argon2Params => ({
  memoryKib: readInt("ARGON2_MEMORY_KIB", defaultArgon2Params.memoryKib),
  timeCost: readInt("ARGON2_TIME_COST", defaultArgon2Params.timeCost),
  parallelism: readInt("ARGON2_PARALLELISM", defaultArgon2Params.parallelism),
});

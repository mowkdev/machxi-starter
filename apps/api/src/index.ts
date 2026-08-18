import { createLogger } from "@repo/logger";
import { createServer } from "./server.js";

// TODO(step 7): replaced by main.ts/app.ts with the validated config (ADR-0004)
// and the pino-http + context middleware chain (ADR-0005, ADR-0010, ADR-0011).
const port = process.env.PORT ?? 4000;
const logger = createLogger({ level: "info", name: "api" });
const server = createServer();

server.listen(port, () => {
  logger.info({ port }, "api listening");
});

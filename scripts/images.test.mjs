import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The reference images' configuration, read as files (ADR-0059 §4, ADR-0078
// §5). The images themselves are built by `docker compose` on the operator's
// machine; what can be proved without Docker is proved here.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SPAS = ["admin", "customer"];

/** Every `listen` directive's arguments, comments stripped, as nginx reads them. */
export function listenDirectives(conf) {
  const code = conf
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
  return [...code.matchAll(/(?:^|[\s;{}])listen\s+([^;]*);/g)].map((m) =>
    m[1].trim().split(/\s+/),
  );
}

/** Whether a `listen`'s arguments ask nginx for an IPv6 socket. */
export function requiresIpv6(args) {
  const [address] = args;
  return (
    address.startsWith("[") || args.some((arg) => arg.startsWith("ipv6only="))
  );
}

test("the listen reader sees what nginx binds, and not what a comment says", () => {
  const conf = [
    "server {",
    "    # listen [::]:8080;",
    "    listen 8080;",
    "    listen [::]:8080 ipv6only=off;",
    "    listen 127.0.0.1:8081 default_server;",
    "}",
  ].join("\n");
  const found = listenDirectives(conf);
  assert.deepEqual(found, [
    ["8080"],
    ["[::]:8080", "ipv6only=off"],
    ["127.0.0.1:8081", "default_server"],
  ]);
  assert.deepEqual(found.map(requiresIpv6), [false, true, false]);
});

test("neither SPA's nginx.conf requires an IPv6 socket", async () => {
  // A `listen [::]` stops nginx on a kernel without IPv6: `nginx -t` in the
  // Dockerfile's runtime stage fails the build, and nginx fails at start, with
  // `Address family not supported by protocol` (D29's notes, D36.4). The stock
  // image's entrypoint adds the IPv6 listener only when the kernel has IPv6,
  // and only to its own default config, which these files replace.
  for (const app of SPAS) {
    const conf = await readFile(
      path.join(repoRoot, "apps", app, "nginx.conf"),
      "utf8",
    );
    const listens = listenDirectives(conf);
    assert.ok(listens.length > 0, `apps/${app}/nginx.conf listens nowhere`);
    assert.deepEqual(
      listens.filter(requiresIpv6).map((args) => args.join(" ")),
      [],
      `apps/${app}/nginx.conf requires an IPv6 socket`,
    );
  }
});

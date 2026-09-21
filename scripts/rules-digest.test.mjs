import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AREAS,
  generate,
  readRecords,
  renderArea,
  successorsOf,
  uncitedRecords,
} from "./rules-digest.mjs";

test("the committed digests are what the generator produces", async () => {
  const results = await generate({ check: true });
  assert.deepEqual(
    results.filter((r) => r.changed).map((r) => r.slug),
    [],
    "run `node scripts/rules-digest.mjs`",
  );
});

test("there is a digest per area, and each cites at least one record", () => {
  assert.deepEqual(
    AREAS.map((a) => a.slug),
    ["api-and-data", "frontend-and-platform", "process"],
  );
  for (const area of AREAS) {
    assert.ok(area.rules.length > 0, area.slug);
    for (const rule of area.rules) {
      assert.ok(rule.records.length > 0, `${area.slug}: ${rule.topic}`);
    }
  }
});

test("every cited record exists and is in force", async () => {
  const records = await readRecords();
  for (const area of AREAS) {
    // renderArea throws on a record that is missing or wholly superseded.
    assert.doesNotThrow(() => renderArea(area, records), area.slug);
  }
});

test("a digest that cites a wholly superseded record fails to render", async () => {
  const records = await readRecords();
  const wholly = Object.values(records).find((r) => r.superseded && !r.delta);
  assert.ok(
    wholly,
    "the corpus has at least one whole supersession to test against",
  );
  const area = {
    slug: "spec",
    title: "Spec",
    loadWhen: "nothing",
    rules: [{ topic: "Out of force", records: [wholly.id], text: "…" }],
  };
  assert.throws(() => renderArea(area, records), /wholly superseded/);
});

test("a delta-superseded parent renders as carried by its successor", async () => {
  const records = await readRecords();
  const delta = Object.values(records).find((r) => r.delta);
  assert.ok(delta);
  const area = {
    slug: "spec",
    title: "Spec",
    loadWhen: "nothing",
    rules: [{ topic: "Still standing", records: [delta.id], text: "…" }],
  };
  assert.match(renderArea(area, records), /as carried by \[ADR-\d{4}\]/);
});

test("a record named inside a delta note is not read as a successor", () => {
  // ADR-0050's own status line names the parent whose reasoning it restores.
  // A bare match would print that parent as a carrier and reverse the
  // supersession.
  const status =
    "superseded by [ADR-0065](0065-starter-lifecycle.md) (delta: rule 5 regains the reason ADR-0024 gave it)";
  assert.deepEqual(successorsOf(status), ["0065"]);
});

test("every superseded record is carried by a later record", async () => {
  const records = await readRecords();
  for (const record of Object.values(records)) {
    if (!record.superseded) continue;
    assert.ok(
      record.successors.length > 0,
      `ADR-${record.id}: no successor parsed`,
    );
    for (const successor of record.successors) {
      assert.ok(
        Number(successor) > Number(record.id),
        `ADR-${record.id} is carried by ADR-${successor}, which is older than it`,
      );
    }
  }
});

test("a rule whose records the corpus does not hold renders no line", () => {
  // `/bootstrap --empty` empties `docs/adr/`; the digests start empty with it
  // rather than citing records the fork has never had.
  for (const area of AREAS) {
    const rendered = renderArea(area, {});
    const bullets = rendered
      .split(/\r?\n/)
      .filter((line) => line.startsWith("- **"));
    assert.deepEqual(
      bullets,
      [],
      `${area.slug} rendered a rule line from an empty corpus`,
    );
  }
});

test("every accepted record is the primary citation of a line", async () => {
  const records = await readRecords();
  assert.deepEqual(
    uncitedRecords(AREAS, records),
    [],
    "add a rule line naming each record in scripts/rules-digest.mjs",
  );

  // Red with one record's lines removed: take an accepted record out of every
  // line's `records`, and the check names it and the generator refuses.
  const victim = Object.values(records).find(
    (r) => /^accepted\b/i.test(r.status) && !r.superseded,
  );
  assert.ok(victim, "the corpus has an accepted record to remove");
  const stripped = AREAS.map((area) => ({
    ...area,
    rules: area.rules
      .map((rule) => ({
        ...rule,
        records: rule.records.filter((id) => id !== victim.id),
      }))
      .filter((rule) => rule.records.length > 0),
  }));
  assert.deepEqual(uncitedRecords(stripped, records), [victim.id]);
  await assert.rejects(
    generate({ check: true, areas: stripped }),
    new RegExp(`ADR-${victim.id}`),
  );
});

test("a record cited only as a carrier is not cited as its own", () => {
  // The suffix `as carried by` is rendered from the parent's status line, not
  // from a line's `records`, so a successor named only there stays uncited.
  const records = {
    "0001": { id: "0001", status: "superseded by [ADR-0002](x) (delta)" },
    "0002": { id: "0002", status: "accepted" },
    "0003": { id: "0003", status: "proposed" },
  };
  const areas = [{ rules: [{ records: ["0001"] }] }];
  assert.deepEqual(uncitedRecords(areas, records), ["0002"]);
});

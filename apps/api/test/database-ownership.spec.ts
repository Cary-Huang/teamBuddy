import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { planningSchemaTables } from "../src/modules/planning/planning.schema.js";
import { portfolioSchemaTables } from "../src/modules/portfolio/portfolio.schema.js";
import { teamSchemaTables } from "../src/modules/team/team.schema.js";
import { workSchemaTables } from "../src/modules/work/work.schema.js";
import { outboxSchemaTables } from "../src/platform/outbox/outbox.schema.js";

const expectTablesOwnedBy = (tables: readonly PgTable[], schema: string) => {
  expect(tables.length).toBeGreaterThan(0);
  expect(tables.map((table) => getTableConfig(table).schema)).toEqual(
    tables.map(() => schema),
  );
};

describe("database ownership", () => {
  it("keeps each module table in its PostgreSQL schema", () => {
    expectTablesOwnedBy(teamSchemaTables, "team");
    expectTablesOwnedBy(portfolioSchemaTables, "portfolio");
    expectTablesOwnedBy(workSchemaTables, "work");
    expectTablesOwnedBy(planningSchemaTables, "planning");
    expectTablesOwnedBy(outboxSchemaTables, "platform");
  });

  it("does not declare cross-module foreign keys", () => {
    const modules = [
      teamSchemaTables,
      portfolioSchemaTables,
      workSchemaTables,
      planningSchemaTables,
      outboxSchemaTables,
    ];

    for (const tables of modules) {
      const ownedTables = new Set(
        tables.map((table) => {
          const config = getTableConfig(table);
          return `${config.schema}.${config.name}`;
        }),
      );
      for (const table of tables) {
        for (const foreignKey of getTableConfig(table).foreignKeys) {
          const foreignTable = getTableConfig(
            foreignKey.reference().foreignTable,
          );
          expect(
            ownedTables.has(`${foreignTable.schema}.${foreignTable.name}`),
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the Outbox status constraint in Drizzle metadata", () => {
    const [table] = outboxSchemaTables;
    expect(getTableConfig(table).checks.map(({ name }) => name)).toContain(
      "outbox_events_status_check",
    );
  });
});

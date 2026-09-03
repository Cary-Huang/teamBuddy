import { readDatabaseUrl } from "./client.js";
import { migrateDatabase } from "./migrate.js";
import { CORE_DEMO_TEAM_ID, seedCoreDemoDatabase } from "./seed-core-demo.js";

interface DatabaseInitializationDependencies {
  migrate(databaseUrl: string): Promise<unknown>;
  seed(databaseUrl: string): Promise<unknown>;
}

const defaultDependencies: DatabaseInitializationDependencies = {
  migrate: migrateDatabase,
  seed: seedCoreDemoDatabase,
};

export const readCoreDemoSeedEnabled = (value?: string): boolean => {
  if (value === undefined || value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  throw new Error("SEED_CORE_DEMO must be one of: true, false, 1, 0");
};

export const initializeDatabase = async (
  databaseUrl: string,
  seedCoreDemoEnabled: boolean,
  dependencies: DatabaseInitializationDependencies = defaultDependencies,
): Promise<void> => {
  await dependencies.migrate(databaseUrl);
  if (seedCoreDemoEnabled) await dependencies.seed(databaseUrl);
};

if (require.main === module) {
  const seedCoreDemoEnabled = readCoreDemoSeedEnabled(
    process.env.SEED_CORE_DEMO,
  );
  void initializeDatabase(readDatabaseUrl(), seedCoreDemoEnabled)
    .then(() => {
      if (seedCoreDemoEnabled) {
        console.info("Initialized TeamBuddy core demo", {
          teamId: CORE_DEMO_TEAM_ID,
        });
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

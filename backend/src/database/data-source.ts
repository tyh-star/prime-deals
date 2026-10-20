import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES, MIGRATIONS } from './entities';

export function dataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    // Schema changes only ever happen through reviewed migrations.
    synchronize: false,
    extra: { max: 20 },
  };
}

/** Used by the TypeORM CLI (`npm run migration:run`). */
export default new DataSource(
  dataSourceOptions(
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/prime_deals',
  ),
);

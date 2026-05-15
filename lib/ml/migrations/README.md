# SQLite Migrations — xsjprd55

This directory contains versioned SQL migration files for the local SQLite database (`data/ml-loop.sqlite`).

## How It Works

1. A `_migrations` table tracks which migrations have been applied.
2. Migration files are named `001_description.sql`, `002_description.sql`, etc.
3. The migration runner (`runMigrations()` in `migration-runner.js`) applies any unapplied migrations in order.
4. Each migration runs in a transaction — if it fails, the transaction rolls back.

## Adding a New Migration

1. Create a new file with the next sequence number: `003_description.sql`
2. Write your SQL statements (CREATE TABLE, ALTER TABLE, CREATE INDEX, etc.)
3. The runner will auto-discover and apply it on next `initMlDb()` call.

## Migration File Format

```sql
-- Migration: 003_add_some_column
-- Description: Add some_column to some_table
-- Date: 2026-05-15

ALTER TABLE some_table ADD COLUMN some_column TEXT;
```

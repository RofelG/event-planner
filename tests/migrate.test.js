'use strict';

/**
 * Migration runner tests against the isolated <DB_DB>_test database.
 * Extra migrations live in temporary directories and clean up after themselves.
 */
process.env.NODE_ENV = 'test';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool, query } = require('../server/db/pool');
const { migrate } = require('../server/db/migrate');

let dirs = [];

function tempMigrations(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-migrations-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

const versions = async () => (await query('SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version);

beforeAll(() => migrate());

afterEach(async () => {
  await query('DROP TABLE IF EXISTS migrate_probe');
  await query("DELETE FROM schema_migrations WHERE version LIKE '9%'");
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

afterAll(() => pool.end());

describe('migrate', () => {
  it('is a no-op when run again', async () => {
    expect(await migrate()).toEqual([]);
  });

  it('records applied versions', async () => {
    expect(await versions()).toContain('0001_initial');
    const [row] = await query("SELECT applied_at FROM schema_migrations WHERE version = '0001_initial'");
    expect(row.applied_at).toBeTruthy();
  });

  it('applies a new migration exactly once', async () => {
    const dir = tempMigrations({
      '9001_probe.sql': '-- a comment\nCREATE TABLE migrate_probe (id INT PRIMARY KEY);\nINSERT INTO migrate_probe (id) VALUES (1);\n',
    });
    expect(await migrate({ dir })).toEqual(['9001_probe']);
    expect(await migrate({ dir })).toEqual([]);
    expect(await query('SELECT id FROM migrate_probe')).toHaveLength(1);
    expect(await versions()).toContain('9001_probe');
  });

  it('does not record a failing migration', async () => {
    const dir = tempMigrations({ '9002_broken.sql': 'SELECT * FROM table_that_does_not_exist;\n' });
    await expect(migrate({ dir })).rejects.toThrow(/9002_broken/);
    expect(await versions()).not.toContain('9002_broken');
    // The lock is released, so a later run is not blocked.
    expect(await migrate()).toEqual([]);
  });
});

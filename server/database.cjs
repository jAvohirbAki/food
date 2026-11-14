const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// Local SQLite uses the same prepared-statement interface as hosted D1.
function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  for (const name of fs.readdirSync(path.join(__dirname, '../drizzle')).filter(n => n.endsWith('.sql')).sort()) {
    if (!sqlite.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)) {
      sqlite.exec('BEGIN');
      try {
        sqlite.exec(fs.readFileSync(path.join(__dirname, '../drizzle', name), 'utf8'));
        sqlite.prepare('INSERT INTO schema_migrations VALUES (?)').run(name);
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  }
  function prepare(sql) {
    const statement = sqlite.prepare(sql);
    const bound = values => ({
      first: async () => statement.get(...values) ?? null,
      all: async () => ({ results: statement.all(...values) }),
      run: async () => ({ meta: { changes: statement.run(...values).changes } }),
      _run: () => ({ meta: { changes: statement.run(...values).changes } })
    });
    return { bind: (...values) => bound(values), ...bound([]) };
  }
  async function batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(statement => statement._run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  return { prepare, batch, close: () => sqlite.close() };
}
module.exports = { openDatabase };

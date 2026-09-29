// Reads the shape of the public schema (tables, columns, CHECK constraints and
// indexes) from a database. Shared by expected-schema.mjs and adopt-schema.mjs.

export async function readSchemaShape(client) {
  const { rows: columns } = await client.query(`
    select c.table_name, c.column_name, c.data_type, c.is_nullable
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.column_name`);
  const { rows: checks } = await client.query(`
    select rel.relname as table_name, con.conname as name, pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and con.contype = 'c'
    order by con.conname`);
  const { rows: indexes } = await client.query(`
    select tablename as table_name, indexname as name, indexdef as definition
    from pg_indexes where schemaname = 'public'
    order by indexname`);

  const tables = {};
  for (const row of columns) {
    (tables[row.table_name] ??= {})[row.column_name] = `${row.data_type}${row.is_nullable === "NO" ? " not null" : ""}`;
  }
  return {
    tables,
    checks: Object.fromEntries(checks.map((row) => [row.name, { table: row.table_name, definition: row.definition }])),
    indexes: Object.fromEntries(indexes.map((row) => [row.name, { table: row.table_name, definition: row.definition }])),
  };
}

/**
 * JDBC-style SQL connectivity via mysql2, pg, and mssql (no Oracle/DB2 drivers in default install).
 */

export function normalizeJdbcConfig(input = {}) {
  const driver = String(input.driver ?? input.jdbcDriver ?? 'postgres').toLowerCase();
  const host = String(input.host ?? input.jdbcHost ?? '').trim();
  const port = input.port ?? input.jdbcPort ?? '';
  const database = String(input.database ?? input.jdbcDatabase ?? '').trim();
  const user = String(input.user ?? input.jdbcUser ?? '').trim();
  const password = input.password ?? input.jdbcPassword ?? '';
  const sql =
    String(input.sql ?? input.jdbcQuery ?? '').trim() ||
    'SELECT 1 AS ok';
  const userSql =
    String(input.userSql ?? input.jdbcUserQuery ?? '').trim() ||
    `SELECT 'sample' AS user_id, 'sample@local' AS email, 'Sample User' AS display_name`;
  return {
    driver,
    host,
    port: port === '' ? null : parseInt(port, 10),
    database,
    user,
    password,
    sql,
    userSql,
  };
}

export async function testJdbcConnection(raw) {
  const cfg = normalizeJdbcConfig(raw);
  if (!cfg.host || !cfg.database || !cfg.user) {
    throw new Error('JDBC host, database, and user are required.');
  }
  const rows = await runQuery(cfg, cfg.sql, 5);
  return {
    ok: true,
    sampleCount: Array.isArray(rows) ? rows.length : 0,
    hint: 'SQL query executed successfully.',
  };
}

export async function fetchJdbcUsers(raw, options = {}) {
  const cfg = normalizeJdbcConfig(raw);
  if (!cfg.host || !cfg.database || !cfg.user) {
    throw new Error('JDBC host, database, and user are required.');
  }
  const maxUsers = Math.min(Math.max(parseInt(options.maxUsers, 10) || 10000, 1), 50000);
  const rows = await runQuery(cfg, cfg.userSql, maxUsers);
  if (!Array.isArray(rows)) return [];
  return rows.map((row, i) => mapSqlRow(row, i));
}

function mapSqlRow(row, index) {
  if (!row || typeof row !== 'object') {
    return {
      user_id: String(index),
      email: '',
      display_name: String(row),
      rawData: { value: row },
    };
  }
  const keys = Object.keys(row);
  const lower = {};
  for (const k of keys) lower[k.toLowerCase()] = row[k];
  const user_id =
    lower.user_id ??
    lower.username ??
    lower.login ??
    lower.id ??
    keys[0];
  const email = lower.email ?? lower.mail ?? '';
  const nameJoin = [lower.first_name, lower.last_name].filter(Boolean).join(' ');
  const display =
    lower.display_name ??
    lower.name ??
    lower.full_name ??
    (nameJoin || String(user_id));
  return {
    user_id: String(user_id ?? index),
    employee_id: lower.employee_id ?? '',
    username: String(lower.username ?? user_id ?? ''),
    email: String(email),
    display_name: String(display),
    status: lower.status ?? 'active',
    department: lower.department ?? '',
    title: lower.title ?? '',
    manager_id: lower.manager_id ?? '',
    telephone: lower.telephone ?? lower.phone ?? '',
    member_of_entitlements: '',
    rawData: row,
  };
}

async function runQuery(cfg, sql, limit) {
  const d = cfg.driver === 'mysql' || cfg.driver === 'mariadb' ? 'mysql' : cfg.driver;
  if (d === 'postgres' || d === 'postgresql' || d === 'pg') {
    const pg = await import('pg');
    const Client = pg.default?.Client || pg.Client;
    const client = new Client({
      host: cfg.host,
      port: cfg.port || 5432,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
    });
    await client.connect();
    try {
      const res = await client.query(sql);
      return res.rows?.slice(0, limit) ?? [];
    } finally {
      await client.end();
    }
  }
  if (d === 'mysql') {
    const { default: mysql } = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port || 3306,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
    });
    try {
      const [rows] = await conn.execute(sql);
      return Array.isArray(rows) ? rows.slice(0, limit) : [];
    } finally {
      await conn.end();
    }
  }
  if (d === 'mssql' || d === 'sqlserver' || d === 'microsoft sql server') {
    const sqlPkg = await import('mssql');
    const pool = await sqlPkg.default.connect({
      server: cfg.host,
      port: cfg.port || 1433,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
    });
    try {
      const result = await pool.request().query(sql);
      const rows = result.recordset || [];
      return Array.isArray(rows) ? rows.slice(0, limit) : [];
    } finally {
      await pool.close();
    }
  }
  throw new Error(
    `Unsupported JDBC driver "${cfg.driver}". Use postgres, mysql, or mssql. (Oracle/DB2 require additional native drivers.)`
  );
}

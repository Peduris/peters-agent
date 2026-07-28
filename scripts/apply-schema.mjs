import fs from 'fs';
import { neon } from '@neondatabase/serverless';

const url =
  process.env.DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

function meta(u) {
  if (!u) return { present: false };
  return {
    present: true,
    len: u.length,
    placeholder: u === '[SENSITIVE]',
    postgresScheme: /^postgres(ql)?:\/\//i.test(u.trim()),
    onlyWhitespace: /^\s*$/.test(u),
  };
}

console.log('DATABASE_URL meta:', JSON.stringify(meta(process.env.DATABASE_URL)));
console.log('POSTGRES_URL meta:', JSON.stringify(meta(process.env.POSTGRES_URL)));
console.log('DATABASE_URL_UNPOOLED meta:', JSON.stringify(meta(process.env.DATABASE_URL_UNPOOLED)));

if (!url || url === '[SENSITIVE]' || /^\s*$/.test(url) || !/^postgres(ql)?:\/\//i.test(url.trim())) {
  console.error('FAIL: no usable connection string in environment');
  process.exit(2);
}

const schemaText = fs.readFileSync(new URL('../lib/db/schema.sql', import.meta.url), 'utf8');
const withoutLineComments = schemaText
  .split(/\n/)
  .map((line) => {
    const idx = line.indexOf('--');
    if (idx === -1) return line;
    const before = line.slice(0, idx);
    if ((before.match(/'/g) || []).length % 2 === 1) return line;
    return before;
  })
  .join('\n');

const statements = withoutLineComments
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log('statements:', statements.length);
const sql = neon(url.trim());

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.replace(/\s+/g, ' ').slice(0, 70);
  try {
    await sql.query(stmt);
    console.log(`OK [${i + 1}/${statements.length}] ${preview}`);
  } catch (err) {
    console.error(`FAIL [${i + 1}/${statements.length}] ${preview}`);
    const msg = String(err?.message || 'unknown').replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_URL]');
    console.error('message:', msg);
    process.exit(1);
  }
}

const tables = await sql.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`);
const names = (tables.rows || tables).map((r) => r.table_name);
console.log('SCHEMA_APPLIED: true');
console.log('TABLES:', names.join(', '));

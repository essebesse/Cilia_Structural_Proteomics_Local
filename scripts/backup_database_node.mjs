#!/usr/bin/env node
/**
 * Node.js Database Backup Script
 * Alternative to bash script when pg_dump is not available
 * Uses @vercel/postgres to export database to JSON/CSV
 */

import { sql } from '@vercel/postgres';
import { writeFileSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                  new Date().toTimeString().split(' ')[0].replace(/:/g, '');
const backupDir = `database_backups/neon_backup_${timestamp}`;
const csvDir = `${backupDir}/csv_exports`;

console.log('=================================================================================');
console.log(`DATABASE BACKUP - ${new Date().toLocaleString()}`);
console.log('=================================================================================\n');

console.log('📦 Backup Configuration:');
console.log(`   Output: ${backupDir}`);
console.log(`   Method: Node.js JSON/CSV export\n`);

// Create directories
mkdirSync(csvDir, { recursive: true });

try {
  // ============================
  // 1. EXPORT SCHEMA AS SQL
  // ============================

  console.log('📐 Exporting schema...');

  const schemaQuery = await sql`
    SELECT
      'CREATE TABLE ' || table_name || ' (' ||
      string_agg(
        column_name || ' ' || data_type ||
        CASE WHEN character_maximum_length IS NOT NULL
          THEN '(' || character_maximum_length || ')'
          ELSE ''
        END,
        ', '
      ) || ');' as create_statement
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
  `;

  let schemaSQL = `-- Database Schema Export\n-- Generated: ${new Date().toISOString()}\n\n`;
  schemaQuery.rows.forEach(row => {
    schemaSQL += row.create_statement + '\n\n';
  });

  writeFileSync(`${backupDir}/schema_simplified.sql`, schemaSQL);
  console.log('✅ Schema exported\n');

  // ============================
  // 2. EXPORT ALL TABLES
  // ============================

  console.log('📊 Exporting table data...');

  // Get list of tables
  const tablesResult = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  const tables = tablesResult.rows.map(r => r.tablename);
  console.log(`   Found ${tables.length} tables\n`);

  const backupData = {};
  let totalRows = 0;

  for (const table of tables) {
    process.stdout.write(`   Exporting: ${table.padEnd(30)}`);

    try {
      // Get all data from table
      const data = await sql.query(`SELECT * FROM ${table}`);
      backupData[table] = data.rows;
      totalRows += data.rows.length;

      // Also export as CSV
      const csvHeader = data.fields.map(f => f.name).join(',');
      const csvRows = data.rows.map(row =>
        data.fields.map(f => {
          const val = row[f.name];
          if (val === null) return '';
          if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
          return val;
        }).join(',')
      );

      const csv = [csvHeader, ...csvRows].join('\n');
      writeFileSync(`${csvDir}/${table}.csv`, csv);

      console.log(` ✅ ${data.rows.length} rows`);
    } catch (error) {
      console.log(` ❌ Error: ${error.message}`);
    }
  }

  console.log(`\n✅ Exported ${totalRows} total rows\n`);

  // ============================
  // 3. SAVE COMPLETE JSON BACKUP
  // ============================

  console.log('💾 Creating JSON backup...');

  const jsonBackup = {
    metadata: {
      timestamp: new Date().toISOString(),
      database: 'neondb',
      totalTables: tables.length,
      totalRows: totalRows
    },
    tables: backupData
  };

  writeFileSync(`${backupDir}/complete_backup.json`, JSON.stringify(jsonBackup, null, 2));
  console.log('✅ JSON backup created\n');

  // ============================
  // 4. GENERATE STATISTICS
  // ============================

  console.log('📈 Generating statistics...');

  let stats = `================================================================================
DATABASE STATISTICS
Generated: ${new Date().toISOString()}
================================================================================

Table Row Counts:
-----------------\n`;

  for (const table of tables) {
    const count = backupData[table].length;
    stats += `${table.padEnd(30)} ${count.toString().padStart(10)} rows\n`;
  }

  stats += `\nTotal: ${totalRows} rows across ${tables.length} tables\n`;

  writeFileSync(`${backupDir}/statistics.txt`, stats);
  console.log('✅ Statistics generated\n');

  // ============================
  // 5. CREATE RESTORE SCRIPT
  // ============================

  console.log('📝 Creating restore script...');

  const restoreScript = `#!/usr/bin/env node
/**
 * Restore script for backup: ${timestamp}
 * Generated: ${new Date().toISOString()}
 */

import { sql } from '@vercel/postgres';
import { readFileSync } from 'fs';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL required');
  process.exit(1);
}

console.log('Restoring database from ${timestamp}...');

const backup = JSON.parse(readFileSync('complete_backup.json', 'utf8'));

for (const [table, rows] of Object.entries(backup.tables)) {
  console.log(\`Restoring \${table}: \${rows.length} rows\`);

  for (const row of rows) {
    const columns = Object.keys(row).join(', ');
    const values = Object.values(row).map(v => {
      if (v === null) return 'NULL';
      if (typeof v === 'string') return \`'\${v.replace(/'/g, "''") }'\`;
      return v;
    }).join(', ');

    try {
      await sql.query(\`INSERT INTO \${table} (\${columns}) VALUES (\${values})\`);
    } catch (error) {
      console.error(\`Error inserting into \${table}:\`, error.message);
    }
  }
}

console.log('✅ Restore complete');
`;

  writeFileSync(`${backupDir}/restore.mjs`, restoreScript);
  console.log('✅ Restore script created\n');

  // ============================
  // 6. CREATE README
  // ============================

  const readme = `================================================================================
DATABASE BACKUP - ${timestamp}
================================================================================

Created: ${new Date().toLocaleString()}
Method: Node.js JSON/CSV export
Total Tables: ${tables.length}
Total Rows: ${totalRows}

================================================================================
CONTENTS
================================================================================

1. complete_backup.json
   - Complete database in JSON format
   - All tables and all rows
   - Size: ${Math.round(JSON.stringify(jsonBackup).length / 1024)} KB

2. csv_exports/
   - Each table exported as CSV with headers
   - Human-readable format
   - Easy to import into Excel or other tools

3. schema_simplified.sql
   - Basic table structure
   - Note: May not include all constraints/indexes

4. statistics.txt
   - Row counts per table

5. restore.mjs
   - Node.js script to restore this backup
   - Run with: node restore.mjs

6. BACKUP_INFO.txt
   - This file

================================================================================
RESTORE INSTRUCTIONS
================================================================================

Full Restore (Node.js):
  cd ${backupDir}
  export POSTGRES_URL="your_database_url"
  node restore.mjs

Individual Table from CSV:
  psql -d database -c "\\COPY tablename FROM 'csv_exports/tablename.csv' CSV HEADER"

================================================================================
TABLES IN THIS BACKUP
================================================================================

${tables.map(t => `- ${t} (${backupData[t].length} rows)`).join('\n')}

================================================================================
`;

  writeFileSync(`${backupDir}/BACKUP_INFO.txt`, readme);

  // ============================
  // 7. CALCULATE SIZES
  // ============================

  console.log('📏 Calculating backup sizes...');

  try {
    const { stdout } = await execAsync(`du -sh ${backupDir}`);
    const size = stdout.trim().split('\t')[0];
    console.log(`   Total backup size: ${size}\n`);
  } catch (error) {
    console.log('   Could not calculate size\n');
  }

  // ============================
  // SUMMARY
  // ============================

  console.log('=================================================================================');
  console.log('✅ BACKUP COMPLETE');
  console.log('=================================================================================\n');
  console.log(`Backup Location: ${backupDir}\n`);
  console.log('Contents:');
  console.log('  - complete_backup.json (all data in JSON)');
  console.log(`  - csv_exports/ (${tables.length} CSV files)`);
  console.log('  - schema_simplified.sql');
  console.log('  - statistics.txt');
  console.log('  - restore.mjs (restore script)');
  console.log('  - BACKUP_INFO.txt (this info)\n');
  console.log('To restore:');
  console.log(`  cd ${backupDir}`);
  console.log('  export POSTGRES_URL="..."');
  console.log('  node restore.mjs\n');
  console.log('=================================================================================\n');

} catch (error) {
  console.error('\n❌ Backup failed:', error.message);
  console.error(error);
  process.exit(1);
}

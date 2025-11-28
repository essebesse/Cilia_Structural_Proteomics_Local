# Database Backup & Restore Guide

Complete guide for backing up and restoring the Neon PostgreSQL database.

## Quick Start

### Create a Backup (Recommended Method)

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

node scripts/backup_database_node.mjs
```

**What it does:**
- Exports complete database to JSON (all tables, all data)
- Exports each table as CSV (human-readable)
- Generates database statistics and metadata
- Creates automated restore script
- No PostgreSQL client tools required (uses Node.js)

**Output:** `database_backups/neon_backup_YYYY-MM-DD_HHMMSS/`

**Typical results:**
- Total size: ~3-5 MB (compressed from 13 MB database)
- Complete backup JSON: ~3 MB
- CSV exports: ~1 MB
- Time: ~30 seconds

---

### Alternative: Bash Script (Requires pg_dump)

```bash
./scripts/backup_database.sh
```

**Note:** This requires PostgreSQL client tools (`pg_dump`, `psql`) to be installed. Use the Node.js method above if these tools are not available.

---

## Backup Directory Structure

### Node.js Backup Format (Recommended)

```
database_backups/
└── neon_backup_2025-10-12_141656/
    ├── complete_backup.json       # Full database in JSON (3.0 MB)
    ├── schema_simplified.sql      # Table structures
    ├── statistics.txt             # Row counts
    ├── restore.mjs                # Automated restore script
    ├── BACKUP_INFO.txt            # Metadata & instructions
    └── csv_exports/               # Individual table CSVs (845 KB)
        ├── proteins.csv           (69 KB - 1,424 rows)
        ├── interactions.csv       (255 KB - 2,419 rows)
        ├── protein_aliases.csv    (517 KB - 6,618 rows)
        └── ... (4 more tables)
```

### Bash Script Format (pg_dump method)

```
database_backups/
├── neon_backup_20251012_133045/
│   ├── complete_backup.dump       # Full backup (compressed binary)
│   ├── schema.sql                 # Structure only
│   ├── data.sql                   # Data only
│   ├── statistics.txt             # Database stats
│   ├── BACKUP_INFO.txt            # Metadata & instructions
│   └── csv_exports/               # Individual table CSVs
│       ├── proteins.csv
│       ├── interactions.csv
│       └── ...
└── neon_backup_20251012_133045.tar.gz  # Optional compressed archive
```

---

## Understanding Backup Sizes

### Why Backup is Smaller Than Database

Your backup will be **significantly smaller** than the database size shown in Neon dashboard:

| Component | Size | What It Includes |
|-----------|------|------------------|
| **Neon Dashboard** | ~40 MB | Total storage: data + indexes + WAL logs + temp files + system overhead |
| **PostgreSQL Database** | ~13 MB | Actual database: tables (~1.7 MB) + indexes (~3.5 MB) + overhead (~8 MB) |
| **Your Backup** | ~3.8 MB | Pure data only: table contents in JSON/CSV format |

**Key differences:**
- ****Indexes are not backed up** (~3.5 MB saved) - They're automatically rebuilt on restore
- ****No PostgreSQL overhead** (~8 MB saved) - System files, catalogs, etc.
- ****No WAL logs** - Write-Ahead Logs for transaction recovery
- ****Efficient JSON format** - Compressed text representation

**This is normal and expected!** Your 3.8 MB backup contains all the data needed to fully restore the database.

### Table Size Breakdown (Current Database)

| Table | Rows | Table Size | Index Size | Total |
|-------|------|------------|------------|-------|
| protein_aliases | 6,618 | 848 KB | 2,136 KB | 2,984 KB |
| interactions | 2,419 | 704 KB | 832 KB | 1,536 KB |
| proteins | 1,424 | 176 KB | 592 KB | 768 KB |
| complex_interactions | 14 | 8 KB | 88 KB | 96 KB |
| Other tables | 3 | 24 KB | 160 KB | 184 KB |
| **TOTAL** | **10,478** | **~1.7 MB** | **~3.5 MB** | **~5.5 MB** |

**Your backup efficiently captures the ~1.7 MB of actual table data.**

---

## What Gets Backed Up

### 1. Complete Database (`complete_backup.json` or `complete_backup.dump`)
- **Format:** PostgreSQL custom format (compressed)
- **Contents:** Full database with schema + data
- **Size:** ~10-50 MB (depends on data size)
- **Use case:** Complete restore to new database

### 2. Schema Only (`schema.sql`)
- **Format:** Plain SQL
- **Contents:** Tables, indexes, constraints, types
- **Size:** ~50 KB
- **Use case:** Recreate database structure elsewhere

### 3. Data Only (`data.sql`)
- **Format:** Plain SQL INSERT statements
- **Contents:** All table data
- **Size:** ~10-50 MB
- **Use case:** Import data into existing schema

### 4. CSV Exports (`csv_exports/*.csv`)
- **Format:** Comma-separated values with headers
- **Contents:** Each table as separate CSV file
- **Size:** ~5-30 MB total
- **Use case:** Easy inspection, Excel, data analysis

### 5. Statistics (`statistics.txt`)
- Database size
- Table sizes
- Row counts
- Largest tables

### 6. Metadata (`BACKUP_INFO.txt`)
- Backup timestamp
- Database connection info
- File descriptions
- Restore instructions
- File sizes

---

## Restore Options

### Option 1: Full Database Restore (Recommended)

**Use case:** Restore entire database to a new location

```bash
# Create new empty database
createdb -h localhost -U postgres new_database

# Restore complete backup
pg_restore -h localhost \
           -U postgres \
           -d new_database \
           database_backups/neon_backup_20251012_133045/complete_backup.dump
```

**Alternative: From compressed archive**
```bash
# Extract archive first
tar -xzf database_backups/neon_backup_20251012_133045.tar.gz

# Then restore
pg_restore -d new_database \
           database_backups/neon_backup_20251012_133045/complete_backup.dump
```

---

### Option 2: Schema-Only Restore

**Use case:** Set up database structure without data

```bash
psql -h localhost \
     -U postgres \
     -d new_database \
     -f database_backups/neon_backup_20251012_133045/schema.sql
```

---

### Option 3: Data-Only Restore

**Use case:** Import data into existing database with matching schema

```bash
psql -h localhost \
     -U postgres \
     -d existing_database \
     -f database_backups/neon_backup_20251012_133045/data.sql
```

---

### Option 4: Individual Table from CSV

**Use case:** Restore just one table or inspect data manually

```bash
# View CSV in terminal
cat database_backups/neon_backup_20251012_133045/csv_exports/proteins.csv | less

# Import single table
psql -d database \
     -c "\COPY proteins FROM 'database_backups/neon_backup_20251012_133045/csv_exports/proteins.csv' CSV HEADER"
```

---

## Backup Best Practices

### 1. Regular Backups

**Recommended schedule:**
- After major data imports (new AF3 runs)
- Before making schema changes
- Weekly if actively developing
- Monthly for stable production

### 2. Backup Retention

The script will warn when you have more than 5 backups. Consider:
- Keep last 5 backups (automatic prompt)
- Archive quarterly backups separately
- Delete backups older than 3 months

### 3. Storage Management

**Typical sizes:**
- Complete backup: 10-50 MB
- Compressed archive: 5-20 MB
- CSV exports: 5-30 MB

**Total per backup:** ~20-100 MB

**With 5 backups:** ~100-500 MB total

### 4. Off-Server Backups

**Important:** Store backups somewhere other than the server!

```bash
# Copy to your local machine
scp -r user@server:/path/to/database_backups/ ~/local_backups/

# Or sync to cloud storage
rclone sync database_backups/ dropbox:database_backups/
```

---

## Verification

### Check Backup Integrity

```bash
# List tables in backup
pg_restore -l database_backups/neon_backup_20251012_133045/complete_backup.dump

# Verify row counts match
cat database_backups/neon_backup_20251012_133045/statistics.txt
```

### Test Restore (Dry Run)

```bash
# Create temporary test database
createdb test_restore

# Restore backup
pg_restore -d test_restore \
           database_backups/neon_backup_20251012_133045/complete_backup.dump

# Verify
psql -d test_restore -c "SELECT COUNT(*) FROM proteins;"
psql -d test_restore -c "SELECT COUNT(*) FROM interactions;"

# Cleanup
dropdb test_restore
```

---

## Troubleshooting

### Problem: pg_dump not found

**Solution:** Install PostgreSQL client tools
```bash
# Ubuntu/Debian
sudo apt-get install postgresql-client

# macOS
brew install postgresql
```

### Problem: Connection timeout

**Solution:** Check firewall, VPN, or connection string
```bash
# Test connection
psql "$POSTGRES_URL" -c "SELECT 1;"
```

### Problem: Out of disk space

**Solutions:**
1. Clean old backups: Remove oldest backups manually
2. Compress backups: Use tar.gz option
3. Use data-only export: Skip large csv_exports
4. Store backups on external storage

### Problem: Backup incomplete (tables missing)

**Check:**
```bash
# List tables in database
psql "$POSTGRES_URL" -c "\dt"

# List tables in backup
pg_restore -l backup_file.dump
```

### Problem: Permission denied during restore

**Solution:** Ensure user has CREATE permissions
```bash
# Grant permissions
psql -d target_database -c "GRANT ALL PRIVILEGES ON DATABASE target_database TO username;"
```

---

## Advanced Usage

### Selective Table Backup

```bash
# Backup just proteins table
pg_dump -h HOST -U USER -d DATABASE \
        -t proteins \
        -f proteins_backup.sql

# Backup multiple specific tables
pg_dump -h HOST -U USER -d DATABASE \
        -t proteins -t interactions \
        -f core_tables_backup.sql
```

### Incremental Backups

```bash
# Backup only recent interactions (last 7 days)
psql "$POSTGRES_URL" -c "\COPY (SELECT * FROM interactions WHERE created_at > NOW() - INTERVAL '7 days') TO 'recent_interactions.csv' CSV HEADER"
```

### Automated Backups (Cron)

```bash
# Edit crontab
crontab -e

# Add weekly backup (Sunday at 2 AM)
0 2 * * 0 cd /path/to/project && ./scripts/backup_database.sh > backup.log 2>&1
```

### Backup to Remote Server

```bash
# Backup and stream directly to remote server
pg_dump "$POSTGRES_URL" | \
  ssh user@backup-server "cat > /backups/neon_$(date +%Y%m%d).sql"
```

---

## Monitoring Backup Growth

### Track Database Size Over Time

```bash
# Create tracking file
echo "Date,Size" > backup_sizes.csv

# Append current size
echo "$(date +%Y-%m-%d),$(psql "$POSTGRES_URL" -t -c "SELECT pg_size_pretty(pg_database_size(current_database()));")" >> backup_sizes.csv
```

### Compare Backups

```bash
# Compare row counts between two backups
diff <(pg_restore -l backup1.dump | grep TABLE) \
     <(pg_restore -l backup2.dump | grep TABLE)
```

---

## Recovery Scenarios

### Scenario 1: Accidental Data Deletion

**Problem:** Deleted important interactions by mistake

**Solution:**
1. Restore to temporary database
2. Export deleted data
3. Import to production

```bash
# Restore to temp database
createdb recovery_temp
pg_restore -d recovery_temp latest_backup/complete_backup.dump

# Export missing data
psql recovery_temp -c "\COPY (SELECT * FROM interactions WHERE ...) TO 'recovered_data.csv' CSV HEADER"

# Import to production
psql "$POSTGRES_URL" -c "\COPY interactions FROM 'recovered_data.csv' CSV HEADER"

# Cleanup
dropdb recovery_temp
```

### Scenario 2: Schema Migration Gone Wrong

**Problem:** ALTER TABLE broke something

**Solution:**
1. Restore schema from last good backup
2. Migrate data manually

```bash
# Drop broken tables
psql "$POSTGRES_URL" -c "DROP TABLE IF EXISTS broken_table CASCADE;"

# Restore schema
psql "$POSTGRES_URL" -f backup/schema.sql

# Import data selectively
psql "$POSTGRES_URL" -f backup/data.sql
```

### Scenario 3: Complete Database Corruption

**Problem:** Database is unrecoverable

**Solution:**
1. Create new database
2. Restore from latest backup
3. Update application connection strings

```bash
# Full restore
createdb neondb_new
pg_restore -d neondb_new backup/complete_backup.dump

# Verify
psql neondb_new -c "SELECT COUNT(*) FROM proteins;"
```

---

## Backup Checklist

Before important operations:

- [ ] Create fresh backup
- [ ] Verify backup completed successfully
- [ ] Check backup file sizes are reasonable
- [ ] Test restore to temporary database (optional)
- [ ] Copy backup off-server
- [ ] Document what you're about to do

After backup:

- [ ] Verify all tables backed up
- [ ] Check statistics.txt for row counts
- [ ] Compress if storing long-term
- [ ] Clean up old backups if needed

---

## Related Documentation

- **IMPORT_WORKFLOW.md** - Data import procedures
- **INCREMENTAL_IMPORT_WORKFLOW.md** - Adding new data
- **CLAUDE.md** - General system documentation

---

## Support

**PostgreSQL Documentation:**
- pg_dump: https://www.postgresql.org/docs/current/app-pgdump.html
- pg_restore: https://www.postgresql.org/docs/current/app-pgrestore.html

**Neon Documentation:**
- Backups: https://neon.tech/docs/manage/backups

---

*Last updated: 2025-10-12*
*Script: scripts/backup_database.sh*

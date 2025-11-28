#!/bin/bash

# =============================================================================
# DATABASE BACKUP SCRIPT
# Downloads complete Neon PostgreSQL database to local storage
# =============================================================================

set -e  # Exit on error

# Configuration
BACKUP_DIR="database_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="neon_backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if POSTGRES_URL is set
if [ -z "$POSTGRES_URL" ]; then
    echo -e "${RED}❌ ERROR: POSTGRES_URL environment variable is not set${NC}"
    echo "Please set it with:"
    echo "export POSTGRES_URL=\"postgresql://username:password@host:port/database\""
    exit 1
fi

# Extract connection details from POSTGRES_URL
# Format: postgresql://user:pass@host[:port]/dbname?options
# Strip query parameters first
POSTGRES_URL_CLEAN="${POSTGRES_URL%%\?*}"

# Try with port first
if [[ $POSTGRES_URL_CLEAN =~ postgresql://([^:]+):([^@]+)@([^:]+):([^/]+)/(.*) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"
# Try without port (default 5432)
elif [[ $POSTGRES_URL_CLEAN =~ postgresql://([^:]+):([^@]+)@([^/]+)/(.*) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="5432"
    DB_NAME="${BASH_REMATCH[4]}"
else
    echo -e "${RED}❌ ERROR: Could not parse POSTGRES_URL${NC}"
    echo "URL format should be: postgresql://user:pass@host[:port]/dbname"
    exit 1
fi

# Create backup directory structure
mkdir -p "${BACKUP_PATH}"

echo -e "${BLUE}=================================================================================${NC}"
echo -e "${BLUE}DATABASE BACKUP - $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}=================================================================================${NC}"
echo ""
echo -e "${GREEN}📦 Backup Configuration:${NC}"
echo "   Database: ${DB_NAME}"
echo "   Host: ${DB_HOST}"
echo "   Output: ${BACKUP_PATH}"
echo ""

# Export password for pg_dump
export PGPASSWORD="${DB_PASS}"

# =============================================================================
# 1. BACKUP COMPLETE DATABASE (schema + data)
# =============================================================================

echo -e "${YELLOW}📥 Backing up complete database (schema + data)...${NC}"
pg_dump -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        -F c \
        -f "${BACKUP_PATH}/complete_backup.dump"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Complete backup successful${NC}"
    COMPLETE_SIZE=$(du -h "${BACKUP_PATH}/complete_backup.dump" | cut -f1)
    echo "   Size: ${COMPLETE_SIZE}"
else
    echo -e "${RED}❌ Complete backup failed${NC}"
    exit 1
fi

# =============================================================================
# 2. BACKUP SCHEMA ONLY (structure without data)
# =============================================================================

echo ""
echo -e "${YELLOW}📐 Backing up schema only...${NC}"
pg_dump -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --schema-only \
        -f "${BACKUP_PATH}/schema.sql"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Schema backup successful${NC}"
    SCHEMA_SIZE=$(du -h "${BACKUP_PATH}/schema.sql" | cut -f1)
    echo "   Size: ${SCHEMA_SIZE}"
else
    echo -e "${RED}❌ Schema backup failed${NC}"
fi

# =============================================================================
# 3. BACKUP DATA ONLY (for selective restore)
# =============================================================================

echo ""
echo -e "${YELLOW}📊 Backing up data only...${NC}"
pg_dump -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --data-only \
        -f "${BACKUP_PATH}/data.sql"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Data backup successful${NC}"
    DATA_SIZE=$(du -h "${BACKUP_PATH}/data.sql" | cut -f1)
    echo "   Size: ${DATA_SIZE}"
else
    echo -e "${RED}❌ Data backup failed${NC}"
fi

# =============================================================================
# 4. EXPORT INDIVIDUAL TABLES AS CSV (for easy inspection)
# =============================================================================

echo ""
echo -e "${YELLOW}📋 Exporting tables as CSV...${NC}"

# Get list of tables
TABLES=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT tablename FROM pg_tables WHERE schemaname='public';")

mkdir -p "${BACKUP_PATH}/csv_exports"

for table in $TABLES; do
    echo "   Exporting: ${table}"
    psql -h "${DB_HOST}" \
         -p "${DB_PORT}" \
         -U "${DB_USER}" \
         -d "${DB_NAME}" \
         -c "\COPY ${table} TO '${BACKUP_PATH}/csv_exports/${table}.csv' CSV HEADER"
done

echo -e "${GREEN}✅ CSV exports complete${NC}"

# =============================================================================
# 5. GENERATE DATABASE STATISTICS
# =============================================================================

echo ""
echo -e "${YELLOW}📈 Generating database statistics...${NC}"

psql -h "${DB_HOST}" \
     -p "${DB_PORT}" \
     -U "${DB_USER}" \
     -d "${DB_NAME}" \
     > "${BACKUP_PATH}/statistics.txt" << 'EOF'
\echo '================================================================================'
\echo 'DATABASE STATISTICS'
\echo '================================================================================'
\echo ''
\echo 'Table Sizes:'
\echo '------------'
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

\echo ''
\echo 'Row Counts:'
\echo '-----------'
SELECT
    schemaname,
    tablename,
    n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

\echo ''
\echo 'Database Size:'
\echo '--------------'
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

\echo ''
\echo 'Largest Tables by Row Count:'
\echo '----------------------------'
SELECT
    tablename,
    n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC
LIMIT 10;
EOF

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Statistics generated${NC}"
else
    echo -e "${YELLOW}⚠️  Statistics generation failed (non-critical)${NC}"
fi

# =============================================================================
# 6. CREATE METADATA FILE
# =============================================================================

echo ""
echo -e "${YELLOW}📝 Creating backup metadata...${NC}"

cat > "${BACKUP_PATH}/BACKUP_INFO.txt" << EOF
================================================================================
DATABASE BACKUP METADATA
================================================================================

Backup Timestamp: $(date '+%Y-%m-%d %H:%M:%S %Z')
Backup Name: ${BACKUP_NAME}
Database: ${DB_NAME}
Host: ${DB_HOST}:${DB_PORT}

================================================================================
BACKUP CONTENTS
================================================================================

1. complete_backup.dump
   - Complete database backup (schema + data)
   - PostgreSQL custom format (compressed)
   - Restore with: pg_restore -d dbname complete_backup.dump

2. schema.sql
   - Database structure only (tables, indexes, constraints)
   - Plain SQL format
   - Restore with: psql -d dbname -f schema.sql

3. data.sql
   - Data only (without structure)
   - Plain SQL format
   - Restore with: psql -d dbname -f data.sql

4. csv_exports/
   - Individual table exports as CSV
   - Human-readable format
   - Easy to inspect or import into other tools

5. statistics.txt
   - Database size, table sizes, row counts
   - Useful for monitoring growth over time

6. BACKUP_INFO.txt
   - This file

================================================================================
RESTORE INSTRUCTIONS
================================================================================

Full Database Restore:
  pg_restore -h localhost -U postgres -d new_database complete_backup.dump

Schema Only Restore:
  psql -h localhost -U postgres -d new_database -f schema.sql

Data Only Restore:
  psql -h localhost -U postgres -d new_database -f data.sql

Individual Table from CSV:
  psql -d database -c "\COPY tablename FROM 'csv_exports/tablename.csv' CSV HEADER"

================================================================================
FILE SIZES
================================================================================

$(du -h "${BACKUP_PATH}"/* 2>/dev/null | awk '{print $2 ": " $1}' | grep -v "csv_exports")

CSV Exports:
$(du -sh "${BACKUP_PATH}/csv_exports" 2>/dev/null | awk '{print $1}')

Total Backup Size:
$(du -sh "${BACKUP_PATH}" | awk '{print $1}')

================================================================================
EOF

echo -e "${GREEN}✅ Metadata created${NC}"

# =============================================================================
# 7. COMPRESS BACKUP (optional)
# =============================================================================

echo ""
read -p "$(echo -e ${YELLOW}Compress backup into tar.gz? [Y/n]: ${NC})" -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    echo -e "${YELLOW}🗜️  Compressing backup...${NC}"

    cd "${BACKUP_DIR}"
    tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}"

    if [ $? -eq 0 ]; then
        COMPRESSED_SIZE=$(du -h "${BACKUP_NAME}.tar.gz" | cut -f1)
        ORIGINAL_SIZE=$(du -sh "${BACKUP_NAME}" | cut -f1)

        echo -e "${GREEN}✅ Compression successful${NC}"
        echo "   Original size: ${ORIGINAL_SIZE}"
        echo "   Compressed size: ${COMPRESSED_SIZE}"
        echo ""
        read -p "$(echo -e ${YELLOW}Remove uncompressed backup? [y/N]: ${NC})" -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "${BACKUP_NAME}"
            echo -e "${GREEN}✅ Uncompressed backup removed${NC}"
        fi
    else
        echo -e "${RED}❌ Compression failed${NC}"
    fi

    cd - > /dev/null
fi

# Clear password from environment
unset PGPASSWORD

# =============================================================================
# 8. SUMMARY
# =============================================================================

echo ""
echo -e "${BLUE}=================================================================================${NC}"
echo -e "${GREEN}✅ BACKUP COMPLETE${NC}"
echo -e "${BLUE}=================================================================================${NC}"
echo ""
echo "Backup Location: ${BACKUP_PATH}"
echo ""
echo "Contents:"
echo "  - Complete database backup (custom format)"
echo "  - Schema-only SQL"
echo "  - Data-only SQL"
echo "  - CSV exports of all tables"
echo "  - Database statistics"
echo "  - Metadata file"
echo ""
echo "To restore this backup:"
echo "  pg_restore -d target_database ${BACKUP_PATH}/complete_backup.dump"
echo ""
echo "For more details, see: ${BACKUP_PATH}/BACKUP_INFO.txt"
echo ""
echo -e "${BLUE}=================================================================================${NC}"

# =============================================================================
# 9. CLEANUP OLD BACKUPS (optional)
# =============================================================================

echo ""
echo -e "${YELLOW}🧹 Checking for old backups...${NC}"

# Count backups
BACKUP_COUNT=$(ls -d ${BACKUP_DIR}/neon_backup_* 2>/dev/null | wc -l)
echo "   Found ${BACKUP_COUNT} backup(s) in ${BACKUP_DIR}/"

if [ ${BACKUP_COUNT} -gt 5 ]; then
    echo -e "${YELLOW}⚠️  You have more than 5 backups${NC}"
    echo ""
    echo "Old backups:"
    ls -lht ${BACKUP_DIR}/neon_backup_* | tail -n +6
    echo ""
    read -p "$(echo -e ${YELLOW}Remove backups older than the 5 most recent? [y/N]: ${NC})" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ls -dt ${BACKUP_DIR}/neon_backup_* | tail -n +6 | xargs rm -rf
        echo -e "${GREEN}✅ Old backups removed${NC}"
    fi
fi

echo ""
echo -e "${GREEN}🎉 Backup process complete!${NC}"

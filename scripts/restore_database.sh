#!/bin/bash

# =============================================================================
# DATABASE RESTORE SCRIPT
# Restores Neon PostgreSQL database from backup
# =============================================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=================================================================================${NC}"
echo -e "${BLUE}DATABASE RESTORE UTILITY${NC}"
echo -e "${BLUE}=================================================================================${NC}"
echo ""

# Check if backup path provided
if [ -z "$1" ]; then
    echo -e "${YELLOW}Available backups:${NC}"
    echo ""
    ls -lht database_backups/ | grep "neon_backup_"
    echo ""
    echo -e "${RED}Usage: $0 <backup_directory>${NC}"
    echo ""
    echo "Examples:"
    echo "  $0 database_backups/neon_backup_20251012_133045"
    echo "  $0 database_backups/neon_backup_20251012_133045.tar.gz"
    exit 1
fi

BACKUP_PATH="$1"

# Handle tar.gz archives
if [[ "$BACKUP_PATH" == *.tar.gz ]]; then
    echo -e "${YELLOW}📦 Extracting compressed backup...${NC}"
    tar -xzf "$BACKUP_PATH" -C database_backups/
    BACKUP_PATH="${BACKUP_PATH%.tar.gz}"
    echo -e "${GREEN}✅ Extracted to ${BACKUP_PATH}${NC}"
    echo ""
fi

# Verify backup exists
if [ ! -d "$BACKUP_PATH" ]; then
    echo -e "${RED}❌ ERROR: Backup directory not found: ${BACKUP_PATH}${NC}"
    exit 1
fi

# Verify backup has required files
if [ ! -f "$BACKUP_PATH/complete_backup.dump" ]; then
    echo -e "${RED}❌ ERROR: complete_backup.dump not found in ${BACKUP_PATH}${NC}"
    exit 1
fi

echo -e "${GREEN}📂 Found backup: ${BACKUP_PATH}${NC}"
echo ""

# Show backup info if available
if [ -f "$BACKUP_PATH/BACKUP_INFO.txt" ]; then
    echo -e "${BLUE}Backup Information:${NC}"
    head -20 "$BACKUP_PATH/BACKUP_INFO.txt"
    echo ""
fi

# Restore options
echo -e "${YELLOW}Restore Options:${NC}"
echo "1) Full restore (complete database)"
echo "2) Schema only (structure without data)"
echo "3) Data only (content without structure)"
echo "4) Specific table from CSV"
echo "5) Cancel"
echo ""
read -p "Select option [1-5]: " OPTION

case $OPTION in
    1)
        # Full restore
        echo ""
        echo -e "${YELLOW}⚠️  WARNING: This will restore the COMPLETE database${NC}"
        echo ""
        read -p "Enter target database URL or name: " TARGET_DB

        if [ -z "$TARGET_DB" ]; then
            echo -e "${RED}❌ No target database specified${NC}"
            exit 1
        fi

        echo ""
        echo -e "${YELLOW}🔄 Starting full restore...${NC}"

        if [[ "$TARGET_DB" == postgresql://* ]]; then
            # Full connection string provided
            pg_restore -d "$TARGET_DB" \
                       --no-owner \
                       --no-acl \
                       "$BACKUP_PATH/complete_backup.dump"
        else
            # Just database name provided
            pg_restore -d "$TARGET_DB" \
                       --no-owner \
                       --no-acl \
                       "$BACKUP_PATH/complete_backup.dump"
        fi

        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Full restore completed successfully${NC}"
        else
            echo ""
            echo -e "${RED}❌ Restore failed${NC}"
            exit 1
        fi
        ;;

    2)
        # Schema only
        echo ""
        read -p "Enter target database URL or name: " TARGET_DB

        if [ -z "$TARGET_DB" ]; then
            echo -e "${RED}❌ No target database specified${NC}"
            exit 1
        fi

        echo ""
        echo -e "${YELLOW}📐 Restoring schema only...${NC}"

        if [[ "$TARGET_DB" == postgresql://* ]]; then
            psql "$TARGET_DB" -f "$BACKUP_PATH/schema.sql"
        else
            psql -d "$TARGET_DB" -f "$BACKUP_PATH/schema.sql"
        fi

        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Schema restored successfully${NC}"
        else
            echo ""
            echo -e "${RED}❌ Schema restore failed${NC}"
            exit 1
        fi
        ;;

    3)
        # Data only
        echo ""
        echo -e "${YELLOW}⚠️  WARNING: Target database must have matching schema${NC}"
        echo ""
        read -p "Enter target database URL or name: " TARGET_DB

        if [ -z "$TARGET_DB" ]; then
            echo -e "${RED}❌ No target database specified${NC}"
            exit 1
        fi

        echo ""
        echo -e "${YELLOW}📊 Restoring data only...${NC}"

        if [[ "$TARGET_DB" == postgresql://* ]]; then
            psql "$TARGET_DB" -f "$BACKUP_PATH/data.sql"
        else
            psql -d "$TARGET_DB" -f "$BACKUP_PATH/data.sql"
        fi

        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Data restored successfully${NC}"
        else
            echo ""
            echo -e "${RED}❌ Data restore failed${NC}"
            exit 1
        fi
        ;;

    4)
        # Specific table from CSV
        if [ ! -d "$BACKUP_PATH/csv_exports" ]; then
            echo -e "${RED}❌ ERROR: csv_exports directory not found${NC}"
            exit 1
        fi

        echo ""
        echo -e "${YELLOW}Available tables:${NC}"
        ls -1 "$BACKUP_PATH/csv_exports/" | sed 's/\.csv$//'
        echo ""
        read -p "Enter table name: " TABLE_NAME

        if [ ! -f "$BACKUP_PATH/csv_exports/${TABLE_NAME}.csv" ]; then
            echo -e "${RED}❌ ERROR: Table CSV not found${NC}"
            exit 1
        fi

        echo ""
        read -p "Enter target database URL or name: " TARGET_DB

        if [ -z "$TARGET_DB" ]; then
            echo -e "${RED}❌ No target database specified${NC}"
            exit 1
        fi

        echo ""
        echo -e "${YELLOW}📋 Restoring table ${TABLE_NAME}...${NC}"

        CSV_PATH=$(realpath "$BACKUP_PATH/csv_exports/${TABLE_NAME}.csv")

        if [[ "$TARGET_DB" == postgresql://* ]]; then
            psql "$TARGET_DB" -c "\COPY ${TABLE_NAME} FROM '${CSV_PATH}' CSV HEADER"
        else
            psql -d "$TARGET_DB" -c "\COPY ${TABLE_NAME} FROM '${CSV_PATH}' CSV HEADER"
        fi

        if [ $? -eq 0 ]; then
            echo ""
            echo -e "${GREEN}✅ Table ${TABLE_NAME} restored successfully${NC}"
        else
            echo ""
            echo -e "${RED}❌ Table restore failed${NC}"
            exit 1
        fi
        ;;

    5)
        echo ""
        echo "Cancelled"
        exit 0
        ;;

    *)
        echo -e "${RED}❌ Invalid option${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}=================================================================================${NC}"
echo -e "${GREEN}✅ RESTORE COMPLETE${NC}"
echo -e "${BLUE}=================================================================================${NC}"
echo ""
echo "Verify the restore:"
echo "  psql <database> -c \"SELECT COUNT(*) FROM proteins;\""
echo "  psql <database> -c \"SELECT COUNT(*) FROM interactions;\""
echo ""

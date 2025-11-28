# CLAUDE.md - Local Deployment Version

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Protoview Local**: Standalone version of the Protoview Next.js app for local Linux deployment.

- **Parent Project**: [Cilia_Structural_Proteomics](https://github.com/essebesse/Cilia_Structural_Proteomics)
- **Cloud Version**: https://ciliaaf3predictions.vercel.app/
- **Local Stack**: Next.js 14, SQLite (planned), Local Node.js server
- **Data**: AF2/AF3 predictions with confidence scoring (iPTM, ipSAE, interface quality)

## CRITICAL: Implementation Status

**STATUS: PLANNED - NOT YET IMPLEMENTED**

This repository contains the copied codebase from the cloud version. The SQLite migration and local deployment features have NOT been implemented yet.

**DO NOT** attempt to run this code as-is - it still uses @vercel/postgres and will fail without the cloud database.

## Implementation Plan

**Complete implementation plan**: See `IMPLEMENTATION_PLAN.md` in this repository

**Original plan location**: `/u/au14762/.claude/plans/serene-honking-zebra.md`

### 7-Phase Implementation

1. **Setup SQLite** - Replace @vercel/postgres with better-sqlite3
2. **Database Schema** - Convert PostgreSQL schema to SQLite
3. **Update API Routes** - Modify 5 API route files
4. **Update Import Scripts** - Modify 37 import scripts
5. **Pre-populate Database** - Export current data to SQLite
6. **Documentation** - Installation and import guides
7. **Testing** - Verify all functionality

**Estimated Effort**: 15-21 hours

## Key Differences from Cloud Version

| Aspect | Cloud Version | Local Version (Planned) |
|--------|---------------|-------------------------|
| Database | PostgreSQL (Neon) | SQLite |
| Database Client | @vercel/postgres | better-sqlite3 |
| Parameterized Queries | $1, $2, $3 | ?, ?, ? |
| Array Parameters | = ANY($n) | IN (?, ?) |
| JSONB | Native support | TEXT (JSON string) |
| Deployment | Vercel serverless | Local Node.js server |
| Environment Setup | POSTGRES_URL env var | DATABASE_PATH (optional) |
| Database File | Cloud-hosted | protoview.db (local file) |

## Implementation Checklist

- [ ] Create `local-deployment` branch
- [ ] Install better-sqlite3
- [ ] Create database abstraction layer (lib/database.mjs)
- [ ] Convert schema to SQLite (db/schema.sql)
- [ ] Update 5 API route files
- [ ] Update 37 import script files
- [ ] Export current data to SQLite format
- [ ] Test all search functionality
- [ ] Test import workflow
- [ ] Write documentation
- [ ] Create installation guide

## File Modifications Summary

**New Files to Create**:
- `lib/database.mjs` - Database abstraction
- `lib/db-adapter.mjs` - Import script adapter
- `db/schema.sql` - SQLite schema
- `protoview.db` - Pre-populated database
- `docs/LOCAL_DEPLOYMENT.md` - Setup guide
- `docs/LOCAL_IMPORT_GUIDE.md` - Import guide
- `docs/SQLITE_SCHEMA.md` - Schema docs

**Files to Modify**:
- `package.json` - Dependencies
- `app/api/**/*.ts` - 5 API routes
- `db/*.mjs` - 37 import scripts
- `.gitignore` - Allow protoview.db

## SQL Dialect Conversion Examples

### Parameterized Queries
```javascript
// PostgreSQL
const result = await client.query(
  'SELECT * FROM proteins WHERE uniprot_id = $1',
  [proteinId]
);

// SQLite (planned)
const result = db.prepare(
  'SELECT * FROM proteins WHERE uniprot_id = ?'
).get(proteinId);
```

### Array Parameters
```javascript
// PostgreSQL
query += ` AND confidence = ANY($1)`;
params.push(['High', 'Medium']);

// SQLite (planned)
query += ` AND confidence IN (?, ?)`;
params.push('High', 'Medium');
```

### JSONB Handling
```javascript
// PostgreSQL - native JSONB
experimental_validation JSONB

// SQLite (planned) - TEXT with JSON parsing
experimental_validation TEXT
// Parse: JSON.parse(row.experimental_validation)
// Store: JSON.stringify(validationData)
```

## For the Implementer

1. **Start here**: Read `IMPLEMENTATION_PLAN.md` thoroughly
2. **Phase-by-phase**: Follow the 7 phases in order
3. **Test as you go**: Verify each phase before proceeding
4. **Reference cloud docs**: Feature documentation still applies (see parent repo)
5. **Document issues**: Track any problems for future reference

## Cloud Version Documentation

Since this is a port of the cloud version, most feature documentation in the parent repository still applies:

- Import workflows (once converted to SQLite)
- Search features
- Confidence levels
- Network visualization
- Data analysis guides

**Parent repository**: https://github.com/essebesse/Cilia_Structural_Proteomics

## Support

- **Implementation questions**: See `IMPLEMENTATION_PLAN.md`
- **Feature questions**: See parent repository documentation
- **Bug reports**: Track in this repository's issues once implementation begins

---

**Created**: 2025-11-28
**Status**: Planning phase - Implementation pending
**Next Step**: Begin Phase 1 (Setup SQLite)

# CLAUDE.md - Local Deployment Version

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🤖 IF YOU ARE CLAUDE: READ THIS FIRST

**You are implementing a local deployment of Protoview** (Next.js protein interaction viewer)

### Your Mission
Convert this Next.js app from:
- **FROM**: PostgreSQL (Neon) + Vercel deployment
- **TO**: SQLite + Local Node.js server

### Current Status (What's Done)
- ✅ **SQLite database**: `protoview.db` (1.89 MB) - FULLY POPULATED
- ✅ **CIF structure files**: 2,211 files (1.7 GB) in `structures/`
- ✅ **MolStar 3D viewer**: Fully implemented (4 components)
- ✅ **Documentation**: Complete implementation guide

### Your Task (What You Need to Do)
- ❌ **Code migration**: Replace PostgreSQL with SQLite (42 files)
  - 5 API routes in `app/api/`
  - 37 import scripts in `db/`
- ❌ **Testing**: Verify everything works
- ❌ **Documentation**: Update with your changes

### Time Estimate
**13-18 hours total**

---

## 🚀 QUICK START FOR CLAUDE

### Step 1: Read Documentation (15 minutes)
1. **This file** (you're reading it) ✅
2. **`LOCAL_DEPLOYMENT_GUIDE.md`** ⭐ **MOST IMPORTANT - START HERE**
3. **`IMPLEMENTATION_PLAN.md`** - Technical details
4. **`DATABASE_INFO.md`** - Database schema
5. **`README.md`** - Project overview

### Step 2: Understand What's Already Done
```bash
# Verify database exists and is populated
ls -lh protoview.db
sqlite3 protoview.db "SELECT COUNT(*) FROM proteins"
# Expected: 1808

# Check MolStar implementation
ls components/StructureViewer.tsx
ls app/structure/[id]/page.tsx
ls app/api/structure/[id]/route.ts

# Check CIF files
ls -la structures/ | head -20
du -sh structures/
# Expected: 1.7G, 2211 files
```

### Step 3: Start Implementation
Follow `LOCAL_DEPLOYMENT_GUIDE.md` step by step:
- Phase 1: Setup and Planning (30 min)
- Phase 2: Install SQLite (15 min)
- Phase 3: Update API Routes (3-4 hours)
- Phase 4: Update Import Scripts (6-8 hours)
- Phase 5: Testing (2-3 hours)
- Phase 6: Verify CIF Files (already done)
- Phase 7: Documentation (1-2 hours)

---

## Project Overview

**Protoview Local**: Standalone version of the Protoview Next.js app for local Linux deployment.

- **Parent Project**: [Cilia_Structural_Proteomics](https://github.com/essebesse/Cilia_Structural_Proteomics)
- **Cloud Version**: https://ciliaaf3predictions.vercel.app/
- **Local Stack**: Next.js 14, SQLite, Local Node.js server
- **Data**: AF2/AF3 predictions with confidence scoring (iPTM, ipSAE, interface quality)

## CRITICAL: Implementation Status

**STATUS: DATABASE READY + MOLSTAR IMPLEMENTED - CODE MIGRATION NEEDED**

This repository contains:
- ✅ Codebase copied from cloud version
- ✅ **Pre-populated SQLite database** (`protoview.db` - 1.89 MB)
- ✅ **CIF structure files** (2,211 files - 1.7 GB)
- ✅ **MolStar 3D viewer** (fully implemented)
- ❌ **Code still uses PostgreSQL syntax** - THIS IS YOUR JOB

**DO NOT** run `npm run dev` until you complete the migration - it will fail with database connection errors.

## What Previous Claude Session Did

**Session Date**: 2025-11-29
**Accomplished**:
1. ✅ Collected CIF structure files (96% coverage)
2. ✅ Implemented MolStar 3D structure viewer
3. ✅ Created comprehensive documentation
4. ✅ Tested dev server (works with modified structure viewer)

**See**: `SESSION_SUMMARY.md` for complete details

## Implementation Guide

**🎯 Your primary guide**: `LOCAL_DEPLOYMENT_GUIDE.md`

This is a complete step-by-step guide written specifically for you (Claude) to implement the local deployment. It includes:
- What's already done
- What you need to do
- Code examples for every phase
- Common issues and solutions
- Verification checklists
- Expected timeline

### 7-Phase Implementation Plan

1. **Setup SQLite** - Replace @vercel/postgres with better-sqlite3
2. **Database Schema** - ✅ DONE (protoview.db exists)
3. **Update API Routes** - Modify 5 API route files
4. **Update Import Scripts** - Modify 37 import scripts
5. **Pre-populate Database** - ✅ DONE (protoview.db has all data)
6. **Documentation** - Update with your changes
7. **Testing** - Verify all functionality

**Phases 2 and 5 are already complete!** You need to do phases 1, 3, 4, 6, and 7.

**Estimated Effort**: 13-18 hours (reduced from original 15-21 hours)

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

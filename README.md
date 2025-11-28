# Protoview Local - Protein Interaction Visualization

**Local Deployment Version** - Runs on local Linux machines without cloud dependencies

## Overview

This is a standalone version of Protoview designed for local deployment. It uses SQLite instead of PostgreSQL/Neon, allowing the application to run completely offline on a local Linux server.

**Parent Project**: [Cilia_Structural_Proteomics](https://github.com/essebesse/Cilia_Structural_Proteomics) (Cloud version with Vercel + Neon)

## Key Differences from Cloud Version

| Feature | Cloud Version | Local Version |
|---------|---------------|---------------|
| Database | PostgreSQL (Neon) | SQLite |
| Deployment | Vercel | Local Node.js server |
| Setup | Quick (env vars) | Moderate (database setup) |
| Data Import | Full workflow | Full workflow |
| Internet | Required | Optional (after setup) |

## Implementation Status

**STATUS: PLANNED - DATABASE READY**

This repository contains:
- ✅ Codebase copied from cloud version
- ✅ **Pre-populated SQLite database** (`protoview.db` - 1.89 MB)
- ❌ Code migration NOT yet implemented (still uses PostgreSQL syntax)

The database is ready and contains all production data. The implementer needs to implement the code migration (see IMPLEMENTATION_PLAN.md).

**Implementation Plan**: See `IMPLEMENTATION_PLAN.md` for complete implementation details.

## Planned Implementation (6 Remaining Phases)

1. **Setup SQLite** - Replace @vercel/postgres with better-sqlite3
2. **Database Schema** - Convert PostgreSQL schema to SQLite (✅ Schema in protoview.db)
3. **Update API Routes** - Modify 5 API route files
4. **Update Import Scripts** - Modify 37 import scripts
5. ~~**Pre-populate Database**~~ - ✅ **DONE** (protoview.db included)
6. **Documentation** - Installation and import guides
7. **Testing** - Verify all functionality

**Estimated Effort**: 13-18 hours (reduced from 15-21 hours)

## Prerequisites (for IT Implementation)

- Node.js 18+
- Git
- Linux operating system
- Basic command line knowledge

## Installation (After Implementation)

```bash
# 1. Clone repository
git clone https://github.com/essebesse/Cilia_Structural_Proteomics_Local.git
cd Cilia_Structural_Proteomics_Local

# 2. Install dependencies
npm install

# 3. Database is pre-populated (protoview.db included)

# 4. Run development server
npm run dev

# 5. Open http://localhost:3000
```

## Key Features (Same as Cloud Version)

- Search by UniProt ID, gene name, or protein alias
- Interactive force-directed network graph
- Confidence level filtering (AF3 + AF2 by iPTM)
- Structural quality metrics (iPAE, ipLDDT)
- Smart result sorting (confidence → iPAE contacts → iPTM)
- Organism codes (Hs:, Cr:, Mm:, etc.)
- Cross-species protein lookup
- ChlamyFP integration with human homolog fallback
- Direct links to UniProt and ChlamyFP databases

## Database

✅ **Pre-populated SQLite database included!**

- **File**: `protoview.db` (1.89 MB)
- **1,808 proteins** across multiple organisms
- **2,754 interactions** (AF2 + AF3, v3 + v4 data)
- **7,612 protein aliases** for comprehensive search
- **3 protein complexes** with 57 complex interactions
- **17 experimentally validated** interactions (MS pulldown)

See `DATABASE_INFO.md` for complete details.

## Data Import (After Implementation)

The local version will support the same import workflows as the cloud version:

```bash
# Import new AF3 data
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
node db/incremental_organism_lookup.mjs
node db/fetch_aliases.mjs
node db/check_db.mjs
```

## Documentation

- **Implementation Plan**: `/u/au14762/.claude/plans/serene-honking-zebra.md`
- **Cloud Version Docs**: See original repository for workflow guides
- **Local Docs** (to be created):
  - `docs/LOCAL_DEPLOYMENT.md` - Complete setup guide
  - `docs/LOCAL_IMPORT_GUIDE.md` - Import workflow
  - `docs/SQLITE_SCHEMA.md` - Database schema reference

## Technical Details

### SQL Dialect Changes

**PostgreSQL → SQLite conversions**:
- Parameterized queries: `$1, $2` → `?, ?`
- Array parameters: `= ANY($n)` → `IN (?, ?)`
- Auto-increment: `SERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`
- Data types: `VARCHAR` → `TEXT`, `JSONB` → `TEXT` (JSON string)

### Files to be Modified

**New Files**:
- `lib/database.mjs` - Database abstraction layer
- `lib/db-adapter.mjs` - Import script adapter
- `db/schema.sql` - SQLite schema
- `protoview.db` - Pre-populated database

**Modified Files**:
- `package.json` - Dependencies (@vercel/postgres → better-sqlite3)
- `app/api/**/*.ts` - 5 API routes
- `db/*.mjs` - 37 import scripts

## For the implementer Person: Implementation Guide

1. **Read the Plan**: Start with `/u/au14762/.claude/plans/serene-honking-zebra.md`
2. **Follow Phases 1-7**: Step-by-step implementation instructions
3. **Test Each Phase**: Verify functionality before proceeding
4. **Document Issues**: Track any problems encountered

## Maintenance Strategy

**Keeping in sync with cloud version**:
- Periodically check main repository for bug fixes
- Cherry-pick relevant improvements
- Export fresh database from production if needed

## Support

For questions about the cloud version, see the parent repository:
- https://github.com/essebesse/Cilia_Structural_Proteomics

For local deployment questions, refer to:
- Implementation plan: `/u/au14762/.claude/plans/serene-honking-zebra.md`
- Cloud documentation (applies to features, not deployment)

## License

Same as parent project (Cilia_Structural_Proteomics)

---

**Created**: 2025-11-28
**Status**: Planning phase - Implementation pending
**Estimated Completion**: 15-21 hours of development work

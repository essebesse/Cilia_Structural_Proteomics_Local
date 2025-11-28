# IT Handoff Guide - Local Deployment Implementation

**Created**: 2025-11-28
**For**: implementer implementing local deployment of Protoview
**Estimated Time**: 15-21 hours of development work

## Quick Overview

This repository contains the codebase for a local deployment version of Protoview (protein interaction visualization web app). The code is currently copied from the cloud version and needs to be converted to use SQLite instead of PostgreSQL.

**Current Status**: Planning phase - NOT YET IMPLEMENTED
**Goal**: Convert from cloud deployment (Vercel + PostgreSQL) to local deployment (Node.js + SQLite)

## What You Need to Know

### Parent Project
- **Cloud version**: https://github.com/essebesse/Cilia_Structural_Proteomics
- **Live site**: https://ciliaaf3predictions.vercel.app/
- **This repo**: Local deployment fork with SQLite

### Technology Stack

**Current (Cloud)**:
- Next.js 14 + React 18
- PostgreSQL on Neon (cloud database)
- Vercel serverless deployment
- @vercel/postgres client

**Target (Local)**:
- Next.js 14 + React 18 (same)
- SQLite (single file database)
- Local Node.js server
- better-sqlite3 client

## Implementation Plan Location

**Complete 7-phase plan**: See `IMPLEMENTATION_PLAN.md` in this repository

The plan includes:
1. Setup SQLite
2. Database schema migration
3. Update 5 API routes
4. Update 37 import scripts
5. Pre-populate database
6. Documentation
7. Testing

## Key Files to Read First

1. **README.md** - Project overview and status
2. **IMPLEMENTATION_PLAN.md** - Complete step-by-step implementation guide
3. **CLAUDE.md** - Technical guidance and code examples

## Implementation Checklist

Phase-by-phase tasks:

### Phase 1: Setup (2-3 hours)
- [ ] Install better-sqlite3: `npm install better-sqlite3`
- [ ] Create `lib/database.mjs` (database abstraction layer)
- [ ] Create `db/schema.sql` (SQLite schema)

### Phase 2: Database Schema (1-2 hours)
- [ ] Convert PostgreSQL types to SQLite equivalents
- [ ] Test schema creation

### Phase 3: API Routes (3-4 hours)
- [ ] Update `app/api/interactions/[id]/route.ts`
- [ ] Update `app/api/baits/route.ts`
- [ ] Update `app/api/complexes/route.ts`
- [ ] Update `app/api/complex-interactions/[id]/route.ts`
- [ ] Update `app/api/debug/route.ts`

### Phase 4: Import Scripts (6-8 hours)
- [ ] Update all 37 files in `db/*.mjs`
- [ ] Test critical import scripts

### Phase 5: Database Population (1-2 hours)
- [ ] Export data from cloud PostgreSQL
- [ ] Import into local SQLite
- [ ] Create `protoview.db` file

### Phase 6: Documentation (2-3 hours)
- [ ] Write `docs/LOCAL_DEPLOYMENT.md`
- [ ] Write `docs/LOCAL_IMPORT_GUIDE.md`
- [ ] Write `docs/SQLITE_SCHEMA.md`

### Phase 7: Testing (1-2 hours)
- [ ] Test search functionality
- [ ] Test network visualization
- [ ] Test data import workflow

## Critical Code Changes

### Example 1: Parameterized Queries

**PostgreSQL (current)**:
```javascript
const result = await client.query(
  'SELECT * FROM proteins WHERE uniprot_id = $1',
  [proteinId]
);
```

**SQLite (target)**:
```javascript
const result = db.prepare(
  'SELECT * FROM proteins WHERE uniprot_id = ?'
).get(proteinId);
```

### Example 2: Array Parameters

**PostgreSQL (current)**:
```javascript
query += ` AND confidence = ANY($1)`;
params.push(['High', 'Medium']);
```

**SQLite (target)**:
```javascript
query += ` AND confidence IN (?, ?)`;
params.push('High', 'Medium');
```

### Example 3: JSONB → TEXT

**PostgreSQL (current)**:
```sql
experimental_validation JSONB
```

**SQLite (target)**:
```sql
experimental_validation TEXT
-- Store as JSON string: JSON.stringify(data)
-- Parse when reading: JSON.parse(row.experimental_validation)
```

## Files That Need Modification

**New files to create** (6 files):
- `lib/database.mjs` - Database abstraction layer
- `lib/db-adapter.mjs` - Import script adapter
- `db/schema.sql` - SQLite schema
- `docs/LOCAL_DEPLOYMENT.md`
- `docs/LOCAL_IMPORT_GUIDE.md`
- `docs/SQLITE_SCHEMA.md`

**Existing files to modify** (43 files):
- `package.json` - Change dependencies
- `app/api/**/*.ts` - 5 API route files
- `db/*.mjs` - 37 import script files

## Testing Strategy

After each phase:
1. **Unit test**: Test the modified components in isolation
2. **Integration test**: Test interaction with other components
3. **Functional test**: Test end-to-end user workflows

**Critical test cases**:
- Search by UniProt ID
- Search by gene name
- Network graph visualization
- Import new AF3 data
- Organism assignment
- Alias fetching

## Expected Results

When implementation is complete:

**Database**:
- Single file: `protoview.db` (~50-100MB)
- Pre-populated with ~1,339 proteins, ~2,267 interactions

**Installation**:
```bash
git clone https://github.com/essebesse/Cilia_Structural_Proteomics_Local.git
cd Cilia_Structural_Proteomics_Local
npm install
npm run dev
# Open http://localhost:3000
```

**Features** (same as cloud version):
- Protein search (UniProt ID, gene name, aliases)
- Interactive network visualization
- Confidence filtering
- Data import workflows

## Common Issues and Solutions

### Issue: "Cannot find module '@vercel/postgres'"
**Solution**: You're still using cloud code. Replace with better-sqlite3.

### Issue: "Syntax error near $1"
**Solution**: PostgreSQL parameterized query syntax. Change to `?` for SQLite.

### Issue: "Cannot read property 'experimental_validation'"
**Solution**: JSONB stored as TEXT. Parse with `JSON.parse()`.

### Issue: Database locked
**Solution**: SQLite locks entire database. Ensure only one write at a time.

## Questions and Support

### For Implementation Questions:
- Read `IMPLEMENTATION_PLAN.md` first
- Check examples in `CLAUDE.md`
- Review parent repo docs for feature details

### For Feature/Workflow Questions:
- Parent repository: https://github.com/essebesse/Cilia_Structural_Proteomics
- All feature documentation still applies

### For Database Schema Questions:
- See `db/schema.sql` (current PostgreSQL schema)
- Convert according to examples in `IMPLEMENTATION_PLAN.md`

## Deliverables

When complete, the repository should have:

1. **Working local deployment** - Runs on http://localhost:3000
2. **Pre-populated database** - `protoview.db` with current data
3. **Import scripts** - All 37 scripts working with SQLite
4. **Documentation** - Installation and usage guides
5. **Tests** - Verification that all features work

## Timeline Estimate

| Phase | Task | Estimated Time |
|-------|------|----------------|
| 1 | Setup SQLite | 2-3 hours |
| 2 | Database schema | 1-2 hours |
| 3 | API routes | 3-4 hours |
| 4 | Import scripts | 6-8 hours |
| 5 | Data population | 1-2 hours |
| 6 | Documentation | 2-3 hours |
| 7 | Testing | 1-2 hours |
| **Total** | | **15-21 hours** |

## Next Steps

1. **Read this guide** completely
2. **Read IMPLEMENTATION_PLAN.md** for detailed technical steps
3. **Start with Phase 1** (Setup SQLite)
4. **Work phase-by-phase**, testing as you go
5. **Document any issues** encountered
6. **Update README.md** when complete

## Contact

For questions about:
- **Implementation plan**: See `IMPLEMENTATION_PLAN.md`
- **Cloud version features**: See parent repo documentation
- **Project goals**: Contact repository owner

---

**Good luck with the implementation!**

Remember: Test after each phase, document issues, and refer to the detailed plan for step-by-step instructions.

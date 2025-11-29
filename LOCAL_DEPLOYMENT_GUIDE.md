# Local Deployment Guide - For Claude Implementation Session

**Purpose**: Guide for Claude Code to implement local SQLite deployment after cloning this repository

**Date**: 2025-11-29
**Target**: Future Claude session implementing local deployment on Linux server

---

## Quick Context

You are implementing a **local deployment** of Protoview (Next.js protein interaction viewer):
- **Current state**: Cloud version uses PostgreSQL (Neon), deployed on Vercel
- **Goal**: Convert to SQLite + local Node.js server for offline Linux deployment
- **Status**: Database ready, MolStar ready, **code migration needed**

## What's Already Done ✅

### 1. Pre-populated SQLite Database
- **File**: `protoview.db` (1.89 MB) ✅ INCLUDED IN GIT
- **Contents**: 1,808 proteins, 2,754 interactions, 7,612 aliases
- **Schema**: Already converted to SQLite format
- **Location**: Project root directory

### 2. CIF Structure Files
- **Files**: 2,211 CIF files (1.7 GB) ❌ NOT IN GIT
- **Location**: `structures/` directory
- **Manifest**: `cif_manifest.json` ✅ INCLUDED IN GIT
- **Coverage**: 96% of AF3 interactions (2,263/2,357)
- **How to get**: Run `node scripts/collect_cif_files.mjs` on server with AlphaFold data

### 3. MolStar 3D Structure Viewer
- **Status**: ✅ FULLY IMPLEMENTED
- **Components**: StructureViewer.tsx, viewer page, API route
- **Dependencies**: molstar@5.2.0, sass (already in package.json)
- **Works with**: Local filesystem (not Vercel Blob)
- **Testing**: See `QUICK_START_TESTING.md`

### 4. Documentation
- ✅ `IMPLEMENTATION_PLAN.md` - 7-phase implementation plan
- ✅ `DATABASE_INFO.md` - Database schema and statistics
- ✅ `MOLSTAR_IMPLEMENTATION_STATUS.md` - MolStar testing guide
- ✅ `SESSION_SUMMARY.md` - Previous session summary
- ✅ This guide

## What Needs to Be Done ❌

### Main Task: Code Migration (PostgreSQL → SQLite)

**Problem**: Code still uses `@vercel/postgres` and PostgreSQL syntax
**Solution**: Replace with `better-sqlite3` and SQLite syntax

**Files to modify**: 42 files total
- 5 API routes in `app/api/`
- 37 import scripts in `db/`
- `package.json` dependencies

**Estimated time**: 13-18 hours

---

## Step-by-Step Implementation Guide

### Phase 1: Setup and Planning (30 min)

#### 1.1 Understand Current State
```bash
# Check what's in the repository
ls -la
cat README.md
cat IMPLEMENTATION_PLAN.md
cat DATABASE_INFO.md
```

#### 1.2 Verify SQLite Database
```bash
# Database should already exist
ls -lh protoview.db
# Size: 1.89 MB

# Check contents
sqlite3 protoview.db ".tables"
# Expected: proteins, interactions, complex_interactions, complex_baits, protein_aliases

# Count records
sqlite3 protoview.db "SELECT COUNT(*) FROM proteins"
# Expected: 1808

sqlite3 protoview.db "SELECT COUNT(*) FROM interactions"
# Expected: 2754
```

#### 1.3 Check MolStar Files
```bash
# MolStar components should exist
ls -la components/StructureViewer.tsx
ls -la app/structure/[id]/page.tsx
ls -la app/api/structure/[id]/route.ts

# Check if structures directory exists
ls -la structures/
# If missing: Run collection script later
```

#### 1.4 Review Implementation Plan
```bash
cat IMPLEMENTATION_PLAN.md
# Read the full 7-phase plan
# Note: Phase 5 (database) is already complete
```

### Phase 2: Install SQLite (15 min)

#### 2.1 Update Dependencies
```bash
# Remove PostgreSQL client
npm uninstall @vercel/postgres

# Install SQLite
npm install better-sqlite3@11.7.0

# Verify
grep better-sqlite3 package.json
```

#### 2.2 Create Database Abstraction Layer

Create `lib/database.mjs`:
```javascript
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path (project root)
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'protoview.db');

// Singleton connection
let db = null;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH, {
      readonly: false,
      fileMustExist: true
    });

    // Enable foreign keys
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Helper: Execute query and return all rows
export function query(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

// Helper: Execute query and return first row
export function queryOne(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

// Helper: Execute INSERT/UPDATE/DELETE
export function execute(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}
```

#### 2.3 Test Database Connection
```bash
node -e "
import { getDb } from './lib/database.mjs';
const db = getDb();
const count = db.prepare('SELECT COUNT(*) as count FROM proteins').get();
console.log('Proteins:', count.count);
"
```

Expected output: `Proteins: 1808`

### Phase 3: Update API Routes (3-4 hours)

Update 5 API route files in `app/api/`:

#### 3.1 API Route: `/api/interactions/[id]`

**File**: `app/api/interactions/[id]/route.ts`

**Find and replace**:
```typescript
// OLD (PostgreSQL)
import { sql } from '@vercel/postgres';

const result = await sql`
  SELECT * FROM interactions
  WHERE bait_protein_id = ${baitId}
`;

// NEW (SQLite)
import { getDb } from '@/lib/database';

const db = getDb();
const result = db.prepare(`
  SELECT * FROM interactions
  WHERE bait_protein_id = ?
`).all(baitId);
```

**Key changes**:
- Replace `$1, $2` with `?, ?`
- Replace `= ANY($1)` with `IN (?, ?)` and spread array
- Replace `await sql` with `db.prepare().all()`
- Parse JSONB fields: `JSON.parse(row.experimental_validation)`

#### 3.2 API Route: `/api/baits`

Similar changes - see `IMPLEMENTATION_PLAN.md` for examples

#### 3.3 API Route: `/api/complexes`

Similar changes

#### 3.4 API Route: `/api/debug`

Similar changes

#### 3.5 API Route: `/api/structure/[id]` (ALREADY UPDATED)

✅ **Already uses local filesystem** - no changes needed!

This was modified during MolStar implementation to read from `structures/` directory.

### Phase 4: Update Import Scripts (6-8 hours)

Update 37 import scripts in `db/`:

#### 4.1 Create Import Adapter

Create `lib/db-adapter.mjs`:
```javascript
import { getDb } from './database.mjs';

export class DbAdapter {
  constructor() {
    this.db = getDb();
  }

  // Execute query with parameters
  query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return { rows: stmt.all(...params) };
  }

  // Insert and return inserted row
  insertAndReturn(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return { id: result.lastInsertRowid };
  }

  // Begin transaction
  begin() {
    this.db.exec('BEGIN');
  }

  // Commit transaction
  commit() {
    this.db.exec('COMMIT');
  }

  // Rollback transaction
  rollback() {
    this.db.exec('ROLLBACK');
  }
}
```

#### 4.2 Update Import Scripts Pattern

For each script in `db/*.mjs`:

**OLD**:
```javascript
import { sql } from '@vercel/postgres';

const result = await sql`
  INSERT INTO proteins (uniprot_id, gene_name)
  VALUES (${uniprot}, ${gene})
  RETURNING id
`;
const proteinId = result.rows[0].id;
```

**NEW**:
```javascript
import { getDb } from '../lib/database.mjs';

const db = getDb();
const result = db.prepare(`
  INSERT INTO proteins (uniprot_id, gene_name)
  VALUES (?, ?)
`).run(uniprot, gene);
const proteinId = result.lastInsertRowid;
```

#### 4.3 Scripts to Update (37 total)

Priority order:
1. `db/import_af3_json.mjs` - Main import script
2. `db/incremental_organism_lookup.mjs` - Organism assignment
3. `db/fetch_aliases.mjs` - Alias fetching
4. `db/check_db.mjs` - Database verification
5. All others in `db/` directory

**Tip**: Use search and replace for common patterns:
- `import { sql } from '@vercel/postgres'` → `import { getDb } from '../lib/database.mjs'`
- `await sql\`` → `db.prepare(`
- `$1, $2` → `?, ?`
- `.rows[0]` → direct object
- `result.rows` → `result` (already an array)

### Phase 5: Testing (2-3 hours)

#### 5.1 Test API Routes
```bash
npm run dev
# Visit http://localhost:3000

# Test searches:
# - WDR19 (gene name)
# - Q8NEZ3 (UniProt ID)
# - Hs:BBS7 (organism prefix)
```

Check:
- [ ] Search returns results
- [ ] Network graph renders
- [ ] Results table displays
- [ ] Protein links work
- [ ] Confidence filtering works
- [ ] No console errors

#### 5.2 Test MolStar Viewer
```bash
# Search: WDR19
# Click: "🔬 View 3D" on any AF3 interaction
```

Check:
- [ ] New window opens
- [ ] Structure loads
- [ ] Can rotate/zoom/pan
- [ ] No errors in console

See `QUICK_START_TESTING.md` for detailed testing checklist.

#### 5.3 Test Import Scripts
```bash
# Test database check
node db/check_db.mjs

# Test organism lookup (should do nothing - already populated)
node db/incremental_organism_lookup.mjs

# Test alias fetch (should do nothing - already populated)
node db/fetch_aliases.mjs
```

Expected: All scripts run without errors

### Phase 6: CIF Structure Files (1-2 hours)

#### 6.1 Check Current Status
```bash
ls -la structures/
wc -l < <(ls structures/*.cif)
# Expected: 2211 files

du -sh structures/
# Expected: 1.7G
```

#### 6.2 If Missing: Collect CIF Files
```bash
# Only run if structures/ is empty or incomplete
node scripts/collect_cif_files.mjs

# Expected output:
# Found 2357 AF3 interactions
# Found CIF files: 2263 (96.0%)
# Total size: 1.7 GB
```

#### 6.3 Verify Manifest
```bash
cat cif_manifest.json | grep -c '"found"'
# Expected: 2263

ls structures/*.cif | wc -l
# Expected: 2211 (some duplicates in manifest)
```

### Phase 7: Documentation (1-2 hours)

#### 7.1 Create Local Deployment Docs
```bash
# Create documentation directory
mkdir -p docs

# Document what was done
# - docs/IMPLEMENTATION_NOTES.md (what you changed)
# - docs/LOCAL_SETUP.md (how to set up on new machine)
# - docs/TROUBLESHOOTING.md (common issues)
```

#### 7.2 Update README
Update `README.md`:
- Change status to "✅ IMPLEMENTED"
- Add installation instructions
- Update prerequisites
- Add testing section

---

## Common Issues and Solutions

### Issue: "Cannot find module 'better-sqlite3'"
**Solution**:
```bash
npm install better-sqlite3@11.7.0
```

### Issue: "ENOENT: no such file or directory, open 'protoview.db'"
**Solution**: Database should be in project root
```bash
ls -la protoview.db
# If missing: Database wasn't committed (check git)
```

### Issue: "Error: no such column: experimental_validation"
**Solution**: Database schema outdated
```bash
sqlite3 protoview.db ".schema interactions"
# Check if experimental_validation column exists
```

### Issue: "SQLITE_ERROR: near '$1': syntax error"
**Solution**: PostgreSQL syntax not converted
```bash
# Find remaining PostgreSQL syntax
grep -r "\$1" app/api/
grep -r "\$2" app/api/
# Convert to ?, ?
```

### Issue: "TypeError: db.prepare is not a function"
**Solution**: Not using database wrapper correctly
```javascript
// WRONG
import db from './lib/database.mjs';

// RIGHT
import { getDb } from './lib/database.mjs';
const db = getDb();
```

---

## File Checklist

### Files That Must Exist
- [ ] `protoview.db` (1.89 MB) - SQLite database
- [ ] `cif_manifest.json` - Structure file manifest
- [ ] `package.json` - Dependencies (including molstar, sass)
- [ ] `components/StructureViewer.tsx` - MolStar component
- [ ] `app/structure/[id]/page.tsx` - Viewer page
- [ ] `app/api/structure/[id]/route.ts` - CIF server

### Files to Create
- [ ] `lib/database.mjs` - Database connection
- [ ] `lib/db-adapter.mjs` - Import helper (optional)
- [ ] `docs/IMPLEMENTATION_NOTES.md` - What you changed
- [ ] `docs/LOCAL_SETUP.md` - Setup instructions

### Files to Modify
- [ ] `package.json` - Replace @vercel/postgres with better-sqlite3
- [ ] `app/api/interactions/[id]/route.ts` - SQLite conversion
- [ ] `app/api/baits/route.ts` - SQLite conversion
- [ ] `app/api/complexes/route.ts` - SQLite conversion
- [ ] `app/api/debug/route.ts` - SQLite conversion
- [ ] `db/*.mjs` - 37 import scripts (SQLite conversion)

### Optional Files (Already Done)
- ✅ `structures/` - CIF files (run collection script if missing)
- ✅ MolStar components (already implemented)

---

## Verification Checklist

After implementation, verify:

### Database
- [ ] `protoview.db` exists and is readable
- [ ] Can query: `SELECT COUNT(*) FROM proteins` returns 1808
- [ ] Foreign keys work
- [ ] Indexes exist and perform well

### API Routes
- [ ] `/api/interactions/WDR19` returns results
- [ ] `/api/baits` returns list of baits
- [ ] `/api/complexes` returns complexes
- [ ] `/api/debug` returns database stats
- [ ] `/api/structure/5` returns CIF file

### Frontend
- [ ] Search by gene name works
- [ ] Search by UniProt ID works
- [ ] Search with organism prefix works (Hs:, Cr:)
- [ ] Network graph renders
- [ ] Results table displays
- [ ] Protein links work (UniProt, ChlamyFP)
- [ ] Confidence filtering works
- [ ] "View 3D" button appears for AF3 interactions

### MolStar Viewer
- [ ] Clicking "View 3D" opens new window
- [ ] Structure loads within 5 seconds
- [ ] Can interact with structure (rotate, zoom, pan)
- [ ] Chains have distinct colors
- [ ] Close button works
- [ ] No memory crashes on high-res displays

### Import Scripts
- [ ] `check_db.mjs` runs without errors
- [ ] `import_af3_json.mjs` can import new data
- [ ] `incremental_organism_lookup.mjs` runs
- [ ] `fetch_aliases.mjs` runs

---

## Quick Reference Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Test database
sqlite3 protoview.db "SELECT COUNT(*) FROM proteins"

# Collect CIF files (if needed)
node scripts/collect_cif_files.mjs

# Check database status
node db/check_db.mjs

# Test import (dry run)
node db/check_db.mjs

# Build for production
npm run build
npm start
```

---

## Expected Timeline

| Phase | Task | Time | Status |
|-------|------|------|--------|
| 1 | Setup and planning | 30 min | ⬜ TODO |
| 2 | Install SQLite | 15 min | ⬜ TODO |
| 3 | Update API routes | 3-4 hours | ⬜ TODO |
| 4 | Update import scripts | 6-8 hours | ⬜ TODO |
| 5 | Testing | 2-3 hours | ⬜ TODO |
| 6 | CIF files | 1-2 hours | ⬜ TODO |
| 7 | Documentation | 1-2 hours | ⬜ TODO |
| **Total** | | **13-18 hours** | |

---

## Resources

### Documentation
- `IMPLEMENTATION_PLAN.md` - Original 7-phase plan
- `DATABASE_INFO.md` - Database schema details
- `MOLSTAR_IMPLEMENTATION_STATUS.md` - MolStar testing guide
- `SESSION_SUMMARY.md` - Previous session summary

### External
- [better-sqlite3 docs](https://github.com/WiseLibs/better-sqlite3/wiki/API)
- [SQLite SQL syntax](https://www.sqlite.org/lang.html)
- [Next.js API routes](https://nextjs.org/docs/api-routes/introduction)
- [MolStar](https://molstar.org/)

---

## Success Criteria

Implementation is complete when:
- ✅ All API routes return correct data using SQLite
- ✅ Frontend works identically to cloud version
- ✅ Search, filtering, network graph all functional
- ✅ MolStar 3D viewer works for AF3 interactions
- ✅ Import scripts can add new data
- ✅ No PostgreSQL dependencies remain
- ✅ `npm run build` succeeds
- ✅ Production build runs on local server
- ✅ Documentation updated

---

## Notes for Claude

**Context for your session**:
- You are implementing a local deployment conversion
- Database is already populated (don't recreate!)
- MolStar is already implemented (don't modify!)
- Focus on PostgreSQL → SQLite code migration
- Follow the 7-phase plan in `IMPLEMENTATION_PLAN.md`
- Test thoroughly after each phase
- Document what you change

**Where to start**:
1. Read this guide completely
2. Read `IMPLEMENTATION_PLAN.md`
3. Verify database exists and is populated
4. Start with Phase 2 (Setup SQLite)

**Communication**:
- Ask user for clarification if anything is unclear
- Confirm you understand the scope before starting
- Update user on progress after each phase
- Report any issues or unexpected findings

Good luck! The hard parts (database + MolStar) are done. You just need to connect them with SQLite code. 🚀

---

**Last Updated**: 2025-11-29
**For**: Future Claude implementation session
**Status**: Ready for implementation

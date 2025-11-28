# Local Deployment Strategy for Cilia Structural Proteomics

## User Request
Enable local deployment of the Cilia_Structural_Proteomics Next.js app on a Linux machine:
- Downloadable from clean GitHub repository
- Compilable/runnable without Vercel or Neon cloud services
- Local database solution instead of cloud PostgreSQL
- Consider: SQLite, CSV/Excel files, or other local alternatives
- Decision: Separate git branch or main branch with dual support?

## Current Architecture (Cloud-based)
- **Frontend**: Next.js 14 (React 18)
- **Database**: PostgreSQL on Neon (cloud)
- **Deployment**: Vercel (serverless)
- **Data**: ~2,300 interactions, ~1,300 proteins, ~7,600 aliases
- **API Routes**: Server-side endpoints querying PostgreSQL

## Analysis Needed

### Phase 1: Explore Current Database Usage
Need to understand:
1. Where does the app query the database? (API routes, components)
2. What SQL queries are used? (complexity, PostgreSQL-specific features)
3. Data size and structure (feasibility of file-based storage)
4. Import scripts location and database dependencies

### Phase 2: Evaluate Database Options

**Option A: SQLite (Recommended)**
- Pros: SQL-compatible, single file, no server needed, works offline
- Cons: Need to migrate PostgreSQL schemas, SQL dialect differences
- Best for: Maintaining SQL queries with minimal changes

**Option B: JSON/CSV Files**
- Pros: Simple, no database engine needed, easy to version control
- Cons: Complex queries become code logic, slower for large datasets, no relational integrity
- Best for: Simple read-only access, small datasets

**Option C: Dual Database Support**
- Pros: Support both cloud (Neon) and local (SQLite)
- Cons: More complex, need abstraction layer, maintain two code paths
- Best for: Production deployment flexibility

### Phase 3: Branching Strategy

**Option 1: Separate `local-deployment` Branch**
- Pros: Clean separation, main branch stays Vercel-focused
- Cons: Divergence over time, duplicate maintenance
- Use when: Architectures are fundamentally different

**Option 2: Main Branch with Environment Detection**
- Pros: Single codebase, automatic cloud/local switching
- Cons: More complex configuration
- Use when: Can abstract database layer cleanly

**Option 3: Feature Flag / Config-based**
- Pros: Same branch, user chooses deployment type
- Cons: Requires good abstraction layer
- Use when: Want to support both use cases long-term

## Questions for User

Before planning implementation details, need clarification:

1. **Primary use case**: Is local deployment for:
   - Development/testing only?
   - Standalone deployment in labs/institutions without internet?
   - Distribution to other researchers?

2. **Data updates**: Will local deployments need to:
   - Import new AF3 data?
   - Stay read-only with current data?
   - Sync with cloud version?

3. **Complexity preference**:
   - Simpler: SQLite with minor code changes, separate branch
   - More flexible: Dual database support, same branch
   - Minimal: JSON/CSV export, read-only mode

4. **Installation complexity acceptable**:
   - Simple: Clone, npm install, npm run dev (prefer this)
   - Moderate: Clone, setup SQLite, import data, run
   - Advanced: Configure database, run migrations, etc.

## Recommended Approach (Preliminary)

**SQLite on a separate `local-deployment` branch**:
- Rationale: Clean, simple, maintains SQL structure
- Implementation: Replace @vercel/postgres with better-sqlite3
- Data: Include pre-populated SQLite database in repository
- Branching: Keep main for Vercel, local branch for standalone

## User Requirements (Confirmed)
- **Use case**: Standalone deployment in labs/institutions
- **Data import**: Full import capability needed
- **Installation complexity**: Moderate (database setup acceptable)
- **Branching**: Separate `local-deployment` branch

## Database Analysis Complete

### Current Database Usage
**API Routes** (5 files):
- `/api/interactions/[id]` - Main search endpoint with complex JOINs
- `/api/baits` - List all bait proteins
- `/api/complexes` - Complex proteins query
- `/api/complex-interactions/[id]` - Complex interaction search
- `/api/debug` - Database diagnostics

**SQL Features Used**:
- Standard SQL: SELECT, JOIN, WHERE, ILIKE pattern matching
- PostgreSQL-specific: `= ANY($n)` for array params, JSONB column (experimental_validation)
- Parameterized queries: $1, $2, etc.
- Multiple LEFT JOINs with protein_aliases table

**Import Scripts** (37 .mjs files in db/):
- All use @vercel/postgres with parameterized queries
- Import AF2/AF3 JSON data
- Organism lookup via UniProt API
- Gene name fetching
- Data validation and deduplication

## Recommended Implementation Plan

### Strategy: SQLite on `local-deployment` Branch

**Rationale**:
- Maintains SQL compatibility with minimal query changes
- Single-file database easy to distribute
- Full import script support
- Clean separation from cloud deployment

### Phase 1: Create Branch & Setup SQLite

**1.1 Create new branch**
```bash
git checkout -b local-deployment
```

**1.2 Update package.json**
- Remove: `@vercel/postgres`
- Add: `better-sqlite3` (synchronous SQLite3 for Node.js)

**1.3 Create database abstraction layer**
- New file: `lib/database.mjs`
- Export unified interface that works with SQLite
- Handle SQL dialect differences

### Phase 2: Database Schema Migration

**2.1 Convert PostgreSQL schema to SQLite**
- Create `db/schema.sql` with SQLite-compatible DDL
- Key changes needed:
  - SERIAL → INTEGER PRIMARY KEY AUTOINCREMENT
  - VARCHAR → TEXT
  - JSONB → TEXT (store as JSON string)
  - Array types → TEXT (comma-separated or JSON)

**2.2 Tables to create**:
- `proteins` (id, uniprot_id, gene_name, organism, organism_code, common_name)
- `interactions` (all columns including experimental_validation as TEXT)
- `complex_interactions` (complex bait interactions)
- `complex_baits` (complex bait definitions)
- `protein_aliases` (alias mappings)

### Phase 3: Update API Routes

**3.1 Replace database client**
```javascript
// Old: import { db } from '@vercel/postgres';
// New: import { getDb } from '@/lib/database';
```

**3.2 Convert queries**
- Change parameterized format: `$1, $2` → `?, ?` (SQLite style)
- Replace `= ANY($n)` with `IN (?)`
- Parse JSONB: `JSON.parse(row.experimental_validation)`
- Adjust array handling in queries

**3.3 Files to modify**:
- `app/api/interactions/[id]/route.ts`
- `app/api/baits/route.ts`
- `app/api/complexes/route.ts`
- `app/api/complex-interactions/[id]/route.ts`
- `app/api/debug/route.ts`

### Phase 4: Update Import Scripts

**4.1 Create database adapter for import scripts**
```javascript
// lib/db-adapter.mjs
export function executeSql(query, params) {
  // SQLite implementation
}
```

**4.2 Update all db/*.mjs files** (37 files):
- Replace `@vercel/postgres` with adapter
- Convert parameterized queries to `?` style
- Handle RETURNING clause differences
- Test each import workflow

**4.3 Priority import scripts**:
- `db/import_af3_json.mjs` - Main AF3 import
- `db/import_complex_af3_v4.mjs` - Complex imports
- `db/incremental_organism_lookup.mjs` - Organism assignment
- `db/fetch_aliases.mjs` - Gene name fetching
- `db/chlamyfp_gene_lookup.mjs` - ChlamyFP integration

### Phase 5: Pre-populate Database

**5.1 Export current Neon data**
```bash
# From main branch, export current database
node scripts/export_database_to_sqlite.mjs
# Creates: protoview.db (SQLite file with all data)
```

**5.2 Include in repository**
- Add `protoview.db` to `local-deployment` branch
- Update .gitignore to allow this file
- ~50-100MB file size (acceptable for Git)

**5.3 Alternative: Include SQL dump**
- Export as `db/seed_data.sql`
- Include import instructions in README

### Phase 6: Configuration & Documentation

**6.1 Environment configuration**
- No POSTGRES_URL needed
- DATABASE_PATH: `./protoview.db` (default)

**6.2 Update README for local branch**
```markdown
# Local Deployment Installation

## Prerequisites
- Node.js 18+
- Git

## Installation
1. Clone repository:
   git clone https://github.com/essebesse/Cilia_Structural_Proteomics.git
   cd Cilia_Structural_Proteomics
   git checkout local-deployment

2. Install dependencies:
   npm install

3. Database is pre-populated (protoview.db included)

4. Run development server:
   npm run dev

5. Open http://localhost:3000

## Importing New Data
See docs/LOCAL_IMPORT_GUIDE.md for instructions on:
- Importing AF3 predictions
- Adding organism lookups
- Fetching gene names
```

**6.3 Create documentation**
- `docs/LOCAL_DEPLOYMENT.md` - Complete setup guide
- `docs/LOCAL_IMPORT_GUIDE.md` - Import workflow
- `docs/SQLITE_SCHEMA.md` - Database schema reference

### Phase 7: Testing & Validation

**7.1 Test all features**
- Search functionality
- Network visualization
- Data table display
- Confidence filtering
- Complex protein queries

**7.2 Test import workflow**
- Import sample AF3 data
- Verify organism lookup
- Check gene name fetching

**7.3 Performance testing**
- Query speed with SQLite
- Network graph performance
- Large result sets

## SQL Dialect Conversion Examples

### Parameterized Queries
```javascript
// PostgreSQL
const result = await client.query(
  'SELECT * FROM proteins WHERE uniprot_id = $1',
  [proteinId]
);

// SQLite
const result = db.prepare(
  'SELECT * FROM proteins WHERE uniprot_id = ?'
).get(proteinId);
```

### Array Parameters
```javascript
// PostgreSQL
query += ` AND confidence = ANY($1)`;
params.push(['High', 'Medium']);

// SQLite
query += ` AND confidence IN (?, ?)`;
params.push('High', 'Medium');
```

### JSONB Handling
```javascript
// PostgreSQL - native JSONB
experimental_validation JSONB

// SQLite - TEXT with JSON parsing
experimental_validation TEXT
// Parse: JSON.parse(row.experimental_validation)
// Store: JSON.stringify(validationData)
```

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

**New Files**:
- `lib/database.mjs` - Database abstraction
- `lib/db-adapter.mjs` - Import script adapter
- `db/schema.sql` - SQLite schema
- `protoview.db` - Pre-populated database
- `docs/LOCAL_DEPLOYMENT.md` - Setup guide
- `docs/LOCAL_IMPORT_GUIDE.md` - Import guide
- `docs/SQLITE_SCHEMA.md` - Schema docs

**Modified Files**:
- `package.json` - Dependencies
- `app/api/**/*.ts` - 5 API routes
- `db/*.mjs` - 37 import scripts
- `README.md` - Installation instructions
- `.gitignore` - Allow protoview.db

## Estimated Effort

- Phase 1-2 (Setup & Schema): 2-3 hours
- Phase 3 (API Routes): 3-4 hours
- Phase 4 (Import Scripts): 6-8 hours
- Phase 5 (Data Export): 1-2 hours
- Phase 6-7 (Docs & Testing): 3-4 hours
- **Total**: 15-21 hours

## Maintenance Strategy

**Keeping branches in sync**:
1. Main branch: Continue cloud development
2. Local branch: Periodically merge main changes
3. Cherry-pick features as needed
4. Share database abstraction improvements

**Data synchronization**:
- Export fresh protoview.db from production periodically
- Include export script in main branch for easy updates

# 🚨 CRITICAL: Organism Assignment Corruption Fix

**Created**: 2025-09-30 18:30
**Severity**: HIGH - Database-wide organism contamination
**Impact**: All organism displays (Cr:/Hs: prefixes) are wrong

## PROBLEM SUMMARY

The organism assignment logic is **fundamentally broken** and has corrupted organism data for hundreds of proteins in the database. This affects all user-facing displays showing "Cr:" or "Hs:" prefixes.

### Root Cause
Migration script used **arbitrary UniProt ID pattern matching**:
```sql
-- WRONG LOGIC (in db/migrate_to_organisms.mjs):
WHEN uniprot_id LIKE 'Q9%' OR uniprot_id LIKE 'A8%' THEN 'Chlamydomonas reinhardtii'
WHEN uniprot_id ~ '^[A-Z][0-9][A-Z0-9]{3}[0-9]$' THEN 'Homo sapiens'
```

**Reality**: UniProt IDs are organism-agnostic! Q9* proteins exist in ALL species.

### Corruption Examples
**Human proteins incorrectly labeled as Chlamydomonas**:
- Q92526 (CCT6B) → Shows as "Cr:CCT6B" instead of "Hs:CCT6B"
- Q969F8 (KISS1R) → Shows as "Cr:KISS1R" instead of "Hs:KISS1R"
- Q93009 (USP7) → Shows as "Cr:USP7" instead of "Hs:USP7"
- Q9BZE0 (GLIS2) → Shows as "Cr:GLIS2" instead of "Hs:GLIS2"
- **+18 more from Lotte's human data alone**

### Database Corruption Scale
- **254 total proteins** assigned as Chlamydomonas
- **Many are actually human** (estimated 50-100+ incorrectly assigned)
- **645 proteins** assigned as Human (mix of correct/incorrect)
- **357 proteins** as Unknown (probably safest)

## IMMEDIATE FIXES REQUIRED

### 1. Fix Lotte's Human AF3 Data (URGENT)
All 110 interactions from Lotte's human AF3 study are corrupted:

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

node -e "
import { db } from '@vercel/postgres';
const client = await db.connect();

const result = await client.query(\`
  UPDATE proteins
  SET organism = 'Homo sapiens'::organism_type,
      organism_code = 'Hs'
  WHERE uniprot_id IN (
    SELECT DISTINCT unnest(ARRAY[
      bait.uniprot_id, prey.uniprot_id
    ])
    FROM interactions i
    JOIN proteins bait ON i.bait_protein_id = bait.id
    JOIN proteins prey ON i.prey_protein_id = prey.id
    WHERE i.source_path LIKE '%Lotte_Pedersen%'
  )
\`);

console.log(\`Fixed \${result.rowCount} proteins from Lotte's human data\`);
await client.release();
"
```

### 2. Create Comprehensive Organism Fix Script

**Create**: `db/fix_organism_assignments.mjs`

```javascript
#!/usr/bin/env node
import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

async function fixOrganismAssignments() {
  const client = await db.connect();

  try {
    console.log('**Fixing organism assignments...');

    // 1. Reset all to Unknown first
    console.log('Step 1: Reset all organisms to Unknown');
    await client.query(`
      UPDATE proteins
      SET organism = 'Unknown'::organism_type, organism_code = NULL
    `);

    // 2. TRUE Chlamydomonas proteins (high confidence)
    console.log('Step 2: Assign TRUE Chlamydomonas proteins');
    await client.query(`
      UPDATE proteins
      SET organism = 'Chlamydomonas reinhardtii'::organism_type,
          organism_code = 'Cr'
      WHERE uniprot_id LIKE 'AF2_%'       -- AF2 Chlamydomonas results
         OR uniprot_id LIKE 'Cre%'       -- Chlamydomonas gene names
         OR uniprot_id LIKE 'cre%'       -- Lowercase Chlamydomonas
    `);

    // 3. Source-based Human assignments
    console.log('Step 3: Assign source-based Human proteins');

    // Lotte's human AF3 data
    await client.query(`
      UPDATE proteins
      SET organism = 'Homo sapiens'::organism_type,
          organism_code = 'Hs'
      WHERE uniprot_id IN (
        SELECT DISTINCT unnest(ARRAY[bait.uniprot_id, prey.uniprot_id])
        FROM interactions i
        JOIN proteins bait ON i.bait_protein_id = bait.id
        JOIN proteins prey ON i.prey_protein_id = prey.id
        WHERE i.source_path LIKE '%Lotte_Pedersen%'
      )
    `);

    // BBS complex proteins (human)
    await client.query(`
      UPDATE proteins
      SET organism = 'Homo sapiens'::organism_type,
          organism_code = 'Hs'
      WHERE gene_name LIKE 'BBS%'
         OR uniprot_id IN ('Q8IWZ6', 'Q8N3I7', 'Q53HC0') -- Known BBS proteins
    `);

    // 4. Generate validation report
    const stats = await client.query(`
      SELECT organism, organism_code, COUNT(*) as count
      FROM proteins
      GROUP BY organism, organism_code
      ORDER BY count DESC
    `);

    console.log('\\n📊 Updated organism distribution:');
    for (const row of stats.rows) {
      console.log(\`  \${row.organism} (\${row.organism_code}): \${row.count}\`);
    }

    // 5. List proteins still needing UniProt lookup
    const needLookup = await client.query(`
      SELECT COUNT(*) as count
      FROM proteins
      WHERE organism = 'Unknown'
    `);

    console.log(\`\\n**  \${needLookup.rows[0].count} proteins still need UniProt API lookup\`);

  } finally {
    await client.release();
  }
}

fixOrganismAssignments()
  .then(() => console.log('**Organism fix completed'))
  .catch(err => console.error('**Fix failed:', err));
```

### 3. Create UniProt API Lookup System

**Create**: `db/uniprot_organism_lookup.mjs`

```javascript
#!/usr/bin/env node
import { db } from '@vercel/postgres';
import fetch from 'node-fetch';

const DELAY_MS = 1000; // 1 second between requests (UniProt rate limit)

async function lookupProteinOrganism(uniprotId) {
  try {
    const url = `https://rest.uniprot.org/uniprotkb/${uniprotId}.json`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = await response.json();
    const organism = data.organism?.scientificName;

    // Map to our organism types
    if (organism === 'Homo sapiens') return { organism: 'Homo sapiens', code: 'Hs' };
    if (organism === 'Chlamydomonas reinhardtii') return { organism: 'Chlamydomonas reinhardtii', code: 'Cr' };

    return { organism: 'Unknown', code: null };
  } catch (error) {
    console.error(\`Error looking up \${uniprotId}:\`, error.message);
    return null;
  }
}

async function batchOrganismLookup() {
  const client = await db.connect();

  try {
    // Get proteins that need lookup
    const unknownProteins = await client.query(`
      SELECT uniprot_id FROM proteins
      WHERE organism = 'Unknown'
      ORDER BY uniprot_id
    `);

    console.log(\`🔍 Looking up \${unknownProteins.rows.length} proteins via UniProt API...\`);

    let processed = 0;

    for (const protein of unknownProteins.rows) {
      const orgData = await lookupProteinOrganism(protein.uniprot_id);

      if (orgData) {
        await client.query(`
          UPDATE proteins
          SET organism = $1::organism_type, organism_code = $2
          WHERE uniprot_id = $3
        `, [orgData.organism, orgData.code, protein.uniprot_id]);
      }

      processed++;
      if (processed % 10 === 0) {
        console.log(\`  Processed \${processed}/\${unknownProteins.rows.length}...\`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

  } finally {
    await client.release();
  }
}

batchOrganismLookup()
  .then(() => console.log('**UniProt lookup completed'))
  .catch(err => console.error('**Lookup failed:', err));
```

### 4. Validation Commands

```bash
# Check current corruption extent
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# View organism distribution
node -e "
import { db } from '@vercel/postgres';
const client = await db.connect();
const stats = await client.query('SELECT organism, organism_code, COUNT(*) FROM proteins GROUP BY organism, organism_code ORDER BY count DESC');
console.log('Current organism distribution:');
stats.rows.forEach(row => console.log(\`  \${row.organism} (\${row.organism_code}): \${row.count}\`));
await client.release();
"

# Find questionable Chlamydomonas assignments
node -e "
import { db } from '@vercel/postgres';
const client = await db.connect();
const questionable = await client.query(\`
  SELECT uniprot_id, gene_name, organism_code
  FROM proteins
  WHERE organism = 'Chlamydomonas reinhardtii'
    AND NOT (uniprot_id LIKE 'AF2_%' OR uniprot_id LIKE 'Cre%' OR uniprot_id LIKE 'cre%')
  ORDER BY uniprot_id LIMIT 20
\`);
console.log('Questionable Chlamydomonas assignments:');
questionable.rows.forEach(p => console.log(\`  \${p.uniprot_id} - \${p.organism_code}:\${p.gene_name}\`));
await client.release();
"
```

## TESTING AFTER FIX

After running the fixes, test these searches in the web app:
- **"CETN3"** → Should show "Hs:CETN3" not "Cr:CETN3"
- **"CCT6B"** → Should show "Hs:CCT6B" not "Cr:CCT6B"
- **"ODA16"** → Should show "Cr:ODA16" (this should stay Chlamydomonas)
- **"BBS7"** → Should show "Hs:BBS7" not "Cr:BBS7"

## CURRENT WORKING STATUS

**Website**: https://ciliaaf3predictions.vercel.app/ **FUNCTIONAL
**Database**: 2,023 interactions, 1,256 proteins **POPULATED
**Search**: All searches work **FUNCTIONAL
**Organism Display**: CORRUPTED **NEEDS FIX

**Priority**: Fix organism assignments BEFORE adding more data to prevent further corruption.

## FILE LOCATIONS

**Scripts to run**: All in `/emcc/au14762/elo_lab/SCRIPTS/Global_Analysis/db/`
**Current working scripts**:
- `check_db.mjs` - Database diagnostics **
- `import_lotte_af3.mjs` - Import Lotte's data **
- `fix_lotte_data.mjs` - Fix confidence/PAE values **

**Scripts to create**:
- `fix_organism_assignments.mjs` - Fix organism corruption 🚨 URGENT
- `uniprot_organism_lookup.mjs` - Batch UniProt lookup
- `validate_organisms.mjs` - Validation reporting

**Database URL**:
```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

## NEXT SESSION PRIORITIES

1. **URGENT**: Run organism fix script (30 mins)
2. **HIGH**: Create UniProt lookup system (60 mins)
3. **MEDIUM**: Validate all organism assignments (30 mins)
4. **LOW**: Add additional protein data sources

**SUCCESS CRITERIA**:
- Lotte's proteins show as "Hs:" not "Cr:"
- True Chlamydomonas proteins (AF2_, Cre*) remain "Cr:"
- Human BBS proteins show as "Hs:"
- Web app displays correct organism prefixes
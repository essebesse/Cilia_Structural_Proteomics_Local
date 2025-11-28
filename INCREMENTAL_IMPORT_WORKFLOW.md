# Incremental AF3 Data Import Workflow

**Use this workflow when adding NEW data WITHOUT redoing everything!**

## ** IMPORTANT: Choose the Correct Import Type

### Single Bait Protein (A:B, A:C format)
**Use when:** One protein tested against multiple prey proteins
- Directory name: `Q8NEZ3_CCDC66/AF3/` or similar
- Bait chains: Single chain (A)
- Prey chains: Single chain (B or C)
- **Script:** `import_af3_json.mjs`

### Protein Complex (AB:C, ABC:D format)
**Use when:** Multiple proteins form a complex tested against prey
- Directory name: `Q96LB3_Q8WYA0_IFT74_81/AF3/` or similar
- Bait chains: Multiple chains (A, B) or (A, B, C)
- Prey chains: Single chain (C or D)
- **Script:** `import_complex_af3_json.mjs` or `import_complex.sh`

### AF2 Batch Import (multiple directories)
**Use when:** Importing multiple AF2 runs with JSON analysis files
- Each directory: `CrODA16/pulldown/high_confidence_af2_predictions_v2.json`
- **Script:** `batch_import_af2_json.mjs`
- **Important:** Confidence must be set to NULL for AF2 to display correctly

---

## Quick Reference - Single Bait Protein

```bash
# Set database connection
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# 1. Import BOTH v3 AND v4 JSON data (SINGLE BAIT)
# ** CRITICAL: You MUST import both files!
# - v3 provides iPTM-based confidence data (for v3 mode in web app)
# - v4 provides ipSAE-based confidence data (for v4 mode in web app)
# - They are separate analyses that may have different hits
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v4.json

# 2. Assign organisms (INCREMENTAL - only Unknown proteins)
node db/incremental_organism_lookup.mjs

# 3. Fetch aliases (INCREMENTAL - only new proteins)
node db/fetch_aliases.mjs

# 4. Populate gene names (INCREMENTAL - only NULL gene_name)
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# 5. Fetch Chlamydomonas gene names from ChlamyFP (for CRE* and AF2_Cre* proteins)
node db/chlamyfp_gene_lookup.mjs

# 6. Remove redundant gene names (Cre proteins not found in ChlamyFP)
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"

# 7. Validate
node db/check_db.mjs
```

## Quick Reference - Protein Complex

```bash
# AUTOMATED SCRIPT (RECOMMENDED):
./import_complex.sh /path/to/AF3_bait_prey_analysis_v3.json

# OR MANUAL STEPS:
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# 1. Import complex data
node db/import_complex_af3_json.mjs /path/to/AF3_bait_prey_analysis_v3.json

# 2. Assign organisms
node db/incremental_organism_lookup.mjs

# 3. Fetch aliases
node db/fetch_aliases.mjs

# 4. Populate gene names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# 5. Fetch Chlamydomonas gene names from ChlamyFP (for CRE* and AF2_Cre* proteins)
node db/chlamyfp_gene_lookup.mjs

# 6. Remove redundant gene names (Cre proteins not found in ChlamyFP)
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"

# 7. Update complex display names
node db/update_complex_display_names.mjs

# 8. Validate
node db/check_db.mjs
```

## Quick Reference - AF2 Batch Import

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# 1. Batch import AF2 JSON files (automatically handles multiple directories)
node db/batch_import_af2_json.mjs

# 2. Set confidence to NULL for AF2 (CRITICAL for display)
node -e "const { sql } = require('@vercel/postgres'); (async () => { await sql\`UPDATE interactions SET confidence = NULL WHERE alphafold_version = 'AF2' AND source_path LIKE '%AlphaPulldown%' AND confidence IS NOT NULL\`; console.log('**Set AF2 confidence to NULL'); })();"

# 3. Assign organisms
node db/incremental_organism_lookup.mjs

# 4. Fetch aliases
node db/fetch_aliases.mjs

# 5. Populate gene names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# 6. Fetch Chlamydomonas gene names from ChlamyFP (for CRE* and AF2_Cre* proteins)
node db/chlamyfp_gene_lookup.mjs

# 7. Remove redundant gene names (Cre proteins not found in ChlamyFP)
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"

# 8. Validate
node db/check_db.mjs
```

## Step-by-Step Guide

### Step 1: Import AF3 JSON Data **
```bash
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
```

**What it does:**
- Imports high-confidence interactions from AF3 JSON file
- Filters out "Very Low" confidence predictions automatically
- Includes iPAE and ipLDDT structural metrics
- **Does NOT modify existing data**

**Expected output:**
```
**Importing 27 actionable interactions
📈 Import completed: 27 interactions imported successfully
```

---

### Step 2: Assign Organisms (INCREMENTAL) **
```bash
node db/incremental_organism_lookup.mjs
```

**What it does:**
- **ONLY updates proteins with organism = 'Unknown'**
- **Preserves all existing Hs/Cr assignments**
- Applies high-confidence pattern matching first
- Queries UniProt API for remaining Unknown proteins
- Supports ANY organism automatically

**Expected time:**
- ~1-2 minutes for typical incremental updates
- ~1 second per new protein

**Key difference from old script:**
- **Old (`organism_agnostic_lookup.mjs`): Resets ALL proteins to Unknown
- **New (`incremental_organism_lookup.mjs`): Only processes Unknown proteins

---

### Step 3: Fetch Protein Aliases (INCREMENTAL) **
```bash
node db/fetch_aliases.mjs
```

**What it does:**
- Fetches gene names and synonyms from UniProt
- **Only processes proteins without existing aliases**
- Enables search by gene name (e.g., "CCDC92", "WDR19")
- Creates searchable aliases table

**Expected time:**
- ~1 second per new protein
- Skips proteins that already have aliases

---

### Step 4: Populate Gene Names (INCREMENTAL) **
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"
```

**What it does:**
- Copies gene names from aliases table to proteins table
- **Only updates proteins with NULL gene_name**
- Fixes "null" display in web interface

**Expected time:** < 1 second

---

### Step 5: Fetch Chlamydomonas Gene Names from ChlamyFP **
```bash
node db/chlamyfp_gene_lookup.mjs
```

**What it does:**
- Fetches real gene names from ChlamyFP database for Chlamydomonas proteins
- Handles both CRE* (uppercase, older format) and AF2_Cre* (newer AF2 imports) proteins
- Strips AF2_ prefix before lookup in ChlamyFP
- **Multi-tier homolog detection** (new features as of 2025-10-10):
  1. **Primary:** ChlamyFP gene name from field [1] or [2]
  2. **Secondary:** Human homolog from field [6] (e.g., "PLEKHA8, pleckstrin homology...")
  3. **Tertiary:** E-value homolog from field [8] (e.g., "Hs: 5E-03 (NABP2)")
     - **Only if E-value < 1e-2 (0.01)** to ensure quality
     - Extracted from patterns like "Hs: 5E-03 (NABP2)"
- **Robust ID normalization:**
  - Handles trailing dots: `Cre03.g208000.` → `Cre03.g208000`
  - Handles version numbers: `Cre12.g559300_4532.1` → `Cre12.g559300`
  - Handles uppercase: `CRE10_G443150_T1_2` → `Cre10.g443150.t1.2`
- **Only updates proteins with NULL or redundant gene names**

**Expected time:** ~30 seconds (2,316 ChlamyFP entries loaded)

**Results:**
- **Real gene names: `Cr:IFT46 (AF2_Cre05.g241637.t1.1)`
- **Human homologs: `Cr:NABP2 (Hs homolog)` - from E-value < 1e-2
- ** Not found: Leaves gene_name NULL (genuinely unannotated proteins)

---

### Step 6: Remove Redundant Gene Names **
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"
```

**What it does:**
- Removes redundant gene names from Cre proteins not found in ChlamyFP
- Example: Changes `gene_name = 'Cre05.g241637.t1.1'` to `NULL` if protein is `AF2_Cre05.g241637.t1.1`
- Prevents display like: `Cr:Cre05.g241637.t1.1 (AF2_Cre05.g241637.t1.1)` ← redundant!
- After cleanup, displays cleanly as: `Cr:AF2_Cre05.g241637.t1.1` ← no redundancy

**Expected time:** < 1 second

---

### Step 7: Validate Results **
```bash
node db/check_db.mjs
```

**What it does:**
- Shows database statistics
- Verifies organism assignments
- Confirms alias coverage
- Reports any issues

---

## Example: Adding Q68K27 Data

```bash
# Set database connection
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Import Q68K27 data (27 interactions from 1,546 total predictions)
node db/import_af3_json.mjs /emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Chlamydomonas/Q68K27_140/AF3/AF3_PD_analysis_v3.json

# Assign organisms incrementally (~2 minutes for 102 Unknown proteins)
node db/incremental_organism_lookup.mjs

# Fetch aliases for new proteins
node db/fetch_aliases.mjs

# Populate gene names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# Fetch Chlamydomonas gene names from ChlamyFP
node db/chlamyfp_gene_lookup.mjs

# Remove redundant gene names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"

# Validate
node db/check_db.mjs
```

**Results:**
- **27 new interactions imported
- **Q68K27 assigned as Chlamydomonas reinhardtii (Cr)
- **102 Unknown proteins processed (not 1,339!)
- **All existing data preserved

---

## Troubleshooting

### Problem: "No interactions found" after import
**Check:** Confidence filters in web app - ensure they're enabled

### Problem: Proteins show as "null"
**Solution:** Run Step 4 (gene name population)

### Problem: Proteins show as "Unknown" organism
**Solution:**
- If it's a valid UniProt ID: Run Step 2 (incremental organism lookup)
- If it's a CRE*_G* pattern: This is expected (not in UniProt)

### Problem: Search by gene name doesn't work
**Solution:** Run Step 3 (fetch aliases)

---

## Important Notes

****All steps are incremental** - They only process new/Unknown data
****Changes are immediate** - No git push or deployment needed
****Hard refresh browser** - Press Ctrl+Shift+R after database changes
**Never skip steps** - Each step is critical for full functionality

### ** CRITICAL for AF2 Imports

**AF2 confidence MUST be NULL:**
- Old working AF2 data has `confidence = NULL`
- New imports with explicit confidence values won't display
- Always set confidence to NULL after importing AF2 data
- Frontend filters AF2 differently than AF3

**Source paths are important:**
- Source path displays at bottom of web page showing data origin
- Use full path like `/emcc/au14762/elo_lab/AlphaPulldown/CrODA16/pulldown/...`
- Avoid generic paths like `/emcc/au14762/AF`
- `batch_import_af2_json.mjs` automatically uses correct paths

---

## Scripts Overview

| Script | Purpose | Processing Mode |
|--------|---------|----------------|
| `import_af3_json.mjs` | Import AF3 interactions | Incremental (new only) |
| `incremental_organism_lookup.mjs` | Assign organisms | **Incremental (Unknown only)** |
| `organism_agnostic_lookup.mjs` | Assign organisms | ****DESTRUCTIVE (resets all)** |
| `fetch_aliases.mjs` | Fetch protein aliases | Incremental (new only) |

**Key takeaway:** Always use `incremental_organism_lookup.mjs` for adding new data!

---

## Database Impact Summary

**Before Q68K27 Import:**
- 948 Homo sapiens (Hs)
- 210 Chlamydomonas reinhardtii (Cr)
- 180 Unknown
- Total: 1,339 proteins, 2,240 interactions

**After Q68K27 Import:**
- 948 Homo sapiens (Hs) ← **unchanged**
- 210 Chlamydomonas reinhardtii (Cr) ← **unchanged**
- 180 Unknown ← **unchanged** (CRE*_G* patterns)
- 1 Mus musculus (Mm) ← **new discovery**
- Total: 1,339 proteins, 2,267 interactions (+27 new)

**Time taken:**
- Total: ~5 minutes (vs. 12+ minutes with old workflow)
- Import: 30 seconds
- Organism lookup: 2 minutes (102 proteins vs. 1,339)
- Alias fetch: 2 minutes
- Gene name population: < 1 second
- Validation: 10 seconds

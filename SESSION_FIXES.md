# Session Fixes

## Latest Updates - October 4, 2025

### UI and Data Display Improvements
1. **Removed redundant Source Path column** - Full paths already shown in "Bait Protein Source Paths" section
2. **Fixed ChlamyFP protein links**:
   - Correct ID format conversion: `CRE11_G475000_T1_1` → `Cre11.g475000.t1.1`
   - Proper routing: UniProt IDs → UniProt, CRE gene IDs → ChlamyFP
   - Links now open correct protein detail pages
3. **Human homolog fallback for missing gene names**:
   - CRE proteins without Chlamydomonas gene names now show human homolog
   - Example: `CRE12_G519450_T1_1` → "PLEKHA8 (Hs homolog)" instead of "null"
   - 8 proteins updated with human homolog names
4. **Improved result sorting**:
   - Primary: Confidence level (Very High → Worth Investigating → Low iPTM)
   - Secondary: iPAE <3Å contacts (better structural contacts first)
   - Tertiary: iPTM score
   - AF2 predictions now grouped by iPTM into confidence categories

### Scripts Added
- `db/chlamyfp_gene_lookup.mjs` - ChlamyFP integration with human homolog fallback

---

## CCDC92 and CCDC198 Data Issues - October 1, 2025

## Problems Identified

1. **CCDC92 and CCDC198 not searchable** - Searching for these proteins returned no or incomplete results
2. **Proteins displaying as "null"** - Gene names missing in web interface
3. **Missing structural metrics** - iPAE and ipLDDT values showing as N/A for new entries

## Root Causes

### 1. Confidence Level Mismatch
- **Old entries** (from `dual_parser.mjs`): Used full descriptive names
  - "Very High Confidence"
  - "Worth Investigating"
  - "Low iPTM - Proceed with Caution"
- **New entries** (from `import_af3_json.mjs`): Used abbreviated names
  - "Very High"
  - "High"
  - "Medium"
- **Impact**: Frontend filters couldn't match new entries, so they appeared invisible in searches

### 2. Missing Gene Names
- **Root cause**: `import_af3_json.mjs` doesn't populate the `gene_name` column in the `proteins` table
- Gene names existed in `protein_aliases` table but not in main `proteins` table
- **Impact**: 36 proteins displayed as "null" in the web interface, including CCDC198 itself

### 3. Missing Structural Metrics
- **Root cause**: Original `import_af3_json.mjs` script didn't extract iPAE and ipLDDT data from JSON
- JSON files contained complete data: `contacts_pae3`, `contacts_pae6`, `mean_interface_plddt`
- **Impact**: 217 interactions missing structural quality metrics

## Solutions Implemented

### 1. Fixed Confidence Levels (Database)
```bash
# Updated existing CCDC92/CCDC198 entries to use correct names
UPDATE interactions SET confidence = 'Very High Confidence' WHERE confidence = 'Very High' AND source_path LIKE '%Lotte_Pedersen%';
UPDATE interactions SET confidence = 'Worth Investigating' WHERE confidence = 'High' AND source_path LIKE '%Lotte_Pedersen%';
UPDATE interactions SET confidence = 'Low iPTM - Proceed with Caution' WHERE confidence = 'Medium' AND source_path LIKE '%Lotte_Pedersen%';
```
**Result**: 217 interactions updated with correct confidence levels

### 2. Fixed Confidence Levels (Script)
**File**: `db/import_af3_json.mjs`
**Change**: Modified lines 70-81 to keep full descriptive names instead of abbreviating
```javascript
// Before:
confidence = 'Very High';  // **

// After:
confidence = 'Very High Confidence';  // **
```
**Result**: Future imports will use correct confidence level names

### 3. Populated Gene Names (Database)
```bash
# Copied gene names from aliases table to proteins table
UPDATE proteins p SET gene_name = pa.alias_name
FROM protein_aliases pa
WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL;
```
**Result**: 54 proteins updated with gene names, including Q9NVL8 (CCDC198)

### 4. Added Structural Metrics Extraction (Script)
**File**: `db/import_af3_json.mjs`
**Change**: Added lines 120-123 and updated INSERT statement to include:
```javascript
const contactsPaeLt3 = prediction.contacts_pae3 || null;
const contactsPaeLt6 = prediction.contacts_pae6 || null;
const interfacePlddt = prediction.mean_interface_plddt || null;
```
**Result**: Future imports will include structural metrics automatically

### 5. Backfilled Structural Metrics (Database)
**Script**: Created `db/backfill_structural_metrics.mjs`
```bash
# Populated iPAE and ipLDDT for existing CCDC92/CCDC198 entries
node db/backfill_structural_metrics.mjs
```
**Result**: 217 interactions updated with structural metrics from JSON files

## Files Modified

1. **`db/import_af3_json.mjs`** - Fixed confidence levels + added structural metrics extraction
2. **`db/backfill_structural_metrics.mjs`** - NEW script for backfilling structural data
3. **`CLAUDE.md`** - Updated documentation with:
   - Correct confidence level mappings
   - New Step 4 for gene name population
   - Troubleshooting section
   - References to backfill script

## Verification

### Database Stats After Fixes
```sql
-- CCDC92 (Q53HC0): 83 interactions as bait, 3 as prey
-- CCDC198 (Q9NVL8): 134 interactions as bait, 2 as prey

-- Confidence distribution (Lotte_Pedersen data):
--   Low iPTM - Proceed with Caution: 258 interactions
--   Worth Investigating: 42 interactions
--   Very High Confidence: 27 interactions

-- All entries now have:
--   **Correct confidence levels
--   **Gene names populated
--   **Structural metrics (iPAE, ipLDDT)
```

### Web Interface Verification
- **Search "CCDC92" returns 85 total interactions (83 as bait, 2 as prey)
- **Search "CCDC198" returns 134 interactions with no "null" values
- **All interactions show iPAE <3Å, iPAE <6Å, and ipLDDT values
- **Proteins display with correct gene names (e.g., "Hs:CCDC198", "Hs:TUBA1B")

## Workflow for Future Imports

Complete 5-step process documented in CLAUDE.md:

```bash
# 1. Import JSON data
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json

# 2. Assign organisms
node db/organism_agnostic_lookup.mjs

# 3. Fetch aliases
node db/fetch_aliases.mjs

# 4. Populate gene names (NEW - CRITICAL)
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# 5. Validate
node db/check_db.mjs
```

## Lessons Learned

1. **Always verify confidence level names** - Frontend filters must match database values exactly
2. **Check all display fields** - gene_name, organism_code, etc. should be populated for proper display
3. **Extract all available metrics** - Don't leave useful data (iPAE, ipLDDT) behind
4. **Test with actual searches** - Database content verification alone isn't enough
5. **Document fixes immediately** - Complex multi-table operations need clear documentation

## Scripts Ready for Reuse

- **`db/import_af3_json.mjs` - Updated with all fixes
- **`db/backfill_structural_metrics.mjs` - Available for future backfills if needed
- **CLAUDE.md - Complete workflow documented

# Q68K27 Import Session - Oct 3, 2025

## Summary

Successfully imported Q68K27 (protein 140) Chlamydomonas data and created incremental import workflow to prevent future issues.

## Data Imported

**Source:** `/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Chlamydomonas/Q68K27_140/AF3/AF3_PD_analysis_v3.json`

**Statistics:**
- Total predictions in JSON: **1,546**
- Actionable interactions imported: **27**
- Confidence distribution:
  - Worth Investigating: 3
  - Low iPTM - Proceed with Caution: 24
  - Very Low (skipped): 1,519

**Database Impact:**
- Before: 1,339 proteins, 2,240 interactions
- After: 1,339 proteins, 2,267 interactions (+27)
- Q68K27 assigned as Chlamydomonas reinhardtii (Cr)

## Critical Problem Discovered

### The Issue

The organism assignment script (`organism_agnostic_lookup.mjs`) was **destructive**:
- Reset ALL 1,339 proteins to "Unknown" every time it ran
- Would timeout after 10 minutes
- When restarted, would reset everything AGAIN
- Created an infinite loop of destruction

### The Impact

During this session:
- Script ran 2-3 times, each time resetting all organisms
- Each run processed ~560/670 proteins before timeout
- Lost ~12 minutes each time
- Could have corrupted the database if not caught

### The Solution

Created **incremental_organism_lookup.mjs**:
- Only processes proteins with organism = "Unknown"
- Preserves ALL existing Hs/Cr/Mm assignments
- Processes ~100 proteins instead of 1,339
- Completes in ~2 minutes instead of 12+
- Safe to run multiple times

## Files Created

1. **db/incremental_organism_lookup.mjs** - New incremental organism assignment script
2. **INCREMENTAL_IMPORT_WORKFLOW.md** - Complete step-by-step guide for adding new data
3. **Q68K27_IMPORT_SESSION.md** - This file

## Files Modified

1. **CLAUDE.md** - Updated with incremental workflow, marked old workflow as destructive
2. **README.md** - Updated quick start to use incremental workflow
3. **IMPORT_WORKFLOW.md** - Added warning about destructive behavior
4. **db/organism_agnostic_lookup.mjs** - Commented out reset step (for this session only)

## Workflow Comparison

### Old Workflow (DESTRUCTIVE)
```bash
node db/import_af3_json.mjs /path/to/file.json
node db/organism_agnostic_lookup.mjs  # **Resets ALL organisms
node db/fetch_aliases.mjs
node -e "..."  # Gene name population
node db/check_db.mjs
```

**Time:** 12+ minutes (often times out)
**Risk:** Resets all existing data

### New Workflow (INCREMENTAL)
```bash
node db/import_af3_json.mjs /path/to/file.json
node db/incremental_organism_lookup.mjs  # **Only Unknown proteins
node db/fetch_aliases.mjs
node -e "..."  # Gene name population
node db/check_db.mjs
```

**Time:** 2-5 minutes
**Risk:** None - preserves existing data

## Database State After Import

**Organism Distribution:**
- Homo sapiens (Hs): 948 proteins ← preserved
- Chlamydomonas reinhardtii (Cr): 210 proteins ← preserved
- Unknown: 180 proteins (CRE*_G* patterns - expected)
- Mus musculus (Mm): 1 protein

**Alias Coverage:**
- Total aliases: 7,597 (+2,487 new)
- Proteins with aliases: 1,533

**Interactions:**
- Total: 2,267 (+27 new Q68K27 interactions)
- AF3: 1,658 + 27 = 1,685
- AF2: 224

## Verification

Q68K27 is fully searchable:
- **Web API returns 27 interactions
- **Organism code: Cr (Chlamydomonas reinhardtii)
- **Structural metrics: iPTM, iPAE, ipLDDT present
- **Confidence levels correct

**Test URL:** https://ciliaaf3predictions.vercel.app/api/interactions/Q68K27

## Lessons Learned

1. **Always check for destructive operations** - Scripts that reset data should be clearly marked
2. **Incremental is better** - Only process what's needed, not everything
3. **Test with small datasets first** - Would have caught the timeout issue earlier
4. **Document script behavior** - Make it clear which scripts are safe vs. destructive
5. **Use timeouts wisely** - 10 minutes was too short for full rebuild, but unnecessary for incremental

## Recommendations for Future

1. **Always use incremental workflow** for adding new data
2. **Rename scripts** to make purpose clear:
   - `organism_agnostic_lookup.mjs` → `full_organism_rebuild.mjs` (to indicate destructive)
   - `incremental_organism_lookup.mjs` → Keep as-is (clear purpose)
3. **Add confirmation prompts** to destructive scripts
4. **Consider database backups** before full rebuilds

## Next Steps

For the next import, simply follow:
```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Complete workflow in ~5 minutes
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
node db/incremental_organism_lookup.mjs
node db/fetch_aliases.mjs
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"
node db/check_db.mjs
```

See **INCREMENTAL_IMPORT_WORKFLOW.md** for full documentation.

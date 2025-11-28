# AF3 Data Import - Legacy Full Rebuild Workflow

**WARNING: This workflow resets ALL organism assignments!**

**** For adding new data, use [INCREMENTAL_IMPORT_WORKFLOW.md](INCREMENTAL_IMPORT_WORKFLOW.md) instead!**

This workflow should ONLY be used for:
- Complete database rebuilds from scratch
- Fixing widespread data corruption
- Initial database population

---

## Prerequisites
```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

## Complete 5-Step Workflow

### Step 1: Import JSON Data
```bash
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
```
**What it does**:
- Imports high-confidence interactions from AF3 JSON file
- Filters out "Very Low" confidence predictions automatically
- Now includes iPAE and ipLDDT structural metrics

**Expected output**: "**Importing X actionable interactions"

---

### Step 2: Assign Organisms
```bash
node db/organism_agnostic_lookup.mjs
```
**What it does**:
- Queries UniProt API for organism information
- Assigns organism codes (Hs:, Cr:, Mm:, etc.)
- Supports ANY organism, not just Human/Chlamydomonas

**Expected time**: ~12 minutes for 700 proteins

---

### Step 3: Fetch Protein Aliases
```bash
node db/fetch_aliases.mjs
```
**What it does**:
- Downloads gene names and synonyms from UniProt
- Enables search by gene name (e.g., "CCDC92", "WDR19")
- Creates searchable aliases table

**Expected time**: ~1 second per new protein

---

### Step 4: Populate Gene Names
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"
```
**What it does**:
- Copies gene names from aliases table to proteins table
- Fixes "null" display in web interface

**Expected time**: < 1 second

---

### Step 5: Validate Results
```bash
node db/check_db.mjs
```
**What it does**:
- Shows database statistics
- Verifies organism assignments
- Confirms alias coverage

---

## Troubleshooting

### Problem: "No interactions found"
**Check**: Confidence filters in web app - make sure they're enabled

### Problem: Proteins show as "null"
**Solution**: Run Step 4 (gene name population)

### Problem: Missing iPAE/ipLDDT
**Solution**:
- New imports: Use updated `import_af3_json.mjs`
- Old imports: Run `node db/backfill_structural_metrics.mjs`

### Problem: Search by gene name doesn't work
**Solution**: Run Step 3 (fetch aliases)

---

## Quick Check Commands

```bash
# Count interactions for a protein
node -e "const { sql } = require('@vercel/postgres'); (async () => { const r = await sql\`SELECT COUNT(*) FROM interactions i JOIN proteins p ON i.bait_protein_id = p.id WHERE p.uniprot_id = 'Q53HC0'\`; console.log(r.rows[0]); })();"

# Check if protein has aliases
node -e "const { sql } = require('@vercel/postgres'); (async () => { const r = await sql\`SELECT * FROM protein_aliases pa JOIN proteins p ON pa.protein_id = p.id WHERE p.uniprot_id = 'Q53HC0'\`; console.log(r.rows); })();"

# Verify structural metrics
node -e "const { sql } = require('@vercel/postgres'); (async () => { const r = await sql\`SELECT contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt FROM interactions i JOIN proteins p ON i.bait_protein_id = p.id WHERE p.uniprot_id = 'Q53HC0' LIMIT 1\`; console.log(r.rows[0]); })();"
```

---

## Important Notes

**All 5 steps are CRITICAL** - Skipping any step will cause issues:
- Skip Step 2 → No organism codes (Hs:, Cr:)
- Skip Step 3 → Gene name search won't work
- Skip Step 4 → Proteins show as "null"
- Skip Step 5 → Can't verify success

****Changes are immediate** - No git push or deployment needed. Data goes straight to production database.

****Hard refresh browser** - Press Ctrl+Shift+R after database changes to clear cache

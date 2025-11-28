# ChlamyFP Gene Lookup - Enhanced Features (2025-10-10)

This document summarizes the enhanced homolog detection capabilities added to `db/chlamyfp_gene_lookup.mjs`.

## What's New

The ChlamyFP lookup script now has **multi-tier homolog detection** with robust ID normalization, ensuring maximum coverage for Chlamydomonas protein annotation.

## Homolog Detection Hierarchy

When looking up a Chlamydomonas protein, the script tries three sources in order:

### 1. Primary: ChlamyFP Gene Name (Field [1] or [2])
**Source:** ChlamyFP database fields [1] or [2]
**Example:** `AF2_Cre05.g241637.t1.1` → `IFT46`

- Uses real Chlamydomonas gene names from ChlamyFP
- Checks both "Gene and Aliases" (field [1]) and "ChlamyFPv5 Annotation" (field [2])
- No homolog suffix needed - these are real Cr gene names

### 2. Secondary: Human Homolog (Field [6])
**Source:** ChlamyFP "Human Homolog" field [6]
**Example:** `CRE12_G519450_T1_1` → `PLEKHA8 (Hs homolog)`

- Extracts gene name from patterns like "PLEKHA8, pleckstrin homology..."
- Adds "(Hs homolog)" suffix to indicate it's a human homolog
- Used when no Chlamydomonas gene name exists

### 3. Tertiary: E-value Homolog (Field [8])
**Source:** ChlamyFP "Evalues" field [8]
**Example:** `AF2_Cre03.g208000.` → `NABP2 (Hs homolog)`

**NEW FEATURE** - Parses E-value data to find high-quality homologs:
- Pattern: `"Hs: 5E-03 (NABP2)"` → extracts `NABP2`
- **E-value threshold: < 1e-2 (0.01)**
- Only assigns homolog if E-value is significant
- Adds "(Hs homolog)" suffix

**Quality Control:**
```javascript
// E-value examples:
5E-03 (0.005) → **Use (< 0.01)
7E-02 (0.07)  → **Skip (> 0.01)
5E-01 (0.5)   → **Skip (> 0.01)
```

## ID Normalization Features

The script now handles various edge cases in protein ID formats:

### Trailing Dots
**Problem:** `AF2_Cre03.g208000.` (note the trailing dot)
**Normalized to:** `Cre03.g208000`
**Matches:** `Cre03.g208000.t1.1` **

### Version Numbers
**Problem:** `Cre12.g559300_4532.1` (unusual version number)
**Normalized to:** `Cre12.g559300`
**Matches:** `Cre12.g559300.t1.2` **

### Uppercase Format
**Problem:** `CRE10_G443150_T1_2` (all uppercase)
**Normalized to:** `Cre10.g443150.t1.2`
**Matches:** `Cre10.g443150.t1.2` **

## Coverage Statistics

From our testing session (2025-10-10):

- **27 proteins** filled with E-value homologs (E-value < 0.01)
- **1 human protein** fixed (Q9HAT0 → ROPN1)
- **11 proteins** remain NULL (genuinely unannotated - no good homologs)

**Final NULL status:**
- 11 Chlamydomonas proteins (in ChlamyFP but empty names, no good homologs)
- 0 Human proteins **

## Integration with Workflow

The enhanced script is already integrated into the standard workflow:

### Quick Reference
```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Import new data
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json

# Assign organisms
node db/incremental_organism_lookup.mjs

# Fetch aliases
node db/fetch_aliases.mjs

# Populate gene names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# ** Enhanced ChlamyFP lookup (includes E-value homologs!)
node db/chlamyfp_gene_lookup.mjs

# Clean redundant names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"

# Validate
node db/check_db.mjs
```

## Technical Details

### ChlamyFP Database Structure
- **Field [0]:** Protein ID (e.g., `Cre03.g208000.t1.1`)
- **Field [1]:** Gene and Aliases (e.g., `IFT46; Dyf-1`)
- **Field [2]:** ChlamyFPv5 Annotation
- **Field [6]:** Human Homolog (e.g., `PLEKHA8, pleckstrin homology...`)
- **Field [8]:** E-values (e.g., `● Hs: 5E-03 (NABP2) ● Mm: 5E-03 (Nabp2) ...`)

### Code Implementation
Location: `db/chlamyfp_gene_lookup.mjs`

Key functions:
- **`findGeneNameInChlamyFP()`** - Main lookup logic with 3-tier fallback
- **Normalization pipeline:**
  1. Strip `AF2_` prefix
  2. Remove version numbers (`_4532.1`)
  3. Remove trailing dots
  4. Lowercase everything after `Cre##.`
  5. Convert underscores to dots

### Performance
- **Processing time:** ~30 seconds for full lookup
- **ChlamyFP database:** 2,316 protein entries
- **API calls:** None (uses cached ChlamyFP data)
- **Incremental:** Only processes proteins with NULL/redundant gene names

## Future Sessions

Next time you import new data, simply run the standard workflow. The enhanced ChlamyFP lookup will automatically:

**Find Chlamydomonas gene names from ChlamyFP
**Fall back to human homologs from field [6]
**Extract E-value homologs from field [8] (if E-value < 0.01)
**Handle trailing dots, version numbers, and uppercase formats
**Only update NULL/redundant gene names (safe, incremental)

No extra steps needed - it's all automatic! **

## Examples to Test

Search these proteins on the web interface to verify the new homolog names:

**E-value Homologs (New!):**
- `Cre03.g208000` → NABP2 (Hs homolog)
- `Cre01.g043850` → MAP3K20 (Hs homolog)
- `Cre10.g433600` → MTHFR (Hs homolog)
- `Cre10.g463026` → KIF7 (Hs homolog)

**Field [6] Homologs:**
- `CRE12_G519450` → PLEKHA8 (Hs homolog)

**ChlamyFP Gene Names:**
- `Cre05.g241637` → IFT46
- `Cre12.g559300` → PF27

---

**Last Updated:** 2025-10-10
**Script Version:** Enhanced with E-value homolog detection
**Maintained by:** Automated documentation from session improvements

# AlphaFold 3 v4 Analysis Import Guide (ipSAE Scoring)

**Complete workflow for importing ipSAE-scored AF3 predictions into ProtoView**

---

## 📋 Table of Contents

1. [What's New in v4](#whats-new-in-v4)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Detailed Workflow](#detailed-workflow)
5. [Understanding ipSAE](#understanding-ipsae)
6. [Troubleshooting](#troubleshooting)
7. [Advanced Usage](#advanced-usage)

---

## 🆕 What's New in v4

### ipSAE Scoring System

**Reference:** Dunbrack 2025, bioRxiv doi:10.1101/2025.02.10.637595

ipSAE (interface Predicted Surface Area Embedding) provides a **more robust metric** than iPTM for interaction confidence:

- **Less sensitive to disordered regions**
- **Better handling of multidomain proteins**
- **Fewer false positives**
- **Clear confidence tiers based on benchmarks**

### Confidence Tiers (at 10Å PAE cutoff)

| Tier | ipSAE Range | Description | Reliability |
|------|-------------|-------------|-------------|
| **High** | > 0.7 | Strong evidence | Virtually no false positives |
| **Medium** | 0.5-0.7 | Very promising | Likely genuine interaction |
| **Low** | 0.3-0.5 | Ambiguous | Requires visual inspection |
| **Very Low** | < 0.3 | Likely false positive | Excluded from output |

### Database Schema Changes

New columns added to `interactions` and `complex_interactions` tables:
- `ipsae` (FLOAT) - ipSAE score
- `ipsae_confidence` (ENUM) - High/Medium/Low
- `ipsae_pae_cutoff` (FLOAT) - PAE cutoff used (typically 10.0)
- `analysis_version` (VARCHAR) - 'v3' or 'v4'

---

## 📦 Prerequisites

### 1. Reanalyzed AF3 Data

You must have run the v4 analysis script on your AF3 predictions:

```bash
python3 /emcc/au14762/elo_lab/SCRIPTS/AF3_PD_analysis_v4.py \
  --input_dir /path/to/AF3/predictions \
  --recursive
```

**Expected output files:**
- `AF3_PD_analysis_v4.json` - Filtered predictions (ipSAE ≥ 0.3)
- `AF3_PD_analysis_v4_summary.txt` - Human-readable summary
- `AF3_PD_analysis_v4.xlsx` - Excel report

### 2. Database Access

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

### 3. Node.js Environment

Ensure you're in the Global_Analysis directory:
```bash
cd /emcc/au14762/elo_lab/SCRIPTS/Global_Analysis
```

---

## **Quick Start

### **Complete Workflow (5 commands)**

```bash
# 1. Run schema migration (ONLY ONCE)
node db/migrate_schema_v4.mjs

# 2. Batch import all v4 JSON files
node db/batch_import_af3_v4.mjs

# 3. Assign organisms (incremental)
node db/incremental_organism_lookup.mjs

# 4. Fetch protein aliases
node db/fetch_aliases.mjs

# 5. Populate gene names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"

# 6. Chlamydomonas gene names
node db/chlamyfp_gene_lookup.mjs

# 7. Clean redundant names
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins SET gene_name = NULL WHERE (uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'CRE%') AND gene_name = REPLACE(uniprot_id, 'AF2_', '')\`; console.log(\`Cleaned \${result.rowCount} redundant gene names\`); })();"

# 8. Validate
node db/check_db.mjs
```

**Estimated time:** 10-20 minutes depending on dataset size

---

## **Detailed Workflow

### **Step 1: Schema Migration** (Run once)

```bash
node db/migrate_schema_v4.mjs
```

**What it does:**
- Creates `ipsae_confidence_level` ENUM type
- Adds ipSAE columns to `interactions` table
- Adds ipSAE columns to `complex_interactions` table
- Creates performance indexes
- **Safe:** Checks for existing columns, won't duplicate

**Expected output:**
```
**Schema migration completed successfully!
Database Statistics:
  Total interactions: 1234
  With ipSAE scores: 0 (will increase after import)
```

---

### **Step 2: Batch Import v4 Data**

```bash
node db/batch_import_af3_v4.mjs
```

**What it does:**
- Recursively searches `/emcc/au14762/AF` and `/emcc/au14762/elo_lab/AlphaPulldown`
- Finds all `AF3_PD_analysis_v4.json` files
- Imports predictions with ipSAE ≥ 0.3 (Very Low excluded)
- Uses UPSERT logic (updates existing, inserts new)
- Marks all imported data as `analysis_version='v4'`

**Custom search paths:**
```bash
node db/batch_import_af3_v4.mjs --paths="/path1,/path2,/path3"
```

**Dry run (no database changes):**
```bash
node db/batch_import_af3_v4.mjs --dry-run
```

**Expected output:**
```
📊 Total v4 JSON files found: 15

[1/15]
📄 Processing: /emcc/au14762/AF/BBS7/AF3/AF3_PD_analysis_v4.json
  Found 142 predictions (ipSAE >= 0.3)
  **Complete: 120 new, 22 updated, 0 failed

...

📈 Batch Import Summary
Files processed: 15
New interactions: 1834
Updated interactions: 256
Failed: 0

📊 Database Statistics:
Total interactions: 3124
With ipSAE scores: 2090
  High (>0.7): 856
  Medium (0.5-0.7): 934
  Low (0.3-0.5): 300
```

---

### **Step 3: Organism Assignment**

```bash
node db/incremental_organism_lookup.mjs
```

**What it does:**
- High-confidence pattern matching (AF2_Cre*, Lotte dataset, etc.)
- UniProt API lookup for Unknown proteins
- Generates organism codes (Hs:, Cr:, Mm:, etc.)
- **INCREMENTAL:** Only processes Unknown proteins

**Time:** ~2-5 minutes for 50-100 new proteins

---

### **Step 4: Fetch Protein Aliases**

```bash
node db/fetch_aliases.mjs
```

**What it does:**
- Fetches gene names, synonyms, protein names from UniProt
- Batch API calls (50 proteins at a time)
- Enables search by gene name (e.g., "BBS7" instead of "Q8NEZ3")
- **INCREMENTAL:** Skips proteins with existing aliases

---

### **Step 5-7: Gene Name Processing**

See Quick Start section for commands.

**Purpose:**
- Populate gene_name field from aliases
- Fetch Chlamydomonas gene names from ChlamyFP
- Clean redundant/placeholder names

---

### **Step 8: Validation**

```bash
node db/check_db.mjs
```

**Check for:**
- **Total interactions increased
- **ipSAE scores present (> 0)
- **Organism codes assigned (Hs:, Cr:, etc.)
- **Gene names populated (not NULL)

---

## 🧬 Understanding ipSAE

### **Why ipSAE > iPTM?**

**Example: IFT74-IFT81 Complex**
- iPTM: 0.32 (low - would be flagged as weak)
- ipSAE: 0.61 (medium - correctly identified as genuine)
- **168 interface contacts** at PAE < 6Å
- **Reason:** Large multidomain proteins naturally have lower iPTM despite excellent interfaces

### **How ipSAE Works**

1. For each residue i in chain A → chain B:
   - Find residues j in B where PAE(i,j) < cutoff (10Å)
   - Calculate TM-score-like terms: 1 / (1 + (PAE/d₀)²)
   - Take mean score for residue i

2. Find maximum score across all residues

3. Repeat for B → A direction

4. Final ipSAE = max(A→B, B→A)

**Result:** Focuses on the strongest interaction interface, ignoring disordered regions.

---

## 🎨 Using the Web Interface

### **Accessing ipSAE Mode**

1. Navigate to: https://ciliaaf3predictions.vercel.app/
2. In the left sidebar, find "Analysis Mode" section
3. Select **"ipSAE Scoring (v4)"** radio button

### **Confidence Filters (ipSAE Mode)**

- ☑ **High (>0.7)** - Strong evidence (default ON)
- ☑ **Medium (0.5-0.7)** - Very promising (default ON)
- ☐ **Low (0.3-0.5)** - Ambiguous (default OFF)

### **Results Table**

When in ipSAE mode, the table shows:

| Bait | Prey | **ipSAE** | Confidence | iPTM | iPAE <3Å | iPAE <6Å | ipLDDT | AlphaFold |
|------|------|-----------|------------|------|----------|----------|--------|-----------|
| Hs:BBS7 | Hs:IFT27 | **0.856** | High | 0.82 | 45 | 68 | 87.2 | AF3 |
| Cr:IFT74 | Cr:IFT81 | **0.612** | Medium | 0.32 | 168 | 245 | 78.1 | AF3 |

### **Switching Between Modes**

**v3 Mode (Interface Quality):**
- Shows all data (v3 + v4)
- Confidence based on iPTM + contacts + pLDDT
- ipSAE shown as supplementary column when available

**ipSAE Mode (v4):**
- **ONLY shows v4 data** (ipSAE-scored)
- **STRICT filtering** - no v3 data leakage
- Confidence based purely on ipSAE tiers
- Sorted by ipSAE score (highest first)

---

## **Troubleshooting

### **No ipSAE data showing?**

**Check 1:** Did you run the v4 analysis script?
```bash
ls /emcc/au14762/AF/*/AF3/AF3_PD_analysis_v4.json
# Should show multiple JSON files
```

**Check 2:** Was schema migration successful?
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name = 'interactions' AND column_name = 'ipsae'\`; console.log(result.rows.length > 0 ? 'ipsae column exists' : 'ipsae column missing'); })();"
```

**Check 3:** Did import succeed?
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`SELECT COUNT(*) FROM interactions WHERE ipsae IS NOT NULL\`; console.log(\`Interactions with ipSAE: \${result.rows[0].count}\`); })();"
```

### **"No interactions found" when switching to ipSAE mode**

**Cause:** No v4 data exists for the searched protein

**Solutions:**
1. Check if protein's AF3 data was reanalyzed with v4 script
2. Try a different protein that has v4 data
3. Switch back to v3 mode to see all data

### **Import script finds no JSON files**

**Check locations:**
```bash
find /emcc/au14762/AF -name "AF3_PD_analysis_v4.json" 2>/dev/null | head -5
find /emcc/au14762/elo_lab/AlphaPulldown -name "AF3_PD_analysis_v4.json" 2>/dev/null | head -5
```

**If empty:** Run v4 analysis script first on your AF3 predictions.

---

## 🔬 Advanced Usage

### **Selective Import**

Import only specific directories:
```bash
node db/batch_import_af3_v4.mjs --paths="/emcc/au14762/AF/BBS7/AF3,/emcc/au14762/AF/IFT140/AF3"
```

### **Query ipSAE Data Directly**

```bash
node -e "
const { sql } = require('@vercel/postgres');
(async () => {
  const result = await sql\`
    SELECT
      bait.gene_name as bait,
      prey.gene_name as prey,
      i.ipsae,
      i.ipsae_confidence,
      i.iptm
    FROM interactions i
    JOIN proteins bait ON i.bait_protein_id = bait.id
    JOIN proteins prey ON i.prey_protein_id = prey.id
    WHERE i.ipsae > 0.7
    ORDER BY i.ipsae DESC
    LIMIT 10
  \`;
  console.table(result.rows);
})();
"
```

### **Backfill ipSAE for Existing Data**

If you've already imported data with v3 and now have v4 JSON files:

```bash
# The batch import script uses UPSERT - it will update existing entries
node db/batch_import_af3_v4.mjs

# Check updated count
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`SELECT analysis_version, COUNT(*) as count FROM interactions GROUP BY analysis_version\`; console.table(result.rows); })();"
```

---

## 📊 Expected Results

### **Typical ipSAE Distribution**

Based on benchmarks (Dunbrack 2025):

- **High (>0.7):** 30-40% of interactions
- **Medium (0.5-0.7):** 35-45% of interactions
- **Low (0.3-0.5):** 15-25% of interactions
- **Very Low (<0.3):** Excluded from v4 JSON output

### **Comparison to v3**

v3 classified ~487 interactions as "High" using interface quality metrics.
v4 with ipSAE typically shows:
- ~40% promoted to High (better interface detection)
- ~35% confirmed as Medium
- ~25% demoted to Low (false positives caught)

**Net effect:** More stringent, higher confidence in "High" tier.

---

## 📚 Related Documentation

- **INCREMENTAL_IMPORT_WORKFLOW.md** - General import procedures
- **IMPORT_DECISION_TREE.md** - Which import script to use
- **COMPLEX_IMPORT_GUIDE.md** - Importing protein complexes
- **CONFIDENCE_MIGRATION_GUIDE.md** - Confidence system details
- **FUNCTIONAL_ANALYSIS_GUIDE.md** - Analyzing interactors

---

## 🆘 Support

**Issues or questions?**
- Check `node db/check_db.mjs` for database status
- Review console output for error messages
- Verify JSON files exist and are valid
- Ensure all environment variables are set

**Common pitfall:** Forgetting to run schema migration before import!

---

## **Success Checklist

- [ ] Schema migration completed
- [ ] v4 JSON files imported
- [ ] Organisms assigned
- [ ] Aliases fetched
- [ ] Gene names populated
- [ ] Database validation passed
- [ ] Web interface shows ipSAE data
- [ ] Mode switching works correctly
- [ ] Confidence filters functional

**Ready to explore your ipSAE-scored interactions!** 🎉

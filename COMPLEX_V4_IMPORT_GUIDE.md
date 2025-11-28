# Protein Complex v4 Import Guide (ipSAE Scoring)

**Complete workflow for importing protein complex data with ipSAE scores into ProtoView**

---

## 📋 Table of Contents

1. [What's New in v4 for Complexes](#whats-new-in-v4-for-complexes)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Detailed Workflow](#detailed-workflow)
5. [Understanding ipSAE for Complexes](#understanding-ipsae-for-complexes)
6. [Troubleshooting](#troubleshooting)
7. [Examples](#examples)

---

## 🆕 What's New in v4 for Complexes

### ipSAE Scoring for Multi-Protein Baits

v4 extends ipSAE scoring to **protein complexes** (AB:C, ABC:D formats):

- **More robust than iPTM** for large multi-protein assemblies
- **Better handles disordered regions** in complex interfaces
- **Clear confidence tiers** based on Dunbrack 2025 benchmarks
- **Same database schema** as single protein v4 imports

### Database Schema Support

The v4 schema migration adds ipSAE columns to **both** tables:
- **`interactions` (single proteins)
- **`complex_interactions` (complexes)

New columns in `complex_interactions`:
- `ipsae` (FLOAT) - ipSAE score (0.0-1.0)
- `ipsae_confidence` (ENUM) - High/Medium/Low/Very Low
- `ipsae_pae_cutoff` (FLOAT) - PAE cutoff (typically 10.0Å)
- `analysis_version` (VARCHAR) - 'v3' or 'v4'

---

## 📦 Prerequisites

### 1. Schema Migration (Run Once)

Ensure v4 schema is applied:

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

node db/migrate_schema_v4.mjs
```

### 2. Reanalyzed Complex Data

You must have run the v4 analysis script on your complex AF3 predictions:

```bash
python3 /emcc/au14762/elo_lab/SCRIPTS/AF3_bait_prey_analysis_v4.py \
  --input_dir /path/to/complex/AF3/predictions \
  --recursive
```

**Expected output file:**
- `AF3_bait_prey_analysis_v4.json` - Filtered predictions with ipSAE scores

### 3. Database Connection

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

---

## **Quick Start

### **Automated Import (Recommended)**

```bash
# One-command import with full workflow
./import_complex_v4.sh /path/to/AF3_bait_prey_analysis_v4.json
```

**What this does:**
1. Imports complex-prey interactions with ipSAE
2. Assigns organism codes (Hs:, Cr:, etc.)
3. Fetches protein aliases from UniProt
4. Populates gene names
5. Updates complex display names

**Estimated time:** 5-10 minutes

---

## **Detailed Workflow

### **Manual Import (Step-by-Step)**

If you prefer manual control:

#### Step 1: Import Complex Data with ipSAE

```bash
node db/import_complex_af3_v4.mjs /path/to/AF3_bait_prey_analysis_v4.json
```

**Expected output:**
```
**AlphaFold 3 Complex-Prey Data Importer (v4 with ipSAE)
══════════════════════════════════════════════════════════════════════

📄 Reading: /path/to/AF3_bait_prey_analysis_v4.json

✓ Found 3 high-confidence predictions
  Analysis type: bait_prey_interactions_only
  Version: bait_prey_v4.0

🔍 Complex configuration: [A+B] : [C]
  Detected 2 bait proteins: Q9NQC8, Q9Y366

📋 Step 1: Creating/fetching bait proteins...
  ✓ Protein Q9NQC8 (ID: 242)
  ✓ Protein Q9Y366 (ID: 272)

📋 Step 2: Creating protein complex...
  ✓ Created complex: Q9NQC8 & Q9Y366 (2 proteins)

📋 Step 3: Linking proteins to complex...
  ✓ Linked Q9NQC8 as chain A (position 0)
  ✓ Linked Q9Y366 as chain B (position 1)

📋 Step 4: Importing complex-prey interactions...
  [1/3] q9nqc8_q9y366_with_a0avf1: ipSAE: 0.751 (High Confidence)
  [2/3] q9nqc8_q9y366_with_q8n4p2: ipSAE: 0.606 (Medium Confidence)
  [3/3] q9nqc8_q9y366_with_q86wt1: ipSAE: 0.557 (Medium Confidence)

══════════════════════════════════════════════════════════════════════
**Import complete!
  Complex: Q9NQC8 & Q9Y366 (2 proteins)
  New interactions: 3
  Updated interactions: 0
  Skipped low-confidence: 0
```

#### Step 2: Assign Organisms

```bash
node db/incremental_organism_lookup.mjs
```

Assigns organism codes (Hs:, Cr:, etc.) to any new proteins.

#### Step 3: Fetch Protein Aliases

```bash
node db/fetch_aliases.mjs
```

Fetches gene names and aliases from UniProt API.

#### Step 4: Populate Gene Names

```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = 'gene_name' AND p.gene_name IS NULL\`; console.log(\`Updated \${result.rowCount} proteins\`); })();"
```

#### Step 5: Update Complex Display Names

```bash
node db/update_complex_display_names.mjs
```

Updates complex names with gene names (e.g., "Q9NQC8 & Q9Y366" → "IFT52 & IFT46").

#### Step 6: Verify Import

```bash
node db/check_db.mjs
```

---

## 🧬 Understanding ipSAE for Complexes

### **Why ipSAE Helps for Complexes**

Multi-protein complexes often have:
- **Lower iPTM scores** (due to multiple domains)
- **Excellent interfaces** (high contact counts)
- **Mixed disorder** (some chains ordered, some not)

**Problem with v3:** iPTM-centric classification downgrades many genuine complex interactions.

**Solution with v4:** ipSAE focuses on the strongest interface region, ignoring disordered areas.

### **Example: IFT52+IFT46 Complex**

| Prey | v3 Confidence | iPTM | Contacts | v4 ipSAE | v4 Confidence |
|------|---------------|------|----------|----------|---------------|
| A0AVF1 | Low iPTM | 0.59 | 298 | **0.751** | **High** **|
| Q8N4P2 | Worth Investigating | 0.61 | 246 | **0.606** | Medium |
| Q86WT1 | Low iPTM | 0.59 | 242 | **0.557** | Medium |

**Result:** v4 correctly promotes A0AVF1 to High confidence based on excellent interface quality.

### **ipSAE Confidence Tiers**

| Tier | ipSAE Range | Description | Complex Applicability |
|------|-------------|-------------|----------------------|
| **High** | > 0.7 | Strong evidence | Excellent for large complexes |
| **Medium** | 0.5-0.7 | Very promising | Good for heterodimers |
| **Low** | 0.3-0.5 | Ambiguous | Requires visual inspection |
| **Very Low** | < 0.3 | Likely false positive | Excluded from import |

---

## **Troubleshooting

### **Issue: "Schema migration not found"**

**Solution:** Run the v4 schema migration first:
```bash
node db/migrate_schema_v4.mjs
```

### **Issue: "File not found" error**

**Check 1:** Verify file path is correct:
```bash
ls -la /path/to/AF3_bait_prey_analysis_v4.json
```

**Check 2:** Ensure it's a v4 file (not v3):
```bash
head -20 /path/to/file.json | grep version
# Should show: "version": "bait_prey_v4.0"
```

### **Issue: No interactions imported**

**Possible Causes:**
1. All predictions are "Very Low" confidence (ipSAE < 0.3)
2. JSON file is malformed
3. `high_confidence_predictions` array is empty

**Solution:** Check the JSON structure:
```bash
cat file.json | grep -A 5 "high_confidence_predictions"
```

### **Issue: Complex not showing in web interface**

**Check 1:** Verify complex was created:
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`SELECT * FROM protein_complexes ORDER BY created_at DESC LIMIT 5\`; console.table(result.rows); })();"
```

**Check 2:** Check for v4 interactions:
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => { const result = await sql\`SELECT COUNT(*) as count FROM complex_interactions WHERE ipsae IS NOT NULL\`; console.log(\`Complex interactions with ipSAE: \${result.rows[0].count}\`); })();"
```

---

## 📊 Examples

### **Example 1: IFT52_46 Complex (AB:C)**

**Data Location:**
```
/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/IFT52_46/AF3/
└── AF3_bait_prey_analysis_v4.json
```

**Complex Configuration:**
- Bait: IFT52 (Q9NQC8) + IFT46 (Q9Y366)
- Format: AB:C (2-protein bait, 1-protein prey)
- Predictions: 3 high-confidence interactions

**Import Command:**
```bash
./import_complex_v4.sh /emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/IFT52_46/AF3/AF3_bait_prey_analysis_v4.json
```

**Expected Results:**
- Complex: Q9NQC8 & Q9Y366
- 3 interactions imported with ipSAE scores
- ipSAE range: 0.557 - 0.751 (Medium to High)

---

### **Example 2: ABC:D Three-Protein Complex**

**For a hypothetical three-protein complex:**

**JSON Structure:**
```json
{
  "version": "bait_prey_v4.0",
  "bait_chains": ["A", "B", "C"],
  "prey_chains": ["D"],
  "high_confidence_predictions": [
    {
      "directory_name": "q12345_q67890_q11111_with_prey",
      "bait_chains": ["A", "B", "C"],
      "prey_chains": ["D"],
      "iptm": 0.55,
      "ipsae": 0.682,
      "ipsae_confidence_class": "Medium Confidence"
    }
  ]
}
```

**Import:** Same workflow, automatically detects 3 bait proteins.

---

## 🎨 Viewing v4 Complex Data in Web Interface

### **Accessing ipSAE Mode for Complexes**

1. Navigate to: https://ciliaaf3predictions.vercel.app/
2. **Select search mode:** "Protein Complex" radio button
3. **Select analysis mode:** "ipSAE Scoring (v4)" radio button
4. **Choose complex** from dropdown
5. **View interactions** with ipSAE scores

### **Results Table Columns**

When in v4 mode, the table shows:

| Bait Complex | Prey | **ipSAE** | Confidence | iPTM | iPAE <3Å | iPAE <6Å | ipLDDT | AlphaFold |
|--------------|------|-----------|------------|------|----------|----------|--------|-----------|
| **IFT52 & IFT46**<br><small>Q9NQC8 + Q9Y366</small> | A0AVF1 | **0.751** | High | 0.59 | 242 | 298 | 86.1 | AF3 |

### **Confidence Filters**

- ☑ **High (>0.7)** - Strong evidence (default ON)
- ☑ **Medium (0.5-0.7)** - Very promising (default ON)
- ☐ **Low (0.3-0.5)** - Ambiguous (default OFF)

---

## **Migrating v3 Complex Data to v4

**If you already imported v3 complex data and now have v4 analysis:**

The v4 import script uses **UPSERT** logic:
- Updates existing interactions with ipSAE data
- Marks them as `analysis_version='v4'`
- Preserves all v3 metrics

**Command:**
```bash
node db/import_complex_af3_v4.mjs /path/to/new_v4_file.json
```

**Result:**
```
**Import complete!
  New interactions: 0
  Updated interactions: 3  <-- Existing v3 data now has ipSAE!
```

---

## 📚 Related Documentation

- **V4_IMPORT_GUIDE.md** - v4 single protein imports
- **COMPLEX_IMPORT_GUIDE.md** - v3 complex imports
- **COMPLEX_SYSTEM_SUMMARY.md** - Complex system architecture
- **V3_VS_V4_QUICK_REFERENCE.md** - v3 vs v4 comparison

---

## **Success Checklist

- [ ] Schema migration completed (v4 columns added)
- [ ] v4 complex JSON file generated
- [ ] Complex data imported with ipSAE
- [ ] Organisms assigned
- [ ] Aliases fetched
- [ ] Gene names populated
- [ ] Complex display names updated
- [ ] Database validation passed
- [ ] Web interface shows ipSAE data
- [ ] v4 mode toggle works correctly

---

## 🆘 Support

**Common Issues:**

| Issue | Quick Fix |
|-------|----------|
| Schema error | Run `node db/migrate_schema_v4.mjs` |
| No ipSAE scores | Check you're using v4 JSON (not v3) |
| Complex not found | Verify `protein_complexes` table has entry |
| Import fails | Check `POSTGRES_URL` is set |

**Database Status:**
```bash
node db/check_db.mjs
```

**Manual Query:**
```bash
node -e "const { sql } = require('@vercel/postgres'); (async () => {
  const result = await sql\`
    SELECT pc.display_name, COUNT(*) as interactions,
           COUNT(CASE WHEN ci.ipsae > 0.7 THEN 1 END) as high_ipsae
    FROM complex_interactions ci
    JOIN protein_complexes pc ON ci.bait_complex_id = pc.id
    WHERE ci.ipsae IS NOT NULL
    GROUP BY pc.display_name
  \`;
  console.table(result.rows);
})();"
```

---

## 🎯 Summary

****v4 Complex Import System** - Fully implemented with ipSAE support
****Automated Workflow** - One command imports and processes data
****UPSERT Logic** - Safe to re-run on existing data
****Same Confidence Tiers** - High/Medium/Low as single proteins
****Web Interface Ready** - Toggle to v4 mode to view ipSAE scores

**Next Steps:**
1. Run `./import_complex_v4.sh` on your v4 complex data
2. View in ProtoView web interface
3. Compare v3 vs v4 confidence assignments
4. Use ipSAE High tier for experimental validation

**Ready to import your ipSAE-scored protein complexes!** 🎉

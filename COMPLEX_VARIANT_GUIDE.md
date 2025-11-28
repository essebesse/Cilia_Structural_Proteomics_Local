# Complex Variant Upload Guide

## Overview

When the same protein complex is tested with different constructs (full-length, truncations, domains), each variant must be imported as a **separate complex entry** with a **unique variant name**. This guide explains how to properly handle protein variants.

---

## Problem Statement

### The Scenario
You have the same protein complex tested with multiple constructs:
- **IFT46 & IFT52 (Full-length)**:
  - IFT46: 304 amino acids
  - IFT52: 437 amino acids
- **IFT46 & IFT52 (C-terminal)**:
  - IFT46: 141 amino acids (C-terminal 46%)
  - IFT52: 107 amino acids (C-terminal 24%)
- **IFT46 & IFT52 (N-terminal)**:
  - IFT46: 150 amino acids
  - IFT52: 200 amino acids

### The Risk
**If you don't specify custom variant names, they will OVERWRITE each other!**

---

## Solution: Custom Variant Naming

### Command Syntax

**v3 imports:**
```bash
./import_complex.sh /path/to/AF3_bait_prey_analysis_v3.json [VARIANT_NAME]
```

**v4 imports:**
```bash
./import_complex_v4.sh /path/to/AF3_bait_prey_analysis_v4.json [VARIANT_NAME]
```

### Examples

#### Full-Length (Default)
```bash
# Omit variant name for full-length constructs
./import_complex.sh /path/to/IFT52_46/AF3/AF3_bait_prey_analysis_v3.json

# Result: "IFT46 & IFT52"
```

#### C-Terminal Construct
```bash
# Specify residue counts
./import_complex.sh /path/to/Hs_Cter_IFT52_46/AF3/AF3_bait_prey_analysis_v3.json "Cterm_141-107aa"

# Result: "IFT46 & IFT52 (Cterm_141-107aa)"
```

#### N-Terminal Construct
```bash
# Specify residue range
./import_complex.sh /path/to/Hs_Nter_IFT52_46/AF3/AF3_bait_prey_analysis_v3.json "Nterm_1-150aa"

# Result: "IFT46 & IFT52 (Nterm_1-150aa)"
```

#### Domain-Specific Constructs
```bash
# TPR domain only
./import_complex.sh /path/to/TPR_domain/AF3/AF3_bait_prey_analysis_v3.json "TPR_domain"

# WD40 repeats only
./import_complex.sh /path/to/WD40/AF3/AF3_bait_prey_analysis_v3.json "WD40_repeats"
```

---

## Naming Best Practices

### Recommended Patterns

| Construct Type | Naming Pattern | Example |
|----------------|----------------|---------|
| **Full-length** | (omit variant) | `IFT46 & IFT52` |
| **C-terminal** | `Cterm_<lengths>` | `Cterm_141-107aa` |
| **N-terminal** | `Nterm_<range>` | `Nterm_1-150aa` |
| **Middle domain** | `Middle_<range>` | `Middle_200-400aa` |
| **Specific domain** | `<domain_name>` | `TPR_domain`, `WD40_repeats` |
| **Multiple truncations** | `<position>_<lengths>` | `Cterm_v2_120-95aa` |

### Naming Rules

****DO:**
- Include residue lengths or ranges when known
- Use descriptive domain names
- Use underscores (`_`) to separate parts
- Be consistent across related uploads
- Use version numbers if testing multiple versions (`v1`, `v2`)

****DON'T:**
- Use vague names like "test", "run1", "new"
- Use special characters (except underscore and hyphen)
- Use spaces (will cause issues in file paths)
- Reuse variant names for different constructs

---

## How to Find Construct Information

### Method 1: Check bait.fasta File

```bash
# View the bait sequences
cat /path/to/AF3_APD/Hs_Cter_IFT52_46/bait.fasta
```

Example output:
```
>Q9NQC8
MKVKSLEDAEKNPKAIDTWIESISELHRSKPPATVHYTRPMPDIDTLMQEWSPEFEELLGKVSLPT...
(141 amino acids)

>Q9Y366
LPTLQPAVFPPSFRELPPPPLELFDLDETFSSEKARLAQITNKCTEEDLEFYVRKCGDILGVTSKL...
(107 amino acids)
```

### Method 2: Count Residues

```bash
# Count amino acids in each sequence
grep -A1 "^>Q9NQC8" bait.fasta | tail -1 | wc -c
# Output: 142 (141 aa + newline)

grep -A1 "^>Q9Y366" bait.fasta | tail -1 | wc -c
# Output: 108 (107 aa + newline)
```

### Method 3: Compare to Full-Length

Compare sequence lengths to UniProt full-length:
- **Q9NQC8** (IFT46): Full-length = 304 aa
  - If construct = 141 aa → **46% of full-length** → C-terminal construct
- **Q9Y366** (IFT52): Full-length = 437 aa
  - If construct = 107 aa → **24% of full-length** → C-terminal construct

---

## Complete Workflow Example

### Scenario: Uploading FL + Cterm + Nterm Variants

```bash
# Set database URL
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# 1. Import full-length v3
./import_complex.sh /path/to/IFT52_46/AF3/AF3_bait_prey_analysis_v3.json

# 2. Import full-length v4
./import_complex_v4.sh /path/to/IFT52_46/AF3/AF3_bait_prey_analysis_v4.json

# 3. Import C-terminal v3
./import_complex.sh /path/to/Hs_Cter_IFT52_46/AF3/AF3_bait_prey_analysis_v3.json "Cterm_141-107aa"

# 4. Import C-terminal v4
./import_complex_v4.sh /path/to/Hs_Cter_IFT52_46/AF3/AF3_bait_prey_analysis_v4.json "Cterm_141-107aa"

# 5. Import N-terminal v3 (if available)
./import_complex.sh /path/to/Hs_Nter_IFT52_46/AF3/AF3_bait_prey_analysis_v3.json "Nterm_150-200aa"

# Result:
# - IFT46 & IFT52 (full-length)
# - IFT46 & IFT52 (Cterm_141-107aa)
# - IFT46 & IFT52 (Nterm_150-200aa)
```

---

## Database Structure

### How Variants Are Stored

**protein_complexes table:**
```sql
complex_name             | display_name                       | num_proteins
-------------------------|------------------------------------|--------------
Q9NQC8_Q9Y366_FL         | IFT46 & IFT52                      | 2
Q9NQC8_Q9Y366_Cterm_141-107aa | IFT46 & IFT52 (Cterm_141-107aa) | 2
Q9NQC8_Q9Y366_Nterm_150-200aa | IFT46 & IFT52 (Nterm_150-200aa) | 2
```

**Key Fields:**
- `complex_name`: Internal identifier (UniProt IDs + variant)
- `display_name`: User-facing name (gene names + variant)
- Variant suffix preserved in both fields

---

## Verifying Your Import

### Check Database
```bash
node -e "
const { sql } = require('@vercel/postgres');
(async () => {
  const result = await sql\`
    SELECT complex_name, display_name,
           COUNT(*) as interaction_count
    FROM protein_complexes pc
    LEFT JOIN complex_interactions ci ON ci.bait_complex_id = pc.id
    WHERE complex_name LIKE 'Q9NQC8_Q9Y366%'
    GROUP BY pc.id, complex_name, display_name
    ORDER BY complex_name
  \`;
  console.table(result.rows);
})();
"
```

Expected output:
```
┌─────────┬────────────────────────────────┬──────────────────────────────────┬───────────────────┐
│ (index) │ complex_name                   │ display_name                     │ interaction_count │
├─────────┼────────────────────────────────┼──────────────────────────────────┼───────────────────┤
│ 0       │ 'Q9NQC8_Q9Y366_FL'             │ 'IFT46 & IFT52'                  │ '13'              │
│ 1       │ 'Q9NQC8_Q9Y366_Cterm_141-107aa'│ 'IFT46 & IFT52 (Cterm_141-107aa)'│ '30'              │
└─────────┴────────────────────────────────┴──────────────────────────────────┴───────────────────┘
```

### Web Interface
1. Navigate to: https://ciliaaf3predictions.vercel.app/
2. Switch to "Protein Complex" mode
3. Open dropdown - you should see:
   - `IFT46 & IFT52`
   - `IFT46 & IFT52 (Cterm_141-107aa)`

---

## Troubleshooting

### Problem: Variant names are getting overwritten

**Symptom:** After running update_complex_display_names.mjs, all variants show the same name.

**Cause:** Old version of script didn't preserve variant suffix.

**Solution:** The script has been fixed to preserve custom variant names. Re-run:
```bash
node db/update_complex_display_names.mjs
```

### Problem: Can't distinguish between variants in dropdown

**Symptom:** Dropdown shows multiple "IFT46 & IFT52" entries without variant labels.

**Cause:** Variant name not specified during import.

**Solution:** Delete the duplicate and re-import with proper variant name:
```sql
-- Find the complex ID
SELECT id, complex_name, display_name FROM protein_complexes;

-- Delete the complex (cascades to interactions)
DELETE FROM protein_complexes WHERE id = <complex_id>;

-- Re-import with variant name
./import_complex.sh /path/to/file.json "Cterm_141-107aa"
```

### Problem: Uploaded both v3 and v4, only seeing one mode's data

**Symptom:** Switching between v3/v4 mode shows empty results.

**Cause:** Mode auto-detection requires data in at least one mode.

**Solution:** This is expected if only v3 or v4 was uploaded. Upload both:
```bash
# Upload v3
./import_complex.sh /path/to/AF3_bait_prey_analysis_v3.json "Cterm_141-107aa"

# Upload v4 (use same variant name!)
./import_complex_v4.sh /path/to/AF3_bait_prey_analysis_v4.json "Cterm_141-107aa"
```

---

## Advanced: Multiple Versions of Same Construct

If you need to upload multiple experimental runs of the same construct:

```bash
# First run
./import_complex.sh /path/to/run1/AF3/file.json "Cterm_141-107aa_v1"

# Second run (different conditions/parameters)
./import_complex.sh /path/to/run2/AF3/file.json "Cterm_141-107aa_v2"

# Result:
# - IFT46 & IFT52 (Cterm_141-107aa_v1)
# - IFT46 & IFT52 (Cterm_141-107aa_v2)
```

---

## Summary Checklist

Before uploading a protein complex variant:

- [ ] Check the bait.fasta file for sequence lengths
- [ ] Determine construct type (FL, Cterm, Nterm, domain)
- [ ] Create a descriptive variant name following naming patterns
- [ ] Run import command with variant name parameter
- [ ] Verify import in database
- [ ] Check web interface dropdown shows correct name
- [ ] If uploading v3 and v4, use **identical variant names** for both

---

## Related Documentation

- **INCREMENTAL_IMPORT_WORKFLOW.md** - Standard import procedure
- **IMPORT_DECISION_TREE.md** - Choose correct import script
- **COMPLEX_V4_IMPORT_GUIDE.md** - v4-specific details
- **CLAUDE.md** - Quick reference for all commands

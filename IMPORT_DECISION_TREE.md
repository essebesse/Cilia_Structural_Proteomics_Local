# Import Decision Tree - Which Script to Use?

## 🔍 Step 1: Identify Your Data Type

Look at your AlphaFold 3 prediction directory and JSON file to determine the data type:

### Check 1: How Many Bait Proteins?

Open your `AF3_PD_analysis_v3.json` or `AF3_bait_prey_analysis_v3.json` file and look at the first prediction:

```json
"bait_chains": ["A"]        → SINGLE BAIT PROTEIN
"bait_chains": ["A", "B"]   → PROTEIN COMPLEX (2 proteins)
"bait_chains": ["A", "B", "C"] → PROTEIN COMPLEX (3 proteins)
```

### Check 2: Directory Name Pattern

Look at your data directory name:

**Single Bait Examples:**
- `Q8NEZ3_CCDC66/AF3/`
- `H9CTG6_IFT122/AF3/`
- `A9XPA6_IFT139/AF3/`
- Pattern: `{UniProtID}_{GeneName}/AF3/`

**Complex Examples:**
- `Q96LB3_Q8WYA0_IFT74_81/AF3/`
- `Q8NEZ3_Q9H7X7_with_prey/AF3/`
- Pattern: Multiple UniProt IDs separated by underscores

### Check 3: File Name

- `AF3_PD_analysis_v3.json` → Usually **single bait**
- `AF3_bait_prey_analysis_v3.json` → Could be either, check bait_chains

---

## **Step 2: Choose Import Script

### Option A: Single Bait Protein

**Characteristics:**
- One protein tested against multiple prey
- Bait chains: `["A"]`
- Directory: `Q8NEZ3_CCDC66/AF3/`

**Script to Use:**
```bash
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
```

**Workflow:**
See **INCREMENTAL_IMPORT_WORKFLOW.md** → "Single Bait Protein" section

---

### Option B: Protein Complex

**Characteristics:**
- Multiple proteins forming a complex bait
- Bait chains: `["A", "B"]` or `["A", "B", "C"]`
- Directory: `Q96LB3_Q8WYA0_IFT74_81/AF3/`

**** CRITICAL FILE SELECTION:**
- ****CORRECT**: `AF3_bait_prey_analysis_v4.json` (Complex-prey format)
- ****WRONG**: `AF3_PD_analysis_v4.json` (Pairwise format - NOT for complexes!)

**Script to Use (RECOMMENDED - Automated):**
```bash
# v3 format
./import_complex.sh /path/to/AF3_bait_prey_analysis_v3.json

# v4 format (ipSAE)
./import_complex_v4.sh /path/to/AF3_bait_prey_analysis_v4.json
```

**OR Manual Script:**
```bash
node db/import_complex_af3_json.mjs /path/to/AF3_bait_prey_analysis_v3.json
node db/import_complex_af3_v4.mjs /path/to/AF3_bait_prey_analysis_v4.json
```

**Workflow:**
See **COMPLEX_IMPORT_GUIDE.md** or **INCREMENTAL_IMPORT_WORKFLOW.md** → "Protein Complex" section

---

## 📋 Quick Examples

### Example 1: IFT122 Single Bait

**Data Location:**
```
/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Chlamydomonas/H9CTG6_IFT122/AF3/
└── AF3_PD_analysis_v3.json
```

**JSON Content:**
```json
{
  "bait_chains": ["A"],
  "prey_chains": ["B"],
  ...
}
```

**Decision:** ****Single Bait Protein**

**Command:**
```bash
node db/import_af3_json.mjs /emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Chlamydomonas/H9CTG6_IFT122/AF3/AF3_PD_analysis_v3.json
```

---

### Example 2: IFT74_IFT81 Complex

**Data Location:**
```
/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q96LB3_Q8WYA0_IFT74_81/AF3/
└── AF3_bait_prey_analysis_v3.json
```

**JSON Content:**
```json
{
  "bait_chains": ["A", "B"],
  "prey_chains": ["C"],
  ...
}
```

**Decision:** ****Protein Complex (2 proteins)**

**Command (AUTOMATED):**
```bash
./import_complex.sh /emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q96LB3_Q8WYA0_IFT74_81/AF3/AF3_bait_prey_analysis_v3.json
```

**Command (MANUAL):**
```bash
node db/import_complex_af3_json.mjs /emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q96LB3_Q8WYA0_IFT74_81/AF3/AF3_bait_prey_analysis_v3.json
```

---

## 🎯 Summary Table

| Data Type | Bait Chains | Directory Pattern | Import Script | Automated Script |
|-----------|-------------|-------------------|---------------|------------------|
| **Single Bait** | `["A"]` | `Q8NEZ3_CCDC66/` | `import_af3_json.mjs` | **Use manual |
| **Complex (2)** | `["A", "B"]` | `Q96LB3_Q8WYA0_IFT74_81/` | `import_complex_af3_json.mjs` | **`import_complex.sh` |
| **Complex (3)** | `["A", "B", "C"]` | `Q1_Q2_Q3_ComplexName/` | `import_complex_af3_json.mjs` | **`import_complex.sh` |
| **Complex (4+)** | `["A", "B", "C", "D", ...]` | Multiple UniProt IDs | `import_complex_af3_json.mjs` | **`import_complex.sh` |

---

## 🚨 Common Mistakes to Avoid

### **Wrong: Using Single Bait Script for Complex
```bash
# DON'T DO THIS for IFT74_IFT81:
node db/import_af3_json.mjs /path/to/complex_data.json
# **Will fail or create incorrect data
```

### **Wrong: Using Complex Script for Single Bait
```bash
# DON'T DO THIS for IFT122 alone:
node db/import_complex_af3_json.mjs /path/to/single_bait.json
# **Will fail to extract proteins correctly
```

### **Correct: Match Script to Data Type
```bash
# Single bait (IFT122):
node db/import_af3_json.mjs /path/to/IFT122/AF3_PD_analysis_v3.json

# Complex (IFT74+IFT81):
./import_complex.sh /path/to/IFT74_81/AF3_bait_prey_analysis_v3.json
```

---

## **Need More Details?

- **Single Bait Workflow:** See `INCREMENTAL_IMPORT_WORKFLOW.md`
- **Complex Workflow:** See `COMPLEX_IMPORT_GUIDE.md`
- **Complex System:** See `COMPLEX_SYSTEM_SUMMARY.md`
- **General Info:** See `CLAUDE.md`

---

## 🆘 Still Not Sure?

### Quick Test: Check the JSON

```bash
# Look at the first prediction in your JSON file:
head -50 /path/to/your/file.json | grep -A 5 "bait_chains"
```

**If you see:**
- `"bait_chains": ["A"]` → Use `import_af3_json.mjs`
- `"bait_chains": ["A", "B"]` → Use `import_complex_af3_json.mjs` or `import_complex.sh`
- `"bait_chains": ["A", "B", "C"]` → Use `import_complex_af3_json.mjs` or `import_complex.sh`

---

## 📞 Getting Help

If you're still unsure after checking:
1. Share the directory name with Claude
2. Share the first few lines of the JSON (especially `bait_chains`)
3. Claude will tell you exactly which script to use

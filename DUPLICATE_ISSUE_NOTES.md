# Global Duplication Issue - Session Notes (2025-10-23)

## Problem Summary

**ALL single protein entries have duplicate interactions** when viewed in v3 mode on the frontend. This is a **global database issue** affecting the entire dataset.

## Root Cause Analysis

### What We Discovered

1. **Import History:**
   - v3 JSON files were imported first using `db/import_af3_json.mjs`
   - Later, v4 JSON files with ipSAE scoring were imported for the same proteins
   - Different file names: `AF3_PD_analysis_v3.json` vs `AF3_PD_analysis_v4.json`

2. **Database Constraint:**
   - Unique constraint: `(bait_protein_id, prey_protein_id, source_path)`
   - Different `source_path` values = constraint allows both entries
   - Result: Same interaction exists twice with different source files

3. **Data Differences Between v3 and v4:**
   - **Contacts field**: v3 has `NULL`, v4 has `0` for zero contacts
   - **ipLDDT precision**: Tiny floating-point differences (e.g., 85.6271945701357**4** vs 85.6271945701357**5**)
   - **ipSAE field**: Only v4 has ipSAE scores, v3 has `NULL`
   - **Core metrics identical**: Same prey protein, same iPTM, same PAE contacts

4. **Why It Shows in v3 Mode:**
   - Frontend v3/v4 toggle likely filters by `source_path` or `analysis_version`
   - When "v3 mode" selected, it shows entries from v3 files
   - Since both v3 AND v4 entries exist, duplicates appear in the table

## Example: CrODA8 (A0A2K3E7K0)

**Before Fix:**
- 55 total interactions
- 11 duplicate pairs (v3 + v4 versions of same interaction)
- Duplicates visible in v3 mode

**Duplicates Found:**
1. CAH1, CAH2, CYN19-2, IFT22, Minus Gamete Specific Protein
2. FAP152, FAP390, FAP196, FAP288
3. Glutathione S-transferase-like, Armadillo Repeat Protein, ABCA5, CRE12_G509900_T1_1

**After Fix:**
- 44 unique interactions
- Removed 11 v3 duplicates (kept v4 versions with ipSAE data)
- **No duplicates in v3 mode

## Example: IFT172 (Q9UG01)

**Duplicates Observed (from user):**
- IFT57: 2 entries (iPTM 0.45, contacts 60)
- IFT80: 2 entries (iPTM 0.77, contacts 51)
- And more...

**Not Fixed:** Still needs deduplication

## Global Scope

**User confirmed:** "Basically all single protein entries has this duplication issue...it is a global issue"

### Estimated Impact

From earlier analysis:
- **830 total duplicate pairs** across entire database
- **69 interactions** with both v3 AND v4 entries
- Affects most/all single-protein baits that had both v3 and v4 imports

## Solution Implemented

### Single-Protein Deduplication Script

**File:** `db/deduplicate_single_protein.mjs`

**What it does:**
1. Finds all interactions for a given bait protein (by UniProt ID)
2. Groups by: `prey_protein_id` + `iptm` + `contacts_pae_lt_3` (normalized NULL → 0)
3. For each duplicate group, keeps ONE entry:
   - **Preference:** v4 > v3 > newest ID
   - **Reason:** v4 has ipSAE scoring data
4. Deletes the rest

**Key Design Decisions:**
- **Does NOT use `interface_plddt` for grouping (floating-point precision differences)
- **Normalizes NULL contacts to 0 (v3 quirk)
- **Prefers v4 entries (has ipSAE data)
- **Dry-run mode by default (safe testing)

**Usage:**
```bash
# Test (dry-run)
node db/deduplicate_single_protein.mjs A0A2K3E7K0

# Execute
node db/deduplicate_single_protein.mjs A0A2K3E7K0 --execute
```

### Testing

**CrODA8 Results:**
- **Found all 11 duplicates correctly
- **Deleted 11 v3 entries, kept 11 v4 entries
- **Verification passed (44 interactions remain)
- **Website confirms no duplicates in v3 mode

## Important Considerations

### Why Keep Both v3 and v4?

**User Requirement:** Frontend allows users to toggle between v3 and v4 analysis modes.

**Initial Assumption (WRONG):** Users need separate v3 and v4 database entries
**Reality Check Needed:** Does frontend actually filter by `source_path`, or does it just change confidence calculation?

### Questions for Next Session

1. **Frontend behavior:** What does the v3/v4 mode toggle actually do?
   - Filter to show only v3 or v4 source files?
   - OR: Show all data but calculate confidence differently?

2. **If filtering by source:** Why do we see duplicates? Shouldn't v3 mode show only v3 files?

3. **Data strategy going forward:**
   - Should we keep BOTH v3 and v4 entries?
   - Or keep only v4 (with ipSAE) and let frontend calculate both confidence schemes?

4. **Complex interactions:** Do they have the same issue?
   - User said complex imports have proper UPSERT logic
   - Verify if complex data has duplicates

## Next Steps

### Immediate (Next Session)

1. **Investigate frontend code:**
   - Check `app/page.tsx` and `app/api/interactions/[id]/route.ts`
   - Understand how v3/v4 mode toggle works
   - Determine if we need separate v3/v4 database entries

2. **Global deduplication:**
   - If confirmed we should remove v3 duplicates, run global cleanup
   - Script available: `db/deduplicate_interactions.mjs`
   - Estimated: Remove ~830 v3 duplicate entries

3. **Prevent future duplicates:**
   - Update `db/import_af3_json.mjs` with better UPSERT logic
   - Option A: Check for existing interaction by prey+metrics, update source_path
   - Option B: Add flag to skip if v4 already exists
   - Option C: Change unique constraint to not include source_path

### Long-term Prevention

**Option 1: Change Unique Constraint**
```sql
-- Remove old constraint
ALTER TABLE interactions DROP CONSTRAINT interactions_bait_protein_id_prey_protein_id_source_path_key;

-- Add new constraint (exclude source_path)
ALTER TABLE interactions ADD CONSTRAINT interactions_bait_prey_unique
  UNIQUE (bait_protein_id, prey_protein_id, iptm, contacts_pae_lt_3);
```
- **Pros:** Prevents duplicates automatically
- **Cons:** Can't store same interaction from different analyses

**Option 2: Smarter Import Script**
```javascript
// Before inserting, check if interaction exists (any source_path)
const existing = await sql`
  SELECT id FROM interactions
  WHERE bait_protein_id = ${baitId}
    AND prey_protein_id = ${preyId}
    AND iptm = ${iptm}
    AND COALESCE(contacts_pae_lt_3, 0) = ${contacts}
`;

if (existing.rows.length > 0) {
  // UPDATE existing with new data (merge v4 fields)
  await sql`UPDATE interactions SET ipsae = ${ipsae}, ... WHERE id = ${existing.id}`;
} else {
  // INSERT new
}
```
- **Pros:** Preserves all data, merges v3/v4 into single row
- **Cons:** More complex logic

**Option 3: Import Policy**
- Document: "Only import v4 files (with ipSAE)"
- Frontend can calculate both v3 and v4 confidence from same data
- **Pros:** Simplest solution
- **Cons:** Requires discarding existing v3 imports

## Technical Details

### Deduplication Script Logic

**Grouping Key:**
```javascript
const contacts = interaction.contacts_pae_lt_3 ?? 0;  // Normalize NULL → 0
const key = `${interaction.prey_protein_id}|${interaction.iptm}|${contacts}`;
```

**Why NOT include:**
- **`interface_plddt`: Floating-point precision differences between v3/v4
- **`source_path`: Different by definition (v3.json vs v4.json)
- **`ipsae`: Only v4 has this value

**Why include:**
- **`prey_protein_id`: Core identifier (which protein)
- **`iptm`: Core metric
- **`contacts_pae_lt_3`: Core metric (normalized)

### Known Data Quirks

1. **NULL vs 0 contacts:** v3 stores NULL, v4 stores 0 for zero contacts
2. **ipLDDT precision:** Same value, different precision (e.g., 14 vs 15 decimal places)
3. **Missing ipSAE:** Only v4 has ipSAE, v3 has NULL

## Files Created This Session

1. **`db/deduplicate_single_protein.mjs`** - Single protein deduplication (**WORKS)
2. **`db/deduplicate_interactions.mjs`** - Global deduplication (UNTESTED - has bugs in counting)
3. **`db/check_croda8_duplicates.mjs`** - Check CrODA8 duplicates (**verification)
4. **`db/check_ift22.mjs`** - Check IFT22 NULL vs 0 issue (**diagnostic)
5. **`DUPLICATE_ISSUE_NOTES.md`** - This document

## Summary for Next Session

**Problem:** Global duplication in single-protein interactions (v3 + v4 imports)

**Test Fix:** CrODA8 successfully deduplicated (55 → 44 interactions)

**Remaining Work:**
1. Understand frontend v3/v4 mode behavior
2. Decide: Keep v3+v4 or v4 only?
3. Run global deduplication if needed (~830 duplicates)
4. Fix import scripts to prevent future duplicates
5. Update documentation with best practices

**Script Ready:** `db/deduplicate_single_protein.mjs` works perfectly

**User confirmed:** Ready to fix globally once strategy is clear

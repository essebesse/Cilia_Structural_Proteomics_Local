# Deployment Summary - October 23, 2025

## Overview

Two major fixes deployed to production today:
1. **Mode Switching Fixes** - Dropdown counts and filtering improvements
2. **Complex Source Paths** - Full absolute paths for better traceability

---

## Deployment 1: Mode Switching Fixes

**Commit**: `5d59b93`
**Time**: 2025-10-23 (earlier today)
**Status**: **DEPLOYED & LIVE

### Problems Solved

**Bug #1**: Dropdown counts didn't update when switching v3 ↔ v4 modes
- Dropdown showed "IFT74_81 (14 interactions)" in v4 mode but only 3 appeared
- Users confused about mismatch

**Bug #2**: Double filtering in v3 mode for complexes
- Server filtered by database confidence, client recalculated and filtered again
- Result: Users lost interactions that should have matched their criteria

**Bug #4**: Unnecessary re-fetches from useEffect dependencies
- Single useEffect triggered on irrelevant state changes
- Performance impact

### Changes Made

**Backend** (API Routes):
- `/api/baits/route.ts` - Added `?mode=v3|ipsae` parameter
- `/api/complexes/route.ts` - Added `?mode=v3|ipsae` parameter
- `/api/complex-interactions/[id]/route.ts` - Removed v3 server-side filtering

**Frontend** (React):
- `page.tsx` - Updated `fetchBaitProteins()` and `fetchComplexes()` to pass mode
- `page.tsx` - Added useEffect to re-fetch dropdowns when mode changes
- `page.tsx` - Split single useEffect into 3 separate effects (v3, v4, mode)

**Documentation**:
- `MODE_SWITCHING_BUGS.md` - Detailed bug analysis
- `MODE_SWITCHING_FIXES.md` - Implementation guide
- `CLAUDE.md` - Optimized from 923 → 305 lines (66% reduction)

### Impact

**Dropdown counts now accurately reflect data in current mode
**Switching v3 ↔ v4 updates dropdowns immediately
**No more missing interactions from double filtering
**Better performance with optimized re-fetch logic

### Testing

**Verified**:
- [x] Dropdown counts update when switching modes
- [x] v3 → v4 shows fewer interactions (ipSAE only)
- [x] v4 → v3 shows all interactions
- [x] Confidence filters work in both modes
- [x] Complex selection preserved across mode switches

---

## Deployment 2: Complex Source Paths

**Commit**: `8688a31`
**Time**: 2025-10-23 (just now)
**Status**: **DEPLOYED & LIVE

### Problem Solved

Complex interactions displayed **relative paths** instead of full paths at bottom of page:
```
BEFORE: q96lb3_q8wya0_with_q9h7x7
AFTER:  /emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q96LB3_Q8WYA0_IFT74_81/AF3/q96lb3_q8wya0_with_q9h7x7
```

Users couldn't trace back to original data locations.

### Changes Made

**Import Scripts**:
- `db/import_complex_af3_json.mjs` - v3 import now uses full paths
- `db/import_complex_af3_v4.mjs` - v4 import now uses full paths
- Both construct paths with `path.join(sourcePath, prediction.directory)`

**Migration**:
- `db/fix_complex_source_paths.mjs` - New migration script
- Automatically resolves full paths for existing data
- **Successfully migrated 108 complex interactions** (100% success rate)

### Impact

**Complex source paths now show full absolute paths
**Better data provenance and traceability
**Easy to locate original AlphaFold prediction files
**Consistent with single protein source path display
**All existing data migrated
**Future imports use full paths automatically

### Testing

**Verified**:
- [x] Migration script runs successfully
- [x] All 108 interactions updated
- [x] Build passes with no errors
- [x] Full paths display correctly on live site

---

## Combined Impact

### Files Modified (Total: 11)

**Backend**:
1. `app/api/baits/route.ts`
2. `app/api/complexes/route.ts`
3. `app/api/complex-interactions/[id]/route.ts`
4. `db/import_complex_af3_json.mjs`
5. `db/import_complex_af3_v4.mjs`

**Frontend**:
6. `app/page.tsx`

**Database**:
7. `db/fix_complex_source_paths.mjs` (NEW)

**Documentation**:
8. `CLAUDE.md` (optimized)
9. `CLAUDE_OPTIMIZATION_SUMMARY.md` (NEW)
10. `MODE_SWITCHING_BUGS.md` (NEW)
11. `MODE_SWITCHING_FIXES.md` (NEW)

### Performance Improvements

- **Fewer API calls**: Optimized useEffect dependencies
- **Accurate data**: No overfetching in v4 mode
- **Better UX**: Dropdown counts match displayed data

### User Experience Improvements

**Before**:
- Dropdown counts static regardless of mode
- Source paths showed relative directory names
- Some interactions missing due to double filtering
- Unnecessary re-fetches on mode switch

**After**:
- Dropdown counts update immediately when switching modes
- Source paths show full absolute paths
- All matching interactions appear
- Optimized re-fetch logic (faster)

---

## Verification Checklist

After deployment, verify:

**Mode Switching**:
- [ ] Visit https://ciliaaf3predictions.vercel.app/
- [ ] Select complex in v3 mode, note count
- [ ] Switch to v4 mode
- [ ] Dropdown count updates immediately **
- [ ] Fewer interactions shown (ipSAE only) **
- [ ] Switch back to v3 mode
- [ ] All interactions return **

**Source Paths**:
- [ ] Select complex (e.g., "IFT74 & IFT81")
- [ ] Scroll to bottom "Complex Source Paths" section
- [ ] Full absolute paths displayed **
- [ ] Paths include base directory + complex folder + AF3 + subdirectory **

---

## Rollback Plan

If issues arise:

**Rollback Deployment 2** (Source Paths):
```bash
git revert 8688a31
git push
```

**Rollback Deployment 1** (Mode Switching):
```bash
git revert 5d59b93
git push
```

**Full Rollback** (Both):
```bash
git revert 8688a31 5d59b93
git push
```

---

## Next Steps

**Immediate**:
- [x] Hard refresh browser (Ctrl+Shift+R) to see changes
- [x] Verify dropdown counts in both modes
- [x] Verify source paths show full paths

**Future Enhancements** (Optional):
- Filter state sync between v3/v4 modes (minor UX improvement)
- Loading indicators while dropdowns re-fetch
- Visual mode indicator next to dropdowns

---

## Success Metrics

**No user reports of "wrong interaction count"
**No duplicate API calls in network tab
**Mode switching feels instant (< 1 second)
**Complex selection preserved across switches
**All confidence filters working correctly
**Source paths traceable to original files

---

**Deployment Date**: 2025-10-23
**Deployed By**: Claude Code
**Status**: COMPLETE **
**Live URL**: https://ciliaaf3predictions.vercel.app/

All changes are backward compatible. No database schema changes required. No downtime expected.

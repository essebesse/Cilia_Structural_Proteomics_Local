# Quick Start - Testing MolStar 3D Viewer

**5-Minute Test Guide**

## Prerequisites

✅ `structures/` directory with CIF files (2,211 files, 1.7 GB)
✅ Node.js 18+ installed
✅ Dependencies installed (`npm install` already done)

## Test Now

### 1. Start Server (30 seconds)

```bash
cd /emcc/au14762/elo_lab/SCRIPTS/Global_Analysis/Cilia_Structural_Proteomics_Local
npm run dev
```

Wait for:
```
✓ Ready in 5s
Local: http://localhost:3000
```

### 2. Open Browser

Visit: **http://localhost:3000**

### 3. Search for Protein (10 seconds)

Try any of these:
- `WDR19` → 100+ interactions
- `BBS7` → ~40 interactions
- `IFT122` → ~20 interactions
- `Q8NEZ3` → WDR19 by UniProt ID

### 4. Click "View 3D" Button (5 seconds)

In results table:
1. Find "3D Structure" column (last column)
2. Click "🔬 View 3D" button on any row
3. New window opens

### 5. Verify Structure Loads (5 seconds)

Should see:
- ✅ Loading spinner
- ✅ MolStar viewer appears
- ✅ 3D protein structure renders
- ✅ Two chains in different colors
- ✅ Can rotate with mouse

### 6. Test Interactions (30 seconds)

Try:
- **Rotate**: Click and drag
- **Zoom**: Scroll wheel
- **Pan**: Right-click and drag
- **Close**: Click "✕ Close Window"

## Expected Console Output

Press **F12** to open Developer Tools, check Console:

```
### INITIALIZING MOLSTAR PLUGIN ###
Filtering behaviors to remove external calls...
Creating Mol* plugin with spec...
Plugin created successfully
Mol* plugin initialized
Loading CIF from API...
Fetching structure: /api/structure/5
CIF loaded successfully
Applying default chain colors...
Structure loaded successfully
```

## Success Criteria

✅ No red errors in console
✅ Structure loads within 5 seconds
✅ Can rotate/zoom/pan smoothly
✅ Chains have distinct colors (blue/orange/etc.)
✅ Close button works
✅ Can open multiple structures

## Common Issues

### Issue: Button appears but structure doesn't load

**Debug**:
1. Open console (F12)
2. Look for "CIF file not found" error
3. Check: Does `structures/{bait}_{prey}.cif` exist?

**Quick fix**: Try a different interaction

### Issue: No "View 3D" buttons

**Cause**: No AF3 interactions in search results

**Fix**: Search for "WDR19" or "BBS7" (guaranteed AF3 results)

### Issue: Blank screen when clicking button

**Debug**:
1. Check console for errors
2. Look for "Failed to load validation data" (safe to ignore)
3. Verify API route: http://localhost:3000/api/structure/5

### Issue: Structure loads but viewer is tiny

**Cause**: High-res display scaling

**Already fixed**: Safe canvas dimensions calculated automatically

## Test Checklist (2 minutes)

- [ ] Server starts successfully
- [ ] Main page loads
- [ ] Search returns results
- [ ] "3D Structure" column visible
- [ ] "View 3D" button clickable
- [ ] New window opens
- [ ] Structure loads and renders
- [ ] Can interact with structure
- [ ] Close button works
- [ ] No console errors

## Example Test Interaction

**Search**: `BBS7`
**Result**: ~40 AF3 interactions
**Pick**: First row (highest confidence)
**Click**: "🔬 View 3D"
**Expected**: BBS7-BBS4 structure loads (2 chains)
**Test**: Rotate to see interface

## Full Documentation

- **Testing Guide**: `MOLSTAR_IMPLEMENTATION_STATUS.md`
- **Implementation Details**: `MOLSTAR_IMPLEMENTATION_GUIDE.md`
- **Session Summary**: `SESSION_SUMMARY.md`

## Support

If testing fails:
1. Check console for specific errors
2. Review `MOLSTAR_IMPLEMENTATION_STATUS.md` troubleshooting section
3. Verify `structures/` directory exists and has CIF files
4. Confirm `cif_manifest.json` exists in project root

---

**Test Time**: 5 minutes
**Expected Result**: Working 3D structure visualization
**Status**: ✅ Ready to test

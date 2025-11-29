# Documentation Index - Protoview Local Deployment

**Last Updated**: 2025-11-29

## For Future Claude Session 🤖

If you are Claude implementing the local deployment, read these in order:

### 1. Start Here
1. **CLAUDE.md** ⭐ **FIRST FILE - Auto-detected by Claude Code**
   - Mission statement for Claude
   - Quick start guide
   - Current status
   - What's done vs what needs to be done

2. **LOCAL_DEPLOYMENT_GUIDE.md** ⭐ **MAIN IMPLEMENTATION GUIDE**
   - Complete step-by-step guide for SQLite migration
   - Phase-by-phase instructions (13-18 hours)
   - Code examples for every phase
   - Common issues and solutions
   - Verification checklists

3. **IMPLEMENTATION_PLAN.md** - Technical Implementation Plan
   - Original 7-phase plan
   - Detailed SQL conversion examples
   - File-by-file modification list
   - Architecture decisions

4. **DATABASE_INFO.md** - Database Schema Reference
   - SQLite schema (tables, columns, indexes)
   - Database statistics
   - Query examples
   - JSONB handling

5. **README.md** - Project Overview
   - High-level context
   - Key differences from cloud version
   - Quick installation (after implementation)

### 2. Testing Guides (After Implementation)
- **QUICK_START_TESTING.md** - 5-minute test guide for MolStar
- **MOLSTAR_IMPLEMENTATION_STATUS.md** - Complete MolStar testing checklist
- **SESSION_SUMMARY.md** - What previous session accomplished

---

## For Human Readers 👤

### Getting Started
1. **README.md** - Start here for project overview
2. **LOCAL_DEPLOYMENT_GUIDE.md** - Complete setup guide
3. **QUICK_START_TESTING.md** - Quick testing guide

### Understanding the Project
- **README.md** - Project overview and features
- **DATABASE_INFO.md** - Database contents and schema
- **IMPLEMENTATION_PLAN.md** - Technical architecture

### Implementation Details
- **CLAUDE.md** - Implementation status and context
- **LOCAL_DEPLOYMENT_GUIDE.md** - Step-by-step guide
- **IMPLEMENTATION_PLAN.md** - 7-phase technical plan

### Testing
- **QUICK_START_TESTING.md** - 5-minute MolStar test
- **MOLSTAR_IMPLEMENTATION_STATUS.md** - Complete testing checklist
- **SESSION_SUMMARY.md** - Previous session results

### MolStar 3D Viewer
- **MOLSTAR_IMPLEMENTATION_GUIDE.md** - Original implementation reference
- **MOLSTAR_IMPLEMENTATION_STATUS.md** - Testing guide
- **QUICK_START_TESTING.md** - Quick test guide

---

## Complete Documentation List

### Main Documentation Files

| File | Purpose | Audience | Status |
|------|---------|----------|--------|
| **CLAUDE.md** | Auto-detected by Claude Code | Future Claude | ✅ Complete |
| **LOCAL_DEPLOYMENT_GUIDE.md** | Step-by-step implementation | Future Claude | ✅ Complete |
| **IMPLEMENTATION_PLAN.md** | 7-phase technical plan | Claude/Developers | ✅ Complete |
| **DATABASE_INFO.md** | Database schema & statistics | All | ✅ Complete |
| **README.md** | Project overview | All | ✅ Complete |

### Testing & Verification

| File | Purpose | When to Use |
|------|---------|-------------|
| **QUICK_START_TESTING.md** | 5-minute MolStar test | After MolStar setup |
| **MOLSTAR_IMPLEMENTATION_STATUS.md** | Complete MolStar checklist | MolStar implementation/testing |
| **SESSION_SUMMARY.md** | Previous session results | Understanding what was done |

### Reference & Guides

| File | Purpose | Reference Type |
|------|---------|----------------|
| **MOLSTAR_IMPLEMENTATION_GUIDE.md** | MolStar reference guide | Implementation guide |
| **structures/README.md** | CIF files documentation | Data documentation |
| **DOCUMENTATION_INDEX.md** | This file | Navigation guide |

### Parent Project Documentation

Located in `../Cilia_Structural_Proteomics/` (cloud version):
- Import workflows (INCREMENTAL_IMPORT_WORKFLOW.md)
- Functional analysis (FUNCTIONAL_ANALYSIS_GUIDE.md)
- Database backup (DATABASE_BACKUP_GUIDE.md)
- Complex imports (COMPLEX_VARIANT_GUIDE.md)
- And many more...

**Note**: Parent project documentation applies to features and workflows, but not deployment method.

---

## Documentation by Topic

### Implementation & Setup
1. CLAUDE.md - If you are Claude
2. LOCAL_DEPLOYMENT_GUIDE.md - Step-by-step guide
3. IMPLEMENTATION_PLAN.md - Technical details
4. README.md - Overview

### Database
1. DATABASE_INFO.md - Schema and statistics
2. protoview.db - SQLite database file
3. IMPLEMENTATION_PLAN.md - SQL conversion guide

### MolStar 3D Viewer
1. MOLSTAR_IMPLEMENTATION_STATUS.md - Testing guide
2. QUICK_START_TESTING.md - Quick test
3. MOLSTAR_IMPLEMENTATION_GUIDE.md - Implementation reference
4. components/StructureViewer.tsx - Component code

### Structure Files
1. structures/README.md - CIF files documentation
2. cif_manifest.json - File mappings
3. scripts/collect_cif_files.mjs - Collection script

### Testing
1. QUICK_START_TESTING.md - 5-minute test
2. MOLSTAR_IMPLEMENTATION_STATUS.md - Complete checklist
3. SESSION_SUMMARY.md - Previous results

---

## Reading Order by Role

### Future Claude Session (Implementing SQLite Migration)
**Essential reading** (in order):
1. CLAUDE.md - Context and mission
2. LOCAL_DEPLOYMENT_GUIDE.md - Main guide
3. IMPLEMENTATION_PLAN.md - Technical details
4. DATABASE_INFO.md - Schema reference

**Reference as needed**:
- README.md - Project context
- SESSION_SUMMARY.md - Previous work
- MOLSTAR_IMPLEMENTATION_STATUS.md - Testing MolStar

### Developer Setting Up Local Instance
1. README.md - Overview
2. LOCAL_DEPLOYMENT_GUIDE.md - Setup instructions
3. DATABASE_INFO.md - Understanding data
4. QUICK_START_TESTING.md - Verify it works

### Researcher/User Testing MolStar
1. QUICK_START_TESTING.md - Quick test (5 min)
2. MOLSTAR_IMPLEMENTATION_STATUS.md - Detailed testing
3. README.md - Features overview

### Maintainer/Administrator
1. README.md - Project overview
2. DATABASE_INFO.md - Database details
3. LOCAL_DEPLOYMENT_GUIDE.md - Implementation details
4. structures/README.md - Structure file management

---

## File Locations

```
Cilia_Structural_Proteomics_Local/
│
├── Core Documentation
│   ├── CLAUDE.md                              ⭐ Auto-detected by Claude
│   ├── LOCAL_DEPLOYMENT_GUIDE.md              ⭐ Main implementation guide
│   ├── IMPLEMENTATION_PLAN.md                 Technical 7-phase plan
│   ├── DATABASE_INFO.md                       Database schema & stats
│   ├── README.md                              Project overview
│   └── DOCUMENTATION_INDEX.md                 This file
│
├── Testing & Status
│   ├── QUICK_START_TESTING.md                 5-minute test guide
│   ├── MOLSTAR_IMPLEMENTATION_STATUS.md       MolStar testing checklist
│   └── SESSION_SUMMARY.md                     Previous session summary
│
├── Reference Guides
│   ├── MOLSTAR_IMPLEMENTATION_GUIDE.md        MolStar reference
│   └── structures/README.md                   CIF files documentation
│
├── Database & Data
│   ├── protoview.db                           SQLite database (1.89 MB)
│   ├── cif_manifest.json                      Structure file mappings
│   └── structures/                            2,211 CIF files (1.7 GB)
│
└── Code
    ├── app/                                    Next.js application
    ├── components/                             React components
    ├── db/                                     Import scripts
    └── scripts/                                Utility scripts
```

---

## Documentation Status

### ✅ Complete
- [x] CLAUDE.md - Claude session guide
- [x] LOCAL_DEPLOYMENT_GUIDE.md - Implementation guide
- [x] IMPLEMENTATION_PLAN.md - Technical plan
- [x] DATABASE_INFO.md - Database documentation
- [x] README.md - Project overview
- [x] MOLSTAR_IMPLEMENTATION_STATUS.md - MolStar testing
- [x] QUICK_START_TESTING.md - Quick test guide
- [x] SESSION_SUMMARY.md - Session summary
- [x] structures/README.md - Structure files docs

### 📝 To Be Created (By Future Claude Session)
After implementation, create:
- [ ] docs/IMPLEMENTATION_NOTES.md - What was changed
- [ ] docs/LOCAL_SETUP.md - Setup on new machine
- [ ] docs/TROUBLESHOOTING.md - Common issues encountered

---

## Quick Links

**For Claude**:
- Start: [CLAUDE.md](./CLAUDE.md)
- Guide: [LOCAL_DEPLOYMENT_GUIDE.md](./LOCAL_DEPLOYMENT_GUIDE.md)

**For Humans**:
- Overview: [README.md](./README.md)
- Testing: [QUICK_START_TESTING.md](./QUICK_START_TESTING.md)

**For Everyone**:
- Database: [DATABASE_INFO.md](./DATABASE_INFO.md)
- Status: [SESSION_SUMMARY.md](./SESSION_SUMMARY.md)

---

## External Resources

### Parent Project (Cloud Version)
- GitHub: https://github.com/essebesse/Cilia_Structural_Proteomics
- Live site: https://ciliaaf3predictions.vercel.app/
- Documentation: See parent repo for cloud workflow guides

### Technologies
- [Next.js Documentation](https://nextjs.org/docs)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3/wiki/API)
- [SQLite](https://www.sqlite.org/docs.html)
- [MolStar](https://molstar.org/)

### Related
- IFT_Interactors paper: `../IFT_Interactors_paper/` (reference implementation)
- AlphaFold data: `/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/`

---

## Need Help?

### If You Are Claude
1. Read CLAUDE.md first
2. Follow LOCAL_DEPLOYMENT_GUIDE.md step-by-step
3. Ask user for clarification if unclear
4. Document issues as you encounter them

### If You Are Human
1. Check README.md for overview
2. Check QUICK_START_TESTING.md for quick test
3. Check documentation files above for specific topics
4. Refer to parent project for feature documentation

---

**Last Updated**: 2025-11-29
**Created By**: Claude Code session (CIF collection + MolStar implementation)
**Purpose**: Navigation guide for all project documentation

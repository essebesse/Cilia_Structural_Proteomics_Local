# Quick Start Guide for IT Person

**Project**: Protoview Local Deployment
**Status**: Ready for implementation
**GitHub**: https://github.com/essebesse/Cilia_Structural_Proteomics_Local
**Estimated Time**: 15-21 hours

## Start Here

1. **Clone the repository**:
   ```bash
   git clone https://github.com/essebesse/Cilia_Structural_Proteomics_Local.git
   cd Cilia_Structural_Proteomics_Local
   ```

2. **Read these 3 files in order**:
   - `README.md` - Project overview (5 min read)
   - `IT_HANDOFF_GUIDE.md` - Implementation overview (10 min read)
   - `IMPLEMENTATION_PLAN.md` - Complete detailed plan (30 min read)

3. **Start implementation**:
   - Follow the 7 phases in `IMPLEMENTATION_PLAN.md`
   - Test after each phase
   - Document any issues

## What You're Building

Convert this Next.js app from:
- **Cloud**: Vercel + PostgreSQL (Neon) → **Local**: Node.js + SQLite
- Same features, runs offline on local Linux server
- Pre-populated database included

## Key Files

| File | Purpose |
|------|---------|
| `README.md` | Project overview and features |
| `IT_HANDOFF_GUIDE.md` | Quick implementation overview |
| `IMPLEMENTATION_PLAN.md` | Complete 7-phase detailed plan |
| `CLAUDE.md` | Technical guidance and examples |
| `package.json` | Dependencies (will be modified) |
| `db/*.mjs` | 37 import scripts (need conversion) |
| `app/api/**/*.ts` | 5 API routes (need conversion) |

## Implementation Phases

1. **Setup SQLite** (2-3 hours) - Install better-sqlite3, create abstractions
2. **Database Schema** (1-2 hours) - Convert PostgreSQL → SQLite
3. **API Routes** (3-4 hours) - Update 5 route files
4. **Import Scripts** (6-8 hours) - Update 37 script files
5. **Database Population** (1-2 hours) - Export and import data
6. **Documentation** (2-3 hours) - Write installation guides
7. **Testing** (1-2 hours) - Verify everything works

## Success Criteria

When done, users should be able to:
```bash
git clone https://github.com/essebesse/Cilia_Structural_Proteomics_Local.git
cd Cilia_Structural_Proteomics_Local
npm install
npm run dev
# Open http://localhost:3000 - working app!
```

## Questions?

- **Technical details**: See `IMPLEMENTATION_PLAN.md`
- **Code examples**: See `CLAUDE.md`
- **Features**: See parent repo https://github.com/essebesse/Cilia_Structural_Proteomics

---

**Ready to start? Read `IT_HANDOFF_GUIDE.md` next!**

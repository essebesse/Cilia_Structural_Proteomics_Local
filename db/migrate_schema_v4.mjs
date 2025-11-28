#!/usr/bin/env node
/**
 * Database Schema Migration: Add ipSAE Support (v4)
 * ==================================================
 *
 * Adds ipSAE scoring columns to interactions and complex_interactions tables.
 * This migration is NON-DESTRUCTIVE - existing data remains unchanged.
 *
 * New columns (all nullable for backward compatibility):
 * - ipsae: FLOAT - ipSAE score (0.0-1.0)
 * - ipsae_confidence: ENUM - 'High', 'Medium', 'Low', 'Very Low'
 * - ipsae_pae_cutoff: FLOAT - PAE cutoff used (typically 10.0Å)
 * - analysis_version: VARCHAR - 'v3' or 'v4'
 *
 * Usage:
 *   node db/migrate_schema_v4.mjs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

async function migrateSchema() {
  console.log('🔄 Database Schema Migration: Adding ipSAE Support (v4)');
  console.log('═'.repeat(70));

  try {
    // Step 1: Create ipSAE confidence level ENUM type
    console.log('\n📋 Step 1: Creating ipSAE confidence level ENUM...');
    try {
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ipsae_confidence_level') THEN
            CREATE TYPE ipsae_confidence_level AS ENUM (
              'High',
              'Medium',
              'Low',
              'Very Low'
            );
            RAISE NOTICE 'Created ipsae_confidence_level ENUM type';
          ELSE
            RAISE NOTICE 'ipsae_confidence_level ENUM type already exists';
          END IF;
        END $$;
      `;
      console.log('✅ ipSAE confidence ENUM ready');
    } catch (error) {
      console.error('⚠️  ENUM creation issue:', error.message);
      // Continue anyway - might already exist
    }

    // Step 2: Add columns to interactions table
    console.log('\n📋 Step 2: Adding ipSAE columns to interactions table...');

    // Check if columns already exist
    const interactionsCheck = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'interactions'
        AND column_name IN ('ipsae', 'ipsae_confidence', 'ipsae_pae_cutoff', 'analysis_version')
    `;

    const existingColumns = new Set(interactionsCheck.rows.map(r => r.column_name));

    if (!existingColumns.has('ipsae')) {
      await sql`ALTER TABLE interactions ADD COLUMN ipsae FLOAT`;
      console.log('  ✓ Added ipsae column');
    } else {
      console.log('  → ipsae column already exists');
    }

    if (!existingColumns.has('ipsae_confidence')) {
      await sql`ALTER TABLE interactions ADD COLUMN ipsae_confidence ipsae_confidence_level`;
      console.log('  ✓ Added ipsae_confidence column');
    } else {
      console.log('  → ipsae_confidence column already exists');
    }

    if (!existingColumns.has('ipsae_pae_cutoff')) {
      await sql`ALTER TABLE interactions ADD COLUMN ipsae_pae_cutoff FLOAT DEFAULT 10.0`;
      console.log('  ✓ Added ipsae_pae_cutoff column');
    } else {
      console.log('  → ipsae_pae_cutoff column already exists');
    }

    if (!existingColumns.has('analysis_version')) {
      await sql`ALTER TABLE interactions ADD COLUMN analysis_version VARCHAR(10) DEFAULT 'v3'`;
      console.log('  ✓ Added analysis_version column');
    } else {
      console.log('  → analysis_version column already exists');
    }

    // Step 3: Add columns to complex_interactions table
    console.log('\n📋 Step 3: Adding ipSAE columns to complex_interactions table...');

    const complexCheck = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'complex_interactions'
        AND column_name IN ('ipsae', 'ipsae_confidence', 'ipsae_pae_cutoff', 'analysis_version')
    `;

    const existingComplexColumns = new Set(complexCheck.rows.map(r => r.column_name));

    if (!existingComplexColumns.has('ipsae')) {
      await sql`ALTER TABLE complex_interactions ADD COLUMN ipsae FLOAT`;
      console.log('  ✓ Added ipsae column');
    } else {
      console.log('  → ipsae column already exists');
    }

    if (!existingComplexColumns.has('ipsae_confidence')) {
      await sql`ALTER TABLE complex_interactions ADD COLUMN ipsae_confidence ipsae_confidence_level`;
      console.log('  ✓ Added ipsae_confidence column');
    } else {
      console.log('  → ipsae_confidence column already exists');
    }

    if (!existingComplexColumns.has('ipsae_pae_cutoff')) {
      await sql`ALTER TABLE complex_interactions ADD COLUMN ipsae_pae_cutoff FLOAT DEFAULT 10.0`;
      console.log('  ✓ Added ipsae_pae_cutoff column');
    } else {
      console.log('  → ipsae_pae_cutoff column already exists');
    }

    if (!existingComplexColumns.has('analysis_version')) {
      await sql`ALTER TABLE complex_interactions ADD COLUMN analysis_version VARCHAR(10) DEFAULT 'v3'`;
      console.log('  ✓ Added analysis_version column');
    } else {
      console.log('  → analysis_version column already exists');
    }

    // Step 4: Create indexes for performance
    console.log('\n📋 Step 4: Creating indexes for ipSAE columns...');

    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_interactions_ipsae
        ON interactions(ipsae)
        WHERE ipsae IS NOT NULL
      `;
      console.log('  ✓ Created index on interactions.ipsae');
    } catch (error) {
      console.log('  → Index on interactions.ipsae already exists');
    }

    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_interactions_ipsae_confidence
        ON interactions(ipsae_confidence)
      `;
      console.log('  ✓ Created index on interactions.ipsae_confidence');
    } catch (error) {
      console.log('  → Index on interactions.ipsae_confidence already exists');
    }

    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_interactions_analysis_version
        ON interactions(analysis_version)
      `;
      console.log('  ✓ Created index on interactions.analysis_version');
    } catch (error) {
      console.log('  → Index on interactions.analysis_version already exists');
    }

    try {
      await sql`
        CREATE INDEX IF NOT EXISTS idx_complex_interactions_ipsae
        ON complex_interactions(ipsae)
        WHERE ipsae IS NOT NULL
      `;
      console.log('  ✓ Created index on complex_interactions.ipsae');
    } catch (error) {
      console.log('  → Index on complex_interactions.ipsae already exists');
    }

    // Step 5: Verify migration
    console.log('\n📋 Step 5: Verifying schema changes...');

    const interactionsColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'interactions'
        AND column_name IN ('ipsae', 'ipsae_confidence', 'ipsae_pae_cutoff', 'analysis_version')
      ORDER BY column_name
    `;

    console.log('\n  interactions table:');
    interactionsColumns.rows.forEach(col => {
      console.log(`    ${col.column_name.padEnd(20)} ${col.data_type.padEnd(20)} nullable:${col.is_nullable} default:${col.column_default || 'NULL'}`);
    });

    const complexColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'complex_interactions'
        AND column_name IN ('ipsae', 'ipsae_confidence', 'ipsae_pae_cutoff', 'analysis_version')
      ORDER BY column_name
    `;

    console.log('\n  complex_interactions table:');
    complexColumns.rows.forEach(col => {
      console.log(`    ${col.column_name.padEnd(20)} ${col.data_type.padEnd(20)} nullable:${col.is_nullable} default:${col.column_default || 'NULL'}`);
    });

    // Step 6: Show current statistics
    console.log('\n📊 Database Statistics:');

    const stats = await sql`
      SELECT
        COUNT(*) as total_interactions,
        COUNT(ipsae) as with_ipsae,
        COUNT(CASE WHEN analysis_version = 'v4' THEN 1 END) as v4_count,
        COUNT(CASE WHEN analysis_version = 'v3' OR analysis_version IS NULL THEN 1 END) as v3_count
      FROM interactions
    `;

    console.log(`  Total interactions: ${stats.rows[0].total_interactions}`);
    console.log(`  With ipSAE scores: ${stats.rows[0].with_ipsae}`);
    console.log(`  v4 analysis: ${stats.rows[0].v4_count}`);
    console.log(`  v3 analysis: ${stats.rows[0].v3_count}`);

    console.log('\n' + '═'.repeat(70));
    console.log('✅ Schema migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Run batch import: node db/batch_import_af3_v4.mjs');
    console.log('  2. Check database: node db/check_db.mjs');
    console.log('  3. Deploy frontend changes to display ipSAE data');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migration
migrateSchema()
  .then(() => {
    console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });

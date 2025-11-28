#!/usr/bin/env node
/**
 * Migration Script: Recalculate Confidence Levels
 *
 * This script recalculates confidence levels for ALL interactions in the database
 * using the new interface quality-centric scheme.
 *
 * SAFE TO RUN:
 * - Only updates the 'confidence' field
 * - Does NOT modify any other data
 * - Uses existing data (iptm, contacts_pae_lt_3, interface_plddt)
 * - Can be run multiple times safely (idempotent)
 * - No original data files needed
 *
 * Usage:
 *   export POSTGRES_URL="postgresql://..."
 *   node db/migrate_confidence_levels.mjs
 */

import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

/**
 * Calculate confidence level using new interface quality-centric scheme
 */
function calculateConfidence(iptm, contacts, iplddt, alphafold_version) {
  // AF2 predictions have NULL confidence (displayed separately)
  if (alphafold_version === 'AF2') {
    return null;
  }

  // Convert to numbers, handle NULL/undefined
  const iptmVal = parseFloat(iptm) || 0;
  const contactsVal = parseInt(contacts) || 0;
  const ipLDDTVal = parseFloat(iplddt) || 0;

  // HIGH CONFIDENCE
  // Criteria: iPTM ≥ 0.7 OR (contacts ≥ 40 AND ipLDDT ≥ 80) OR (contacts ≥ 30 AND iPTM ≥ 0.5 AND ipLDDT ≥ 80)
  // BUT exclude if iPTM < 0.75 AND contacts < 5
  const meetsHighCriteria =
    iptmVal >= 0.7 ||
    (contactsVal >= 40 && ipLDDTVal >= 80) ||
    (contactsVal >= 30 && iptmVal >= 0.5 && ipLDDTVal >= 80);

  const isExcludedFromHigh = iptmVal < 0.75 && contactsVal < 5;

  if (meetsHighCriteria && !isExcludedFromHigh) {
    return 'High';
  }

  // MEDIUM CONFIDENCE
  // Criteria: iPTM ≥ 0.6 OR (contacts ≥ 20 AND ipLDDT ≥ 75) OR (contacts ≥ 15 AND iPTM ≥ 0.45)
  if (
    iptmVal >= 0.6 ||
    (contactsVal >= 20 && ipLDDTVal >= 75) ||
    (contactsVal >= 15 && iptmVal >= 0.45)
  ) {
    return 'Medium';
  }

  // LOW CONFIDENCE
  return 'Low';
}

async function migrateConfidenceLevels() {
  const client = await db.connect();

  try {
    console.log('🔄 Confidence Level Migration\n');
    console.log('This script recalculates confidence levels using the new interface quality-centric scheme.');
    console.log('Safe to run - only updates confidence field, preserves all other data.\n');

    // Get all interactions
    const result = await client.query(`
      SELECT
        id,
        iptm,
        contacts_pae_lt_3,
        interface_plddt,
        alphafold_version,
        confidence as old_confidence
      FROM interactions
      ORDER BY id
    `);

    console.log(`📊 Found ${result.rows.length} interactions to process\n`);

    if (result.rows.length === 0) {
      console.log('✅ No interactions to process');
      return;
    }

    let updated = 0;
    let unchanged = 0;
    let af2Count = 0;
    const changes = {
      'High': 0,
      'Medium': 0,
      'Low': 0,
      'AF2': 0
    };

    console.log('Processing interactions...\n');

    for (const row of result.rows) {
      const newConfidence = calculateConfidence(
        row.iptm,
        row.contacts_pae_lt_3,
        row.interface_plddt,
        row.alphafold_version
      );

      // Update database
      await client.query(
        `UPDATE interactions SET confidence = $1 WHERE id = $2`,
        [newConfidence, row.id]
      );

      if (newConfidence === null) {
        af2Count++;
      } else {
        changes[newConfidence]++;
      }

      if (row.old_confidence !== newConfidence) {
        updated++;
      } else {
        unchanged++;
      }

      // Progress indicator (every 100 interactions)
      if ((updated + unchanged) % 100 === 0) {
        console.log(`  Processed ${updated + unchanged} / ${result.rows.length}...`);
      }
    }

    console.log('\n✅ Migration Complete!\n');
    console.log('📈 Summary:');
    console.log(`  Total interactions: ${result.rows.length}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Unchanged: ${unchanged}`);
    console.log('');
    console.log('📊 New Confidence Distribution:');
    console.log(`  High: ${changes['High']} interactions`);
    console.log(`  Medium: ${changes['Medium']} interactions`);
    console.log(`  Low: ${changes['Low']} interactions`);
    console.log(`  AF2 (NULL): ${af2Count} interactions`);
    console.log('');
    console.log('🎯 Impact Analysis:');
    console.log(`  Confidence assignments: ${updated > 0 ? 'CHANGED' : 'No changes'}`);
    console.log(`  High-confidence interactions: ${changes['High']} (${Math.round(100 * changes['High'] / result.rows.length)}%)`);
    console.log(`  Medium-confidence interactions: ${changes['Medium']} (${Math.round(100 * changes['Medium'] / result.rows.length)}%)`);
    console.log(`  Low-confidence interactions: ${changes['Low']} (${Math.round(100 * changes['Low'] / result.rows.length)}%)`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

console.log('🔄 Starting Confidence Level Migration\n');

migrateConfidenceLevels()
  .then(() => {
    console.log('\n✅ Migration completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('  1. Refresh your browser (Ctrl+Shift+R)');
    console.log('  2. Frontend will now read confidence from database');
    console.log('  3. No more client-side calculations needed!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  });

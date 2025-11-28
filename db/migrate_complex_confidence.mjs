#!/usr/bin/env node
/**
 * Migration Script: Fix Complex Interactions Confidence Levels
 *
 * This script recalculates confidence levels for complex_interactions table
 * using the same interface quality-centric scheme as regular interactions.
 *
 * Usage:
 *   export POSTGRES_URL="postgresql://..."
 *   node db/migrate_complex_confidence.mjs
 */

import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

/**
 * Calculate confidence level using interface quality-centric scheme
 * Same logic as migrate_confidence_levels.mjs
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
  const meetsHighCriteria =
    iptmVal >= 0.7 ||
    (contactsVal >= 40 && ipLDDTVal >= 80) ||
    (contactsVal >= 30 && iptmVal >= 0.5 && ipLDDTVal >= 80);

  const isExcludedFromHigh = iptmVal < 0.75 && contactsVal < 5;

  if (meetsHighCriteria && !isExcludedFromHigh) {
    return 'High';
  }

  // MEDIUM CONFIDENCE
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

async function migrateComplexConfidence() {
  const client = await db.connect();

  try {
    console.log('🔄 Complex Interactions Confidence Migration\n');
    console.log('Fixing confidence levels in complex_interactions table...\n');

    // Get all complex interactions
    const result = await client.query(`
      SELECT
        id,
        iptm,
        contacts_pae_lt_3,
        interface_plddt,
        alphafold_version,
        confidence as old_confidence
      FROM complex_interactions
      ORDER BY id
    `);

    console.log(`📊 Found ${result.rows.length} complex interactions to process\n`);

    if (result.rows.length === 0) {
      console.log('✅ No complex interactions to process');
      return;
    }

    let updated = 0;
    const changes = {
      'High': 0,
      'Medium': 0,
      'Low': 0,
      'AF2': 0
    };

    console.log('Processing complex interactions...\n');

    for (const row of result.rows) {
      const newConfidence = calculateConfidence(
        row.iptm,
        row.contacts_pae_lt_3,
        row.interface_plddt,
        row.alphafold_version
      );

      // Update database
      await client.query(
        `UPDATE complex_interactions SET confidence = $1 WHERE id = $2`,
        [newConfidence, row.id]
      );

      if (newConfidence === null) {
        changes['AF2']++;
      } else {
        changes[newConfidence]++;
      }

      if (row.old_confidence !== newConfidence) {
        updated++;
        console.log(`  ID ${row.id}: "${row.old_confidence}" → "${newConfidence}" (iPTM=${row.iptm}, contacts=${row.contacts_pae_lt_3}, ipLDDT=${row.interface_plddt})`);
      }
    }

    console.log('\n✅ Migration Complete!\n');
    console.log('📈 Summary:');
    console.log(`  Total complex interactions: ${result.rows.length}`);
    console.log(`  Updated: ${updated}`);
    console.log('');
    console.log('📊 New Confidence Distribution:');
    console.log(`  High: ${changes['High']} interactions`);
    console.log(`  Medium: ${changes['Medium']} interactions`);
    console.log(`  Low: ${changes['Low']} interactions`);
    console.log(`  AF2 (NULL): ${changes['AF2']} interactions`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

console.log('🔄 Starting Complex Confidence Migration\n');

migrateComplexConfidence()
  .then(() => {
    console.log('\n✅ Migration completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('  1. Hard refresh browser (Ctrl+Shift+R)');
    console.log('  2. Select IFT74_81 complex from dropdown');
    console.log('  3. Should now show interactions!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  });

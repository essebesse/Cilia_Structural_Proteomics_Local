#!/usr/bin/env node
/**
 * Deduplicate Interactions Script
 * ================================
 *
 * Removes duplicate interactions that were created when importing both v3 and v4
 * JSON files with different source_path values.
 *
 * Strategy:
 * - Find interactions that exist in BOTH v3 and v4 source paths
 * - For those duplicates, KEEP the v4 version (has ipSAE data)
 * - DELETE only the v3 version
 * - PRESERVE all v3-only interactions (not in v4)
 * - PRESERVE all v4-only interactions (not in v3)
 *
 * Usage:
 *   node db/deduplicate_interactions.mjs [--dry-run]
 *
 * Safety:
 * - Dry-run mode by default (shows what would be deleted)
 * - Use --execute flag to actually delete duplicates
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';

const DRY_RUN = !process.argv.includes('--execute');

async function deduplicateInteractions() {
  console.log('\n🔍 Interaction Deduplication Tool');
  console.log('═'.repeat(70));

  if (DRY_RUN) {
    console.log('🛡️  DRY-RUN MODE: No changes will be made to the database');
    console.log('    Use --execute flag to actually remove duplicates\n');
  } else {
    console.log('⚠️  EXECUTE MODE: Duplicates WILL BE DELETED!');
    console.log('    Press Ctrl+C within 3 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
    // Step 1: Find interactions that exist in BOTH v3 and v4
    console.log('Step 1: Finding v3/v4 duplicate pairs...');

    const v3v4Duplicates = await sql`
      WITH duplicate_groups AS (
        SELECT
          bait_protein_id,
          prey_protein_id,
          iptm,
          contacts_pae_lt_3,
          interface_plddt,
          COUNT(*) as entry_count,
          BOOL_OR(source_path LIKE '%v3.json') as has_v3,
          BOOL_OR(source_path LIKE '%v4.json') as has_v4
        FROM interactions
        GROUP BY bait_protein_id, prey_protein_id, iptm, contacts_pae_lt_3, interface_plddt
        HAVING COUNT(*) > 1
      )
      SELECT
        dg.bait_protein_id,
        dg.prey_protein_id,
        dg.iptm,
        dg.contacts_pae_lt_3,
        dg.interface_plddt,
        dg.entry_count,
        dg.has_v3,
        dg.has_v4
      FROM duplicate_groups dg
      WHERE dg.has_v3 AND dg.has_v4
      ORDER BY dg.entry_count DESC
    `;

    const v3v4Groups = v3v4Duplicates.rows.length;
    console.log(`  ✓ Found ${v3v4Groups} interactions with both v3 and v4 entries\n`);

    if (v3v4Groups === 0) {
      console.log('✅ No v3/v4 duplicates found! Database is clean.\n');
      return;
    }

    // Step 2: Identify v3 entries to delete
    console.log('Step 2: Identifying v3 entries to delete...');
    const idsToDelete = [];
    let v3OnlyCount = 0;
    let v4OnlyCount = 0;

    for (const group of v3v4Duplicates.rows) {
      // Get all entries for this interaction
      const entries = await sql`
        SELECT id, source_path, ipsae, analysis_version
        FROM interactions
        WHERE bait_protein_id = ${group.bait_protein_id}
          AND prey_protein_id = ${group.prey_protein_id}
          AND iptm = ${group.iptm}
          AND contacts_pae_lt_3 = ${group.contacts_pae_lt_3}
          AND interface_plddt = ${group.interface_plddt}
        ORDER BY
          CASE WHEN source_path LIKE '%v4.json' THEN 1 ELSE 2 END,
          id DESC
      `;

      // Separate v3 and v4 entries
      const v4Entries = entries.rows.filter(e => e.source_path.includes('v4.json'));
      const v3Entries = entries.rows.filter(e => e.source_path.includes('v3.json'));

      // If both exist, mark v3 for deletion
      if (v4Entries.length > 0 && v3Entries.length > 0) {
        idsToDelete.push(...v3Entries.map(e => e.id));
      }

      v3OnlyCount += v3Entries.filter(e => v4Entries.length === 0).length;
      v4OnlyCount += v4Entries.filter(e => v3Entries.length === 0).length;
    }

    console.log(`  ✓ Will delete ${idsToDelete.length} v3 duplicate entries`);
    console.log(`  ✓ Will preserve v3-only entries (not in v4)`);
    console.log(`  ✓ Will preserve v4 entries (with ipSAE data)\n`);

    // Step 3: Get overall statistics
    console.log('Step 3: Database statistics...');
    const stats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE source_path LIKE '%v3.json') as v3_total,
        COUNT(*) FILTER (WHERE source_path LIKE '%v4.json') as v4_total,
        COUNT(*) FILTER (WHERE source_path NOT LIKE '%v3.json' AND source_path NOT LIKE '%v4.json') as other_total,
        COUNT(*) as total
      FROM interactions
    `;

    const currentStats = stats.rows[0];
    console.log(`  Current interactions:`);
    console.log(`    v3.json entries: ${currentStats.v3_total}`);
    console.log(`    v4.json entries: ${currentStats.v4_total}`);
    console.log(`    Other entries: ${currentStats.other_total}`);
    console.log(`    Total: ${currentStats.total}`);
    console.log(`\n  After deduplication:`);
    console.log(`    v3.json entries: ${currentStats.v3_total - idsToDelete.length}`);
    console.log(`    v4.json entries: ${currentStats.v4_total} (unchanged)`);
    console.log(`    Other entries: ${currentStats.other_total} (unchanged)`);
    console.log(`    Total: ${currentStats.total - idsToDelete.length} (${idsToDelete.length} fewer)\n`);

    // Step 4: Show sample of what will be deleted
    console.log('Step 4: Sample duplicates to be removed (first 10):');
    const sampleGroups = v3v4Duplicates.rows.slice(0, 10);

    for (let i = 0; i < sampleGroups.length; i++) {
      const group = sampleGroups[i];

      // Get entries
      const entries = await sql`
        SELECT id, source_path, ipsae
        FROM interactions
        WHERE bait_protein_id = ${group.bait_protein_id}
          AND prey_protein_id = ${group.prey_protein_id}
          AND iptm = ${group.iptm}
          AND contacts_pae_lt_3 = ${group.contacts_pae_lt_3}
          AND interface_plddt = ${group.interface_plddt}
      `;

      // Get protein names
      const proteinInfo = await sql`
        SELECT p1.uniprot_id as bait, p1.gene_name as bait_gene,
               p2.uniprot_id as prey, p2.gene_name as prey_gene
        FROM proteins p1, proteins p2
        WHERE p1.id = ${group.bait_protein_id}
          AND p2.id = ${group.prey_protein_id}
      `;

      const info = proteinInfo.rows[0];
      const baitDisplay = info.bait_gene || info.bait;
      const preyDisplay = info.prey_gene || info.prey;

      const v4Entry = entries.rows.find(e => e.source_path.includes('v4.json'));
      const v3Entries = entries.rows.filter(e => e.source_path.includes('v3.json'));

      console.log(`  [${i + 1}] ${baitDisplay} → ${preyDisplay} (iPTM: ${group.iptm})`);
      if (v4Entry) {
        const ipsaeInfo = v4Entry.ipsae ? `ipSAE: ${v4Entry.ipsae.toFixed(3)}` : 'ipSAE: N/A';
        console.log(`      KEEP: ID ${v4Entry.id} (v4, ${ipsaeInfo})`);
      }
      if (v3Entries.length > 0) {
        console.log(`      DELETE: ${v3Entries.map(e => `ID ${e.id}`).join(', ')} (v3)`);
      }
    }

    if (v3v4Groups > 10) {
      console.log(`\n      ... and ${v3v4Groups - 10} more duplicate pairs`);
    }

    // Step 5: Delete duplicates (if not dry-run)
    if (!DRY_RUN) {
      console.log('\n\nStep 5: Deleting v3 duplicates...');

      if (idsToDelete.length === 0) {
        console.log('  No duplicates to delete!\n');
        return;
      }

      // Delete in batches of 100
      const batchSize = 100;
      let deleted = 0;

      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);

        const result = await sql`
          DELETE FROM interactions
          WHERE id = ANY(${batch})
        `;

        deleted += batch.length;
        console.log(`  ✓ Deleted ${deleted}/${idsToDelete.length} v3 duplicates`);
      }

      console.log('\n✅ Deduplication complete!');
      console.log(`  Removed ${deleted} v3 duplicate interactions`);
      console.log(`  Preserved all unique v3 interactions`);
      console.log(`  Preserved all v4 interactions with ipSAE data\n`);
    } else {
      console.log('\n\n🛡️  DRY-RUN MODE: No changes were made');
      console.log('    Run with --execute flag to perform the deletion:\n');
      console.log('    node db/deduplicate_interactions.mjs --execute\n');
    }

    // Step 6: Verify results
    if (!DRY_RUN) {
      console.log('Step 6: Verifying results...');
      const remainingDuplicates = await sql`
        WITH duplicate_groups AS (
          SELECT
            bait_protein_id,
            prey_protein_id,
            iptm,
            contacts_pae_lt_3,
            interface_plddt,
            COUNT(*) as entry_count,
            BOOL_OR(source_path LIKE '%v3.json') as has_v3,
            BOOL_OR(source_path LIKE '%v4.json') as has_v4
          FROM interactions
          GROUP BY bait_protein_id, prey_protein_id, iptm, contacts_pae_lt_3, interface_plddt
          HAVING COUNT(*) > 1
        )
        SELECT COUNT(*) as count
        FROM duplicate_groups
        WHERE has_v3 AND has_v4
      `;

      const remaining = parseInt(remainingDuplicates.rows[0].count);

      if (remaining === 0) {
        console.log('  ✅ Success! No v3/v4 duplicates remain.\n');
      } else {
        console.log(`  ⚠️  Warning: ${remaining} v3/v4 duplicate groups still remain.`);
        console.log('     You may need to run this script again.\n');
      }

      // Show final statistics
      const finalStats = await sql`
        SELECT
          COUNT(*) FILTER (WHERE source_path LIKE '%v3.json') as v3_total,
          COUNT(*) FILTER (WHERE source_path LIKE '%v4.json') as v4_total,
          COUNT(*) as total
        FROM interactions
      `;

      const final = finalStats.rows[0];
      console.log('  Final database state:');
      console.log(`    v3 interactions: ${final.v3_total}`);
      console.log(`    v4 interactions: ${final.v4_total}`);
      console.log(`    Total interactions: ${final.total}\n`);
    }

  } catch (error) {
    console.error('\n❌ Error during deduplication:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Main execution
if (!process.env.POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

deduplicateInteractions()
  .then(() => {
    console.log('✅ Script completed successfully!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Fatal error:', err);
    console.error(err.stack);
    process.exit(1);
  });

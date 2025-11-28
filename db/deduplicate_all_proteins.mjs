#!/usr/bin/env node
/**
 * Global Deduplication Script
 * ============================
 *
 * Removes ALL duplicate interactions across the entire database.
 * Uses the same proven logic as deduplicate_single_protein.mjs
 *
 * Usage:
 *   node db/deduplicate_all_proteins.mjs          # Dry-run
 *   node db/deduplicate_all_proteins.mjs --execute  # Actually delete
 */

import { sql } from '@vercel/postgres';

const EXECUTE = process.argv.includes('--execute');

async function deduplicateAllProteins() {
  console.log('\n🔍 Global Interaction Deduplication Tool');
  console.log('═'.repeat(70));

  if (EXECUTE) {
    console.log('⚠️  EXECUTE MODE: Duplicates WILL BE DELETED!\n');
    console.log('   Starting in 5 seconds... Press Ctrl+C to cancel\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log('🛡️  DRY-RUN MODE: No changes will be made\n');
  }

  try {
    // Step 1: Find all duplicate groups
    console.log('Step 1: Finding all duplicate groups...');

    const duplicateGroups = await sql`
      SELECT
        bait_protein_id,
        prey_protein_id,
        iptm,
        COALESCE(contacts_pae_lt_3, 0) as contacts,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id ORDER BY
          CASE WHEN source_path LIKE '%v4.json' THEN 1
               WHEN source_path LIKE '%v3.json' THEN 2
               ELSE 3 END,
          id DESC
        ) as ids,
        ARRAY_AGG(source_path ORDER BY
          CASE WHEN source_path LIKE '%v4.json' THEN 1
               WHEN source_path LIKE '%v3.json' THEN 2
               ELSE 3 END,
          id DESC
        ) as paths
      FROM interactions
      GROUP BY bait_protein_id, prey_protein_id, iptm, COALESCE(contacts_pae_lt_3, 0)
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `;

    const totalGroups = duplicateGroups.rows.length;
    const totalDuplicates = duplicateGroups.rows.reduce(
      (sum, row) => sum + (parseInt(row.duplicate_count) - 1),
      0
    );

    console.log(`  ✓ Found ${totalGroups} duplicate groups`);
    console.log(`  ✓ Total duplicate entries to remove: ${totalDuplicates}\n`);

    if (totalGroups === 0) {
      console.log('✅ No duplicates found! Database is clean.\n');
      return;
    }

    // Step 2: Analyze what will be kept/deleted
    console.log('Step 2: Analyzing duplicates...');

    const idsToDelete = [];
    let v4Kept = 0;
    let v3Kept = 0;
    let otherKept = 0;

    for (const group of duplicateGroups.rows) {
      const ids = group.ids;
      const paths = group.paths;

      // Keep first (sorted by preference: v4 > v3 > newest)
      const keepId = ids[0];
      const keepPath = paths[0];

      // Track what we're keeping
      if (keepPath && keepPath.includes('v4.json')) {
        v4Kept++;
      } else if (keepPath && keepPath.includes('v3.json')) {
        v3Kept++;
      } else {
        otherKept++;
      }

      // Mark rest for deletion
      idsToDelete.push(...ids.slice(1));
    }

    console.log(`  ✓ Keeping ${v4Kept} v4 entries (with ipSAE)`);
    console.log(`  ✓ Keeping ${v3Kept} v3 entries (no v4 version)`);
    console.log(`  ✓ Keeping ${otherKept} other entries`);
    console.log(`  ✓ Will delete ${idsToDelete.length} duplicate entries\n`);

    // Step 3: Show sample
    console.log('Step 3: Sample duplicates (first 10):');
    const sampleGroups = duplicateGroups.rows.slice(0, 10);

    for (let i = 0; i < sampleGroups.length; i++) {
      const group = sampleGroups[i];

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

      const keepId = group.ids[0];
      const keepPath = group.paths[0] || '';
      const keepVersion = keepPath.includes('v4') ? 'v4' : (keepPath.includes('v3') ? 'v3' : 'other');

      console.log(`  [${i + 1}] ${baitDisplay} → ${preyDisplay} (iPTM: ${group.iptm}, count: ${group.duplicate_count})`);
      console.log(`      KEEP: ID ${keepId} (${keepVersion})`);
      console.log(`      DELETE: ${group.ids.slice(1).length} duplicate(s)`);
    }

    if (totalGroups > 10) {
      console.log(`\n      ... and ${totalGroups - 10} more groups`);
    }

    // Step 4: Database stats
    console.log('\n\nStep 4: Database statistics...');
    const stats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE source_path LIKE '%v3.json') as v3_count,
        COUNT(*) FILTER (WHERE source_path LIKE '%v4.json') as v4_count,
        COUNT(*) as total
      FROM interactions
    `;

    const current = stats.rows[0];
    console.log(`  Current: ${current.total} interactions (${current.v3_count} v3, ${current.v4_count} v4)`);
    console.log(`  After:   ${parseInt(current.total) - idsToDelete.length} interactions (-${idsToDelete.length})\n`);

    // Step 5: Execute deletion
    if (EXECUTE) {
      console.log('Step 5: Deleting duplicates...\n');

      const batchSize = 100;
      let deleted = 0;

      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);

        const result = await sql`
          DELETE FROM interactions
          WHERE id = ANY(${batch})
        `;

        deleted += batch.length;
        if (deleted % 500 === 0 || deleted === idsToDelete.length) {
          console.log(`  ✓ Deleted ${deleted}/${idsToDelete.length} duplicates`);
        }
      }

      console.log('\n✅ Deduplication complete!');
      console.log(`  Removed ${deleted} duplicate interactions\n`);

      // Verify
      const remaining = await sql`
        SELECT COUNT(*) as count
        FROM (
          SELECT bait_protein_id, prey_protein_id, iptm, COALESCE(contacts_pae_lt_3, 0) as contacts
          FROM interactions
          GROUP BY bait_protein_id, prey_protein_id, iptm, COALESCE(contacts_pae_lt_3, 0)
          HAVING COUNT(*) > 1
        ) as dups
      `;

      const remainingCount = parseInt(remaining.rows[0].count);
      if (remainingCount === 0) {
        console.log('  ✅ Verification passed: No duplicates remain\n');
      } else {
        console.log(`  ⚠️  Warning: ${remainingCount} duplicate groups still exist\n`);
      }

      // Final stats
      const finalStats = await sql`
        SELECT COUNT(*) as total FROM interactions
      `;
      console.log(`  Final total: ${finalStats.rows[0].total} interactions\n`);

    } else {
      console.log('\n\n🛡️  DRY-RUN MODE: No changes were made');
      console.log('    Run with --execute to perform deletion:\n');
      console.log('    node db/deduplicate_all_proteins.mjs --execute\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

if (!process.env.POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

deduplicateAllProteins()
  .then(() => {
    console.log('✅ Done!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

#!/usr/bin/env node
/**
 * Deduplicate Single Protein Interactions
 * ========================================
 *
 * Removes duplicate interactions for a specific bait protein.
 * Useful for testing deduplication logic on a small subset before full cleanup.
 *
 * Usage:
 *   node db/deduplicate_single_protein.mjs <uniprot_id> [--execute]
 *
 * Example:
 *   node db/deduplicate_single_protein.mjs A0A2K3E7K0        # Dry-run
 *   node db/deduplicate_single_protein.mjs A0A2K3E7K0 --execute  # Actually delete
 */

import { sql } from '@vercel/postgres';

const UNIPROT_ID = process.argv[2];
const EXECUTE = process.argv.includes('--execute');

if (!UNIPROT_ID) {
  console.error('❌ Usage: node db/deduplicate_single_protein.mjs <uniprot_id> [--execute]');
  console.error('   Example: node db/deduplicate_single_protein.mjs A0A2K3E7K0');
  process.exit(1);
}

async function deduplicateSingleProtein() {
  console.log('\n🔍 Single Protein Deduplication Tool');
  console.log('═'.repeat(70));
  console.log(`Target: ${UNIPROT_ID}`);

  if (EXECUTE) {
    console.log('⚠️  EXECUTE MODE: Duplicates WILL BE DELETED!\n');
  } else {
    console.log('🛡️  DRY-RUN MODE: No changes will be made\n');
  }

  try {
    // Step 1: Get protein info
    const proteinInfo = await sql`
      SELECT id, uniprot_id, gene_name, organism
      FROM proteins
      WHERE uniprot_id = ${UNIPROT_ID}
    `;

    if (proteinInfo.rows.length === 0) {
      console.error(`❌ Protein not found: ${UNIPROT_ID}`);
      process.exit(1);
    }

    const protein = proteinInfo.rows[0];
    const displayName = protein.gene_name || protein.uniprot_id;
    console.log(`Protein: ${displayName} (${protein.uniprot_id})`);
    console.log(`Organism: ${protein.organism}`);
    console.log(`Database ID: ${protein.id}\n`);

    // Step 2: Get all interactions for this bait
    const allInteractions = await sql`
      SELECT
        i.id,
        i.prey_protein_id,
        p.uniprot_id as prey_uniprot,
        p.gene_name as prey_gene,
        i.iptm,
        i.contacts_pae_lt_3,
        i.contacts_pae_lt_6,
        i.interface_plddt,
        i.confidence,
        i.source_path,
        i.ipsae,
        i.analysis_version
      FROM interactions i
      JOIN proteins p ON i.prey_protein_id = p.id
      WHERE i.bait_protein_id = ${protein.id}
      ORDER BY p.gene_name, p.uniprot_id, i.iptm DESC
    `;

    const total = allInteractions.rows.length;
    console.log(`Total interactions found: ${total}\n`);

    // Step 3: Find duplicates (same prey, same metrics)
    console.log('Analyzing for duplicates...\n');

    const groupedByPrey = new Map();

    for (const interaction of allInteractions.rows) {
      // Group by prey protein + core metrics (exclude ipLDDT - can have float precision differences)
      // Normalize NULL contacts to 0 for proper grouping
      const contacts = interaction.contacts_pae_lt_3 ?? 0;
      const key = `${interaction.prey_protein_id}|${interaction.iptm}|${contacts}`;

      if (!groupedByPrey.has(key)) {
        groupedByPrey.set(key, []);
      }
      groupedByPrey.get(key).push(interaction);
    }

    // Find groups with duplicates
    const duplicateGroups = [];
    for (const [key, interactions] of groupedByPrey.entries()) {
      if (interactions.length > 1) {
        duplicateGroups.push(interactions);
      }
    }

    if (duplicateGroups.length === 0) {
      console.log('✅ No duplicates found for this protein!\n');
      return;
    }

    console.log(`Found ${duplicateGroups.length} duplicate groups:\n`);

    const idsToDelete = [];
    let keepCount = 0;
    let deleteCount = 0;

    // Step 4: Show each duplicate group
    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      const prey = group[0];
      const preyDisplay = prey.prey_gene || prey.prey_uniprot;

      console.log(`[${i + 1}] ${displayName} → ${preyDisplay}`);
      console.log(`    iPTM: ${prey.iptm}, Contacts <3Å: ${prey.contacts_pae_lt_3}, ipLDDT: ${prey.interface_plddt}`);
      console.log(`    Confidence: ${prey.confidence}`);
      console.log(`    Found ${group.length} entries:\n`);

      // Sort: v4 first, then v3, then by ID descending
      const sorted = group.sort((a, b) => {
        const aIsV4 = a.source_path && a.source_path.includes('v4.json');
        const bIsV4 = b.source_path && b.source_path.includes('v4.json');
        if (aIsV4 && !bIsV4) return -1;
        if (!aIsV4 && bIsV4) return 1;
        return b.id - a.id;
      });

      // Keep the first (v4 if available, otherwise newest)
      const keep = sorted[0];
      const toDelete = sorted.slice(1);

      // Show what we'll keep
      const keepPath = keep.source_path ? keep.source_path.split('/').pop() : 'Unknown';
      const keepVersion = keepPath.includes('v4') ? 'v4' : (keepPath.includes('v3') ? 'v3' : 'other');
      const ipsaeInfo = keep.ipsae ? ` (ipSAE: ${keep.ipsae.toFixed(3)})` : '';

      console.log(`    ✅ KEEP: ID ${keep.id} - ${keepVersion}${ipsaeInfo}`);
      console.log(`         ${keepPath}`);

      // Show what we'll delete
      for (const del of toDelete) {
        const delPath = del.source_path ? del.source_path.split('/').pop() : 'Unknown';
        const delVersion = delPath.includes('v4') ? 'v4' : (delPath.includes('v3') ? 'v3' : 'other');
        console.log(`    ❌ DELETE: ID ${del.id} - ${delVersion}`);
        console.log(`           ${delPath}`);
        idsToDelete.push(del.id);
      }

      console.log('');
      keepCount++;
      deleteCount += toDelete.length;
    }

    // Step 5: Summary
    console.log('═'.repeat(70));
    console.log('SUMMARY:');
    console.log(`  Total interactions for ${displayName}: ${total}`);
    console.log(`  Unique interactions: ${total - deleteCount}`);
    console.log(`  Duplicate groups: ${duplicateGroups.length}`);
    console.log(`  Entries to keep: ${keepCount} (prefer v4 > v3 > newest)`);
    console.log(`  Entries to delete: ${deleteCount}`);
    console.log('');

    if (idsToDelete.length === 0) {
      console.log('✅ Nothing to delete!\n');
      return;
    }

    // Step 6: Execute deletion
    if (EXECUTE) {
      console.log('Deleting duplicates...\n');

      const result = await sql`
        DELETE FROM interactions
        WHERE id = ANY(${idsToDelete})
      `;

      console.log(`✅ Deleted ${result.rowCount} duplicate entries\n`);

      // Verify
      const finalCount = await sql`
        SELECT COUNT(*) as count
        FROM interactions
        WHERE bait_protein_id = ${protein.id}
      `;

      console.log(`Final interaction count: ${finalCount.rows[0].count}`);
      console.log(`Expected: ${total - deleteCount}`);

      if (parseInt(finalCount.rows[0].count) === total - deleteCount) {
        console.log('✅ Verification passed!\n');
      } else {
        console.log('⚠️  Count mismatch - please investigate!\n');
      }

    } else {
      console.log('🛡️  DRY-RUN MODE: No changes were made');
      console.log('    Add --execute flag to perform the deletion:\n');
      console.log(`    node db/deduplicate_single_protein.mjs ${UNIPROT_ID} --execute\n`);
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

deduplicateSingleProtein()
  .then(() => {
    console.log('✅ Done!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

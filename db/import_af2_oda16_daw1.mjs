#!/usr/bin/env node
import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '..', 'af2_oda16_daw1_data.json');

async function getOrCreateProtein(uniprotId, geneName = null) {
  // Check if protein exists
  const existing = await sql`
    SELECT id FROM proteins WHERE uniprot_id = ${uniprotId}
  `;

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new protein
  const result = await sql`
    INSERT INTO proteins (uniprot_id, gene_name, organism)
    VALUES (${uniprotId}, ${geneName}, 'Unknown')
    RETURNING id
  `;

  console.log(`  Created new protein: ${uniprotId}${geneName ? ` (${geneName})` : ''}`);
  return result.rows[0].id;
}

async function importInteraction(baitId, preyId, iptmPtm, sourcePath) {
  // Check if interaction already exists
  const existing = await sql`
    SELECT id, iptm
    FROM interactions
    WHERE bait_protein_id = ${baitId}
      AND prey_protein_id = ${preyId}
      AND alphafold_version = 'AF2'
  `;

  if (existing.rows.length > 0) {
    // Update existing
    await sql`
      UPDATE interactions
      SET iptm = ${iptmPtm},
          contacts_pae_lt_3 = NULL,
          contacts_pae_lt_6 = NULL,
          interface_plddt = NULL,
          confidence = NULL,
          source_path = ${sourcePath}
      WHERE id = ${existing.rows[0].id}
    `;
    return 'UPDATED';
  }

  // Insert new interaction
  await sql`
    INSERT INTO interactions (
      bait_protein_id,
      prey_protein_id,
      iptm,
      contacts_pae_lt_3,
      contacts_pae_lt_6,
      interface_plddt,
      confidence,
      alphafold_version,
      source_path
    )
    VALUES (
      ${baitId},
      ${preyId},
      ${iptmPtm},
      NULL,
      NULL,
      NULL,
      NULL,
      'AF2',
      ${sourcePath}
    )
  `;
  return 'NEW';
}

async function main() {
  console.log('📥 Importing AF2 ODA16/DAW1 interaction data...\n');

  // Read data file
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  let totalNew = 0;
  let totalUpdated = 0;

  for (const bait of data.baits) {
    console.log(`\n🔬 Processing bait: ${bait.gene_name} (${bait.uniprot_id}) - ${bait.screen_type} screen`);
    console.log(`   ${bait.interactions.length} interactions to import`);

    // Get or create bait protein
    const baitId = await getOrCreateProtein(bait.uniprot_id, bait.gene_name);

    // Process each interaction
    for (const interaction of bait.interactions) {
      const preyId = await getOrCreateProtein(interaction.prey_id);

      const status = await importInteraction(
        baitId,
        preyId,
        interaction.iptm_ptm,
        DATA_FILE
      );

      if (status === 'NEW') {
        totalNew++;
      } else {
        totalUpdated++;
      }

      const statusIcon = status === 'NEW' ? '✅' : '🔄';
      console.log(`  ${statusIcon} ${bait.gene_name} ↔ ${interaction.prey_id}: iPTM+pTM=${interaction.iptm_ptm} [${status}]`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Import complete!');
  console.log(`   New interactions: ${totalNew}`);
  console.log(`   Updated interactions: ${totalUpdated}`);
  console.log(`   Total: ${totalNew + totalUpdated}`);
  console.log('='.repeat(60));

  console.log('\n📋 Next steps:');
  console.log('1. Assign organisms: node db/incremental_organism_lookup.mjs');
  console.log('2. Fetch gene names: node db/fetch_aliases.mjs');
  console.log('3. Update gene names: node -e "const { sql } = require(\'@vercel/postgres\'); (async () => { const result = await sql`UPDATE proteins p SET gene_name = pa.alias_name FROM protein_aliases pa WHERE p.id = pa.protein_id AND pa.alias_type = \'gene_name\' AND p.gene_name IS NULL`; console.log(`Updated ${result.rowCount} proteins`); })();"');
  console.log('4. ChlamyFP lookup: node db/chlamyfp_gene_lookup.mjs');
  console.log('5. Verify: node db/check_db.mjs');
}

main().catch(console.error);

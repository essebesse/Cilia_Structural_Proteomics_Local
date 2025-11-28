import { sql } from '@vercel/postgres';
import fs from 'fs';

async function main() {
  console.log('\n='.repeat(80));
  console.log('ADDING MS VALIDATION DATA TO DATABASE');
  console.log('='.repeat(80));

  const validationData = {
    validated: true,
    method: 'PD_MS',
    source: 'Tina/Carsten',
    date: '2025-10-30',
    notes: 'IFT-A complex validation - skeletal ciliopathy project'
  };

  console.log('\nValidation metadata:');
  console.log(JSON.stringify(validationData, null, 2));

  // Read MS data
  const ms_data = JSON.parse(fs.readFileSync('/tmp/ms_data.json', 'utf8'));

  const baits = [
    { name: 'IFT121', uniprot: 'Q9P2L0', ms_file: 'IFT121' },
    { name: 'IFT122', uniprot: 'Q9HBG6', ms_file: 'IFT122' },
    { name: 'IFT43', uniprot: 'Q96FT9', ms_file: 'IFT43' }
  ];

  let totalUpdated = 0;

  for (const bait of baits) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing ${bait.name} (${bait.uniprot})`);
    console.log('='.repeat(80));

    // Get MS hits for this bait
    const ms_uniprots = new Set(ms_data[bait.ms_file].unique_uniprots);
    console.log(`MS hits: ${ms_uniprots.size} proteins`);

    // Get AF3 predictions for this bait
    const af3_result = await sql`
      SELECT
        i.id,
        p2.uniprot_id,
        p2.gene_name,
        i.iptm,
        i.contacts_pae_lt_3
      FROM interactions i
      JOIN proteins p1 ON i.bait_protein_id = p1.id
      JOIN proteins p2 ON i.prey_protein_id = p2.id
      WHERE p1.uniprot_id = ${bait.uniprot}
      AND i.alphafold_version = 'AF3'
    `;

    console.log(`AF3 predictions: ${af3_result.rowCount} interactions`);

    // Find overlaps and update
    let baitUpdated = 0;
    for (const row of af3_result.rows) {
      if (ms_uniprots.has(row.uniprot_id)) {
        await sql`
          UPDATE interactions
          SET experimental_validation = ${JSON.stringify(validationData)}::jsonb
          WHERE id = ${row.id}
        `;
        console.log(`  ✓ Validated: ${row.uniprot_id.padEnd(12)} ${(row.gene_name || 'N/A').padEnd(15)} iPTM: ${row.iptm.toFixed(2)}, Contacts: ${row.contacts_pae_lt_3}`);
        baitUpdated++;
        totalUpdated++;
      }
    }

    console.log(`\n→ Updated ${baitUpdated} interactions for ${bait.name}`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✓ TOTAL: Updated ${totalUpdated} interactions with MS validation`);
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

#!/usr/bin/env node
import { db } from '@vercel/postgres';
import { readFileSync } from 'fs';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

async function backfillStructuralMetrics() {
  const client = await db.connect();

  try {
    console.log('🔄 Backfilling structural metrics for CCDC92 and CCDC198...\n');

    const jsonFiles = [
      '/emcc/au14762/AF/Lotte_Pedersen/Q53HC0_CCDC92/AF3/AF3_PD_analysis_v3.json',
      '/emcc/au14762/AF/Lotte_Pedersen/Q9NVL8_CCDC198/AF3/AF3_PD_analysis_v3.json'
    ];

    let totalUpdated = 0;

    for (const jsonFile of jsonFiles) {
      console.log(`📁 Processing: ${jsonFile.split('/').pop()}`);
      const data = JSON.parse(readFileSync(jsonFile, 'utf8'));
      const predictions = data.high_confidence_predictions || [];

      for (const pred of predictions) {
        const directory = pred.directory || pred.directory_name;
        const parts = directory.toLowerCase().split('_and_');
        if (parts.length !== 2) continue;

        const baitId = parts[0].toUpperCase();
        const preyId = parts[1].toUpperCase();

        const contactsPaeLt3 = pred.contacts_pae3 || null;
        const contactsPaeLt6 = pred.contacts_pae6 || null;
        const interfacePlddt = pred.mean_interface_plddt || null;

        const result = await client.query(`
          UPDATE interactions i
          SET
            contacts_pae_lt_3 = $1,
            contacts_pae_lt_6 = $2,
            interface_plddt = $3
          FROM proteins bait, proteins prey
          WHERE i.bait_protein_id = bait.id
          AND i.prey_protein_id = prey.id
          AND bait.uniprot_id = $4
          AND prey.uniprot_id = $5
          AND i.source_path = $6
        `, [contactsPaeLt3, contactsPaeLt6, interfacePlddt, baitId, preyId, jsonFile]);

        if (result.rowCount > 0) {
          totalUpdated++;
        }
      }
    }

    console.log(`\n✅ Updated ${totalUpdated} interactions with structural metrics`);

    // Verify a sample
    const sample = await client.query(`
      SELECT i.contacts_pae_lt_3, i.contacts_pae_lt_6, i.interface_plddt,
             bait.uniprot_id as bait, prey.uniprot_id as prey
      FROM interactions i
      JOIN proteins bait ON i.bait_protein_id = bait.id
      JOIN proteins prey ON i.prey_protein_id = prey.id
      WHERE bait.uniprot_id = 'Q53HC0'
      AND i.contacts_pae_lt_3 IS NOT NULL
      LIMIT 1
    `);

    if (sample.rows.length > 0) {
      console.log('\n📊 Sample verification:');
      console.log(`  ${sample.rows[0].bait} → ${sample.rows[0].prey}`);
      console.log(`  iPAE <3Å: ${sample.rows[0].contacts_pae_lt_3}`);
      console.log(`  iPAE <6Å: ${sample.rows[0].contacts_pae_lt_6}`);
      console.log(`  ipLDDT: ${sample.rows[0].interface_plddt}`);
    }

  } finally {
    await client.release();
  }
}

backfillStructuralMetrics().catch(console.error);

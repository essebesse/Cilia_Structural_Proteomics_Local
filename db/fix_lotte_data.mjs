#!/usr/bin/env node

/**
 * Fix script to update Lotte's AF3 data with correct confidence and PAE/pLDDT values
 */

import { db } from '@vercel/postgres';
import fs from 'fs';

const POSTGRES_URL = process.env.POSTGRES_URL;
const LOTTE_AF3_PATH = '/emcc/au14762/AF/Lotte_Pedersen/O15182_CENT3/AF3/AF3_PD_analysis_v3.json';

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL environment variable is required');
  process.exit(1);
}

const CONFIDENCE_MAPPING = {
  'Very High Confidence': 'Very High Confidence',
  'Worth Investigating': 'Worth Investigating',
  'Low iPTM - Proceed with Caution': 'Low iPTM - Proceed with Caution',
  'Very Low': 'Very Low',
  'Low': 'Low',
  'Medium': 'Medium',
  'High': 'High'
};

async function parseProteinName(directoryName) {
  const parts = directoryName.toLowerCase().split('_and_');
  if (parts.length === 2) {
    return {
      protein1: parts[0].toUpperCase(),
      protein2: parts[1].toUpperCase()
    };
  }
  return null;
}

async function fixLotteData() {
  const client = await db.connect();

  try {
    console.log('🔧 Fixing Lotte AF3 data with correct confidence and PAE/pLDDT values...');

    // Read the JSON data
    const jsonData = JSON.parse(fs.readFileSync(LOTTE_AF3_PATH, 'utf8'));
    const predictions = jsonData.high_confidence_predictions || [];

    console.log(`🔄 Processing ${predictions.length} predictions for data fix...`);

    let updated = 0;
    let notFound = 0;

    for (const pred of predictions) {
      try {
        // Parse directory name to get proteins
        const proteins = await parseProteinName(pred.directory_name);
        if (!proteins) {
          console.log(`   ⚠️  Could not parse: ${pred.directory_name}`);
          continue;
        }

        // Find the interaction in database
        const interaction = await client.query(`
          SELECT i.id
          FROM interactions i
          JOIN proteins bait ON i.bait_protein_id = bait.id
          JOIN proteins prey ON i.prey_protein_id = prey.id
          WHERE bait.uniprot_id = $1 AND prey.uniprot_id = $2
            AND i.source_path LIKE '%${pred.directory_name}%'
        `, [proteins.protein1, proteins.protein2]);

        if (interaction.rows.length === 0) {
          notFound++;
          continue;
        }

        const interactionId = interaction.rows[0].id;

        // Extract the correct values from JSON
        const confidence = CONFIDENCE_MAPPING[pred.confidence_class] || pred.confidence_class;
        const contactsPae3 = pred.contacts_pae3 || 0;
        const contactsPae6 = pred.contacts_pae6 || 0;
        const interfacePlddt = pred.mean_interface_plddt || null;

        // Update the interaction with correct values
        await client.query(`
          UPDATE interactions
          SET confidence = $1::confidence_level,
              contacts_pae_lt_3 = $2,
              contacts_pae_lt_6 = $3,
              interface_plddt = $4
          WHERE id = $5
        `, [confidence, contactsPae3, contactsPae6, interfacePlddt, interactionId]);

        updated++;

        if (updated % 10 === 0) {
          console.log(`   ✅ Updated ${updated} interactions...`);
        }

      } catch (error) {
        console.error(`   ❌ Error updating ${pred.directory_name}:`, error.message);
      }
    }

    // Show updated statistics
    const exampleUpdated = await client.query(`
      SELECT
        bait.uniprot_id as bait_uniprot,
        prey.uniprot_id as prey_uniprot,
        i.iptm, i.confidence, i.contacts_pae_lt_3, i.contacts_pae_lt_6, i.interface_plddt
      FROM interactions i
      JOIN proteins bait ON i.bait_protein_id = bait.id
      JOIN proteins prey ON i.prey_protein_id = prey.id
      WHERE i.source_path LIKE '%Lotte_Pedersen%'
        AND i.confidence IS NOT NULL
      ORDER BY i.iptm DESC
      LIMIT 5
    `);

    console.log('\n✅ Fix completed!');
    console.log(`   Updated: ${updated} interactions`);
    console.log(`   Not found: ${notFound}`);

    console.log('\n🔍 Example updated interactions:');
    for (const ex of exampleUpdated.rows) {
      console.log(`   ${ex.bait_uniprot} ↔ ${ex.prey_uniprot}`);
      console.log(`     iPTM: ${ex.iptm}, Confidence: ${ex.confidence}`);
      console.log(`     PAE <3Å: ${ex.contacts_pae_lt_3}, PAE <6Å: ${ex.contacts_pae_lt_6}`);
      console.log(`     Interface pLDDT: ${ex.interface_plddt?.toFixed(1) || 'N/A'}`);
      console.log('');
    }

  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

fixLotteData()
  .then(() => {
    console.log('🎉 Lotte data fix completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fix failed:', error);
    process.exit(1);
  });
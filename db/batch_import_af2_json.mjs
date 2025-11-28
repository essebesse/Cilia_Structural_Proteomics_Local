#!/usr/bin/env node
/**
 * Batch AF2 JSON Importer
 * Efficiently imports multiple AF2 JSON files from different run directories
 * Adapted from import_af3_json.mjs for AF2 format
 */

import { db } from '@vercel/postgres';
import { readFileSync } from 'fs';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

// List of directories with their JSON files
const RUN_DIRECTORIES = [
  { name: 'CrODA16', path: '/emcc/au14762/elo_lab/AlphaPulldown/CrODA16/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'HsODA16', path: '/emcc/au14762/elo_lab/AlphaPulldown/HsODA16/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'CrIFT56', path: '/emcc/au14762/elo_lab/AlphaPulldown/CrIFT56/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'CrARMC2_long', path: '/emcc/au14762/elo_lab/AlphaPulldown/CrARMC2_long/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'HsArl13B', path: '/emcc/au14762/elo_lab/AlphaPulldown/HsArl13B/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'HsTULP3', path: '/emcc/au14762/elo_lab/AlphaPulldown/HsTULP3/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'HsRRP7A', path: '/emcc/au14762/elo_lab/AlphaPulldown/HsRRP7A/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'HsLRRC45', path: '/emcc/au14762/elo_lab/AlphaPulldown/HsLRRC45/pulldown/high_confidence_af2_predictions_v2.json' },
  { name: 'BBS5', path: '/emcc/au14762/elo_lab/AlphaPulldown/BBS5/pulldown/high_confidence_af2_predictions_v2.json' }
];

// Map AF2 confidence levels to database ENUM
function mapAF2Confidence(confidenceClass) {
  // AF2 JSON uses: "High", "Medium"
  // Database uses: "High", "Medium", etc.
  if (confidenceClass === 'High') return 'High';
  if (confidenceClass === 'Medium') return 'Medium';
  if (confidenceClass === 'Low') return 'Low';
  return 'Medium'; // Default fallback
}

async function importAllRuns() {
  const client = await db.connect();

  try {
    console.log('🧬 BATCH AF2 JSON IMPORT');
    console.log('='.repeat(60));
    console.log(`📂 Processing ${RUN_DIRECTORIES.length} run directories\n`);

    let totalImported = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const run of RUN_DIRECTORIES) {
      console.log(`\n📁 Processing: ${run.name}`);
      console.log(`   Path: ${run.path}`);

      try {
        // Read JSON file
        const jsonData = JSON.parse(readFileSync(run.path, 'utf8'));
        const predictions = jsonData.high_confidence_predictions || [];

        console.log(`   Found ${predictions.length} predictions`);

        // Filter to Medium+ confidence (skip Low and Very Low)
        const actionablePredictions = predictions.filter(p =>
          p.confidence_class === 'High' || p.confidence_class === 'Medium'
        );

        console.log(`   Importing ${actionablePredictions.length} Medium+ confidence interactions`);

        let imported = 0;
        let skipped = 0;
        let failed = 0;

        for (const prediction of actionablePredictions) {
          try {
            const directory = prediction.directory || prediction.directory_name;
            const iptm = prediction.iptm_ptm || prediction.iptm;

            // Extract protein IDs from directory name (e.g., "Q3Y8L7_and_Cre05.g241637.t1.1")
            const parts = directory.split('_and_');
            if (parts.length !== 2) {
              console.warn(`   ⚠️  Skipping invalid format: ${directory}`);
              skipped++;
              continue;
            }

            // Add AF2_ prefix to match existing naming convention
            const baitId = 'AF2_' + parts[0];
            const preyId = 'AF2_' + parts[1];

            const confidence = mapAF2Confidence(prediction.confidence_class);

            // Insert proteins (with CONFLICT handling)
            await client.query(`
              INSERT INTO proteins (uniprot_id, organism, organism_code)
              VALUES ($1, 'Unknown'::organism_type, NULL)
              ON CONFLICT (uniprot_id) DO NOTHING
            `, [baitId]);

            await client.query(`
              INSERT INTO proteins (uniprot_id, organism, organism_code)
              VALUES ($1, 'Unknown'::organism_type, NULL)
              ON CONFLICT (uniprot_id) DO NOTHING
            `, [preyId]);

            // Insert interaction
            const insertResult = await client.query(`
              INSERT INTO interactions (
                bait_protein_id, prey_protein_id, iptm,
                contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt,
                confidence, source_path, alphafold_version
              )
              SELECT
                (SELECT id FROM proteins WHERE uniprot_id = $1),
                (SELECT id FROM proteins WHERE uniprot_id = $2),
                $3, $4, $5, $6, $7::confidence_level, $8, 'AF2'
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [
              baitId,
              preyId,
              iptm,
              prediction.contacts_pae3 || 0,
              prediction.contacts_pae5 || 0,
              prediction.interface_plddt || null,
              confidence,
              run.path
            ]);

            if (insertResult.rowCount > 0) {
              imported++;
            } else {
              skipped++;
            }

          } catch (err) {
            console.error(`   ❌ Error processing ${prediction.directory}: ${err.message}`);
            failed++;
          }
        }

        console.log(`   ✅ ${run.name}: ${imported} imported, ${skipped} skipped, ${failed} failed`);
        totalImported += imported;
        totalSkipped += skipped;
        totalFailed += failed;

      } catch (err) {
        console.error(`   ❌ Error reading ${run.name}: ${err.message}`);
        totalFailed++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 BATCH IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Total imported: ${totalImported}`);
    console.log(`⏭️  Total skipped: ${totalSkipped}`);
    console.log(`❌ Total failed: ${totalFailed}`);
    console.log('\n🎉 Batch import complete!');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the import
importAllRuns()
  .then(() => {
    console.log('\n✅ Import completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Import failed:', err);
    process.exit(1);
  });

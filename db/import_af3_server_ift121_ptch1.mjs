#!/usr/bin/env node
import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

/**
 * Import AF3 Server predictions for HsIFT121 with Patched1
 *
 * This script imports two predictions:
 * 1. IFT121 - Patched1 (full-length)
 * 2. IFT121 - Patched1_C (C-terminal truncation)
 *
 * Data extracted from multi_model_analysis.json files
 */

const PREDICTIONS = [
  {
    bait: 'Q9P2L0',  // HsIFT121
    prey: 'Q13635',  // PTCH1 (Human Patched1)
    variant: null,   // Full-length
    iptm: 0.468,     // From multi_model_analysis_report.txt
    ipsae: 0.279,    // Mean ipSAE from report
    ptm: 0.484,
    contacts_pae_lt_3: 30,  // Total consensus interface residues (17 Chain A + 13 Chain B)
    contacts_pae_lt_6: null,
    interface_plddt: null,  // Not available in AF3 Server output
    ipsae_pae_cutoff: 10,   // ipSAE uses PAE cutoff of 10Å
    source_path: '/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q9P2L0_IFT121/AF3_Server/fold_hsift121_ptc1_seed4',
    note: 'AF3 Server prediction, 5 models averaged, ipSAE=0.279 below standard 0.3 cutoff but included per user request'
  },
  {
    bait: 'Q9P2L0',  // HsIFT121
    prey: 'Q13635',  // PTCH1
    variant: 'PTCH1_Cterm',  // C-terminal construct
    iptm: 0.452,     // From multi_model_analysis_report.txt
    ipsae: 0.334,    // Mean ipSAE from report
    ptm: 0.580,
    contacts_pae_lt_3: 53,  // Total consensus interface residues (35 Chain A + 18 Chain B)
    contacts_pae_lt_6: null,
    interface_plddt: null,  // Not available in AF3 Server output
    ipsae_pae_cutoff: 10,   // ipSAE uses PAE cutoff of 10Å
    source_path: '/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q9P2L0_IFT121/AF3_Server/fold_hsift121_ptch1_c',
    note: 'AF3 Server prediction with C-terminal PTCH1 construct, 5 models averaged, better interface than full-length'
  }
];

/**
 * Calculate confidence level using interface quality-centric scheme
 * Same logic as import_af3_json.mjs
 */
function calculateConfidence(iptm, contacts, iplddt) {
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

/**
 * Map ipSAE score to confidence level (for v4/ipSAE-based analysis)
 */
function calculateIpsaeConfidence(ipsae) {
  const ipsaeVal = parseFloat(ipsae) || 0;

  if (ipsaeVal > 0.7) return 'High';
  if (ipsaeVal >= 0.5) return 'Medium';
  if (ipsaeVal >= 0.3) return 'Low';
  return 'Very Low';
}

async function importAF3ServerPredictions() {
  const client = await db.connect();

  try {
    console.log('🧬 Importing AF3 Server predictions for HsIFT121 with Patched1\n');

    let imported = 0;
    let updated = 0;
    let failed = 0;

    for (const pred of PREDICTIONS) {
      try {
        const variantLabel = pred.variant ? ` (${pred.variant})` : '';
        console.log(`\n📊 Processing: ${pred.bait} ↔ ${pred.prey}${variantLabel}`);
        console.log(`   iPTM: ${pred.iptm}, ipSAE: ${pred.ipsae}, contacts: ${pred.contacts_pae_lt_3}`);

        // Calculate confidence levels
        const confidence = calculateConfidence(pred.iptm, pred.contacts_pae_lt_3, pred.interface_plddt);
        const ipsaeConfidence = calculateIpsaeConfidence(pred.ipsae);

        console.log(`   Confidence: ${confidence} (iPTM-based), ${ipsaeConfidence} (ipSAE-based)`);

        // Insert proteins (bait and prey)
        await client.query(`
          INSERT INTO proteins (uniprot_id, organism, organism_code)
          VALUES ($1, 'Unknown'::organism_type, NULL)
          ON CONFLICT (uniprot_id) DO NOTHING
        `, [pred.bait]);

        await client.query(`
          INSERT INTO proteins (uniprot_id, organism, organism_code)
          VALUES ($1, 'Unknown'::organism_type, NULL)
          ON CONFLICT (uniprot_id) DO NOTHING
        `, [pred.prey]);

        // Get protein IDs
        const baitResult = await client.query('SELECT id FROM proteins WHERE uniprot_id = $1', [pred.bait]);
        const preyResult = await client.query('SELECT id FROM proteins WHERE uniprot_id = $1', [pred.prey]);

        if (baitResult.rows.length === 0 || preyResult.rows.length === 0) {
          console.error(`   ❌ Could not find protein IDs for ${pred.bait}/${pred.prey}`);
          failed++;
          continue;
        }

        const baitProteinId = baitResult.rows[0].id;
        const preyProteinId = preyResult.rows[0].id;

        // Check if interaction already exists
        const existingCheck = await client.query(`
          SELECT id FROM interactions
          WHERE bait_protein_id = $1
            AND prey_protein_id = $2
            AND iptm = $3
        `, [baitProteinId, preyProteinId, pred.iptm]);

        if (existingCheck.rows.length > 0) {
          // Update existing interaction
          await client.query(`
            UPDATE interactions SET
              confidence = $1::confidence_level,
              source_path = $2,
              contacts_pae_lt_3 = $3,
              contacts_pae_lt_6 = $4,
              interface_plddt = $5,
              ipsae = $6,
              ipsae_confidence = $7::ipsae_confidence_level,
              ipsae_pae_cutoff = $8,
              analysis_version = 'v4'
            WHERE id = $9
          `, [
            confidence,
            pred.source_path,
            pred.contacts_pae_lt_3,
            pred.contacts_pae_lt_6,
            pred.interface_plddt,
            pred.ipsae,
            ipsaeConfidence,
            pred.ipsae_pae_cutoff,
            existingCheck.rows[0].id
          ]);
          console.log(`   🔄 UPDATED existing interaction`);
          updated++;
        } else {
          // Insert new interaction
          await client.query(`
            INSERT INTO interactions (
              bait_protein_id, prey_protein_id, iptm, confidence,
              alphafold_version, source_path,
              contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt,
              ipsae, ipsae_confidence, ipsae_pae_cutoff, analysis_version
            )
            VALUES ($1, $2, $3, $4::confidence_level, 'AF3', $5, $6, $7, $8, $9, $10::ipsae_confidence_level, $11, 'v4')
          `, [
            baitProteinId,
            preyProteinId,
            pred.iptm,
            confidence,
            pred.source_path,
            pred.contacts_pae_lt_3,
            pred.contacts_pae_lt_6,
            pred.interface_plddt,
            pred.ipsae,
            ipsaeConfidence,
            pred.ipsae_pae_cutoff
          ]);
          console.log(`   ✅ NEW interaction imported`);
          imported++;
        }

      } catch (error) {
        console.error(`   ❌ Error processing prediction:`, error.message);
        failed++;
      }
    }

    console.log(`\n📈 Import Summary:`);
    console.log(`   ✅ ${imported} new interactions`);
    console.log(`   🔄 ${updated} interactions updated`);
    console.log(`   ❌ ${failed} failed`);

    // Show database stats for IFT121
    const stats = await client.query(`
      SELECT COUNT(*) as total
      FROM interactions i
      JOIN proteins p ON i.bait_protein_id = p.id
      WHERE p.uniprot_id = 'Q9P2L0'
    `);

    console.log(`\n🗄️  Total IFT121 (Q9P2L0) interactions in database: ${stats.rows[0].total}`);

  } finally {
    await client.release();
  }
}

importAF3ServerPredictions()
  .then(() => console.log('\n✅ AF3 Server import completed'))
  .catch(err => console.error('\n❌ Import failed:', err));

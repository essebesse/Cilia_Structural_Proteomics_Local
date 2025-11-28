#!/usr/bin/env node
import { sql } from '@vercel/postgres';
import { readFileSync } from 'fs';

const jsonPath = '/emcc/au14762/elo_lab/AlphaPulldown/CrODA16/pulldown/high_confidence_af2_predictions_v2.json';

async function main() {
  const jsonData = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const predictions = jsonData.high_confidence_predictions || [];

  console.log(`Importing ${predictions.length} AF2 predictions for ODA16...`);

  let imported = 0, skipped = 0;

  for (const p of predictions) {
    const parts = p.directory.split('_and_');
    if (parts.length !== 2) continue;

    const baitId = parts[0].toUpperCase();
    const preyId = 'AF2_' + parts[1];
    const iptm = p.iptm_ptm;

    // Insert proteins
    await sql`INSERT INTO proteins (uniprot_id, organism, organism_code) VALUES (${baitId}, 'Unknown', NULL) ON CONFLICT (uniprot_id) DO NOTHING`;
    await sql`INSERT INTO proteins (uniprot_id, organism, organism_code) VALUES (${preyId}, 'Unknown', NULL) ON CONFLICT (uniprot_id) DO NOTHING`;

    // Get IDs
    const bait = await sql`SELECT id FROM proteins WHERE uniprot_id = ${baitId}`;
    const prey = await sql`SELECT id FROM proteins WHERE uniprot_id = ${preyId}`;

    if (bait.rows.length === 0 || prey.rows.length === 0) continue;

    // Check existing
    const existing = await sql`
      SELECT id FROM interactions
      WHERE bait_protein_id = ${bait.rows[0].id} AND prey_protein_id = ${prey.rows[0].id}
    `;

    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    // Insert
    await sql`
      INSERT INTO interactions (bait_protein_id, prey_protein_id, iptm, alphafold_version, source_path, confidence)
      VALUES (${bait.rows[0].id}, ${prey.rows[0].id}, ${iptm}, 'AF2', ${jsonPath}, NULL)
    `;
    imported++;
    console.log(`✅ ${baitId} ↔ ${preyId} (iPTM: ${iptm.toFixed(3)})`);
  }

  console.log(`\n📈 Imported: ${imported}, Skipped (existing): ${skipped}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

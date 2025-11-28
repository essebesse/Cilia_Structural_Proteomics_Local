#!/usr/bin/env node
/**
 * Compare AF2 vs AF3 predictions for ODA16 (Q3Y8L7)
 * Also compares iPTM vs ipSAE ranking within AF3
 *
 * Positive controls (biochemically confirmed):
 * - ODA16 ↔ Arl3
 * - ODA16 ↔ IDA3
 * - ODA16 ↔ IFT46
 * - ODA16 ↔ ODA8
 */

import { sql } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

// Known positive controls - gene names to look for
const POSITIVE_CONTROLS = ['ARL3', 'IDA3', 'IFT46', 'ODA8'];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AF2 vs AF3 Comparison for ODA16 (Q3Y8L7)');
  console.log('  With iPTM vs ipSAE ranking analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get all ODA16 interactions
  const result = await sql`
    SELECT
      i.id,
      i.alphafold_version,
      i.iptm,
      i.ipsae,
      i.confidence,
      i.ipsae_confidence,
      i.contacts_pae_lt_3,
      i.interface_plddt,
      pr.uniprot_id as prey_uniprot,
      pr.gene_name as prey_gene
    FROM interactions i
    JOIN proteins b ON i.bait_protein_id = b.id
    JOIN proteins pr ON i.prey_protein_id = pr.id
    WHERE b.uniprot_id = 'Q3Y8L7'
    ORDER BY i.alphafold_version DESC, i.iptm DESC
  `;

  const interactions = result.rows;

  // Separate AF2 and AF3
  const af2 = interactions.filter(i => i.alphafold_version === 'AF2');
  const af3 = interactions.filter(i => i.alphafold_version === 'AF3');
  const af3WithIpsae = af3.filter(i => i.ipsae !== null);

  console.log('📊 Dataset Overview');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  AF2 interactions: ${af2.length}`);
  console.log(`  AF3 interactions: ${af3.length}`);
  console.log(`  AF3 with ipSAE:   ${af3WithIpsae.length}`);
  console.log('');

  // Find positive controls in each dataset
  console.log('🎯 Positive Control Detection');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('Biochemically confirmed interactions: ODA16 ↔ Arl3, IDA3, IFT46, ODA8\n');

  const controlResults = [];

  for (const control of POSITIVE_CONTROLS) {
    const af2Hit = af2.find(i =>
      i.prey_gene?.toUpperCase().includes(control) ||
      i.prey_uniprot?.toUpperCase().includes(control)
    );
    const af3Hit = af3.find(i =>
      i.prey_gene?.toUpperCase().includes(control) ||
      i.prey_uniprot?.toUpperCase().includes(control)
    );

    const af2Rank = af2Hit ? af2.indexOf(af2Hit) + 1 : null;
    const af3RankIptm = af3Hit ? af3.indexOf(af3Hit) + 1 : null;

    // Rank by ipSAE
    let af3RankIpsae = null;
    if (af3Hit && af3Hit.ipsae !== null) {
      const sortedByIpsae = [...af3WithIpsae].sort((a, b) => b.ipsae - a.ipsae);
      af3RankIpsae = sortedByIpsae.findIndex(i => i.id === af3Hit.id) + 1;
    }

    controlResults.push({
      control,
      af2Hit,
      af3Hit,
      af2Rank,
      af3RankIptm,
      af3RankIpsae
    });

    const af2Status = af2Hit
      ? `✅ Rank ${af2Rank}/${af2.length} (iPTM: ${af2Hit.iptm}, ${af2Hit.confidence || 'N/A'})`
      : '❌ Not detected';

    let af3Status = af3Hit
      ? `✅ iPTM rank ${af3RankIptm}/${af3.length} (iPTM: ${af3Hit.iptm}, ${af3Hit.confidence})`
      : '❌ Not detected';

    if (af3Hit && af3Hit.ipsae !== null) {
      af3Status += `\n                    ipSAE rank ${af3RankIpsae}/${af3WithIpsae.length} (ipSAE: ${af3Hit.ipsae.toFixed(3)}, ${af3Hit.ipsae_confidence})`;
    }

    console.log(`  ${control}:`);
    console.log(`    AF2: ${af2Status}`);
    console.log(`    AF3: ${af3Status}`);
    console.log('');
  }

  // Summary statistics
  console.log('📈 Summary Statistics');
  console.log('───────────────────────────────────────────────────────────────');

  const af2Detected = controlResults.filter(r => r.af2Hit).length;
  const af3Detected = controlResults.filter(r => r.af3Hit).length;

  console.log(`  Positive controls detected:`);
  console.log(`    AF2: ${af2Detected}/${POSITIVE_CONTROLS.length} (${(af2Detected/POSITIVE_CONTROLS.length*100).toFixed(0)}%)`);
  console.log(`    AF3: ${af3Detected}/${POSITIVE_CONTROLS.length} (${(af3Detected/POSITIVE_CONTROLS.length*100).toFixed(0)}%)`);
  console.log('');

  // Top hits comparison
  console.log('🏆 Top 10 Hits Comparison');
  console.log('───────────────────────────────────────────────────────────────');

  console.log('\n  AF2 Top 10 (by iPTM):');
  console.log('  Rank  Prey                          iPTM    Conf');
  console.log('  ────  ────────────────────────────  ──────  ────────');
  af2.slice(0, 10).forEach((hit, i) => {
    const name = hit.prey_gene || hit.prey_uniprot;
    const isControl = POSITIVE_CONTROLS.some(c => name?.toUpperCase().includes(c));
    const marker = isControl ? ' ⭐' : '';
    console.log(`  ${String(i+1).padStart(2)}    ${(name || 'Unknown').padEnd(26)}  ${hit.iptm.toFixed(2).padStart(6)}  ${(hit.confidence || 'N/A').padEnd(8)}${marker}`);
  });

  console.log('\n  AF3 Top 10 (by iPTM):');
  console.log('  Rank  Prey                          iPTM    Conf      ipSAE');
  console.log('  ────  ────────────────────────────  ──────  ────────  ──────');
  af3.slice(0, 10).forEach((hit, i) => {
    const name = hit.prey_gene || hit.prey_uniprot;
    const isControl = POSITIVE_CONTROLS.some(c => name?.toUpperCase().includes(c));
    const marker = isControl ? ' ⭐' : '';
    const ipsaeStr = hit.ipsae ? hit.ipsae.toFixed(3) : 'N/A';
    console.log(`  ${String(i+1).padStart(2)}    ${(name || 'Unknown').padEnd(26)}  ${hit.iptm.toFixed(2).padStart(6)}  ${(hit.confidence || 'N/A').padEnd(8)}  ${ipsaeStr.padStart(6)}${marker}`);
  });

  if (af3WithIpsae.length > 0) {
    const sortedByIpsae = [...af3WithIpsae].sort((a, b) => b.ipsae - a.ipsae);
    console.log('\n  AF3 Top 10 (by ipSAE):');
    console.log('  Rank  Prey                          ipSAE   Conf      iPTM');
    console.log('  ────  ────────────────────────────  ──────  ────────  ──────');
    sortedByIpsae.slice(0, 10).forEach((hit, i) => {
      const name = hit.prey_gene || hit.prey_uniprot;
      const isControl = POSITIVE_CONTROLS.some(c => name?.toUpperCase().includes(c));
      const marker = isControl ? ' ⭐' : '';
      console.log(`  ${String(i+1).padStart(2)}    ${(name || 'Unknown').padEnd(26)}  ${hit.ipsae.toFixed(3).padStart(6)}  ${(hit.ipsae_confidence || 'N/A').padEnd(8)}  ${hit.iptm.toFixed(2).padStart(6)}${marker}`);
    });
  }

  // Overlap analysis
  console.log('\n\n🔄 Overlap Analysis');
  console.log('───────────────────────────────────────────────────────────────');

  const af2Preys = new Set(af2.map(i => i.prey_uniprot));
  const af3Preys = new Set(af3.map(i => i.prey_uniprot));

  const overlap = [...af2Preys].filter(p => af3Preys.has(p));
  const af2Only = [...af2Preys].filter(p => !af3Preys.has(p));
  const af3Only = [...af3Preys].filter(p => !af2Preys.has(p));

  console.log(`  Shared between AF2 and AF3: ${overlap.length}`);
  console.log(`  AF2 only: ${af2Only.length}`);
  console.log(`  AF3 only: ${af3Only.length}`);
  console.log('');

  // iPTM vs ipSAE correlation for AF3
  if (af3WithIpsae.length >= 5) {
    console.log('\n📉 iPTM vs ipSAE Ranking Comparison (AF3)');
    console.log('───────────────────────────────────────────────────────────────');

    // Sort both ways
    const byIptm = [...af3WithIpsae].sort((a, b) => b.iptm - a.iptm);
    const byIpsae = [...af3WithIpsae].sort((a, b) => b.ipsae - a.ipsae);

    console.log('  Prey                          iPTM Rank  ipSAE Rank  Δ');
    console.log('  ────────────────────────────  ─────────  ──────────  ────');

    byIptm.forEach((hit) => {
      const iptmRank = byIptm.indexOf(hit) + 1;
      const ipsaeRank = byIpsae.findIndex(h => h.id === hit.id) + 1;
      const delta = iptmRank - ipsaeRank;
      const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
      const name = hit.prey_gene || hit.prey_uniprot;
      const isControl = POSITIVE_CONTROLS.some(c => name?.toUpperCase().includes(c));
      const marker = isControl ? ' ⭐' : '';
      console.log(`  ${(name || 'Unknown').padEnd(26)}  ${String(iptmRank).padStart(9)}  ${String(ipsaeRank).padStart(10)}  ${deltaStr.padStart(4)}${marker}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ⭐ = Biochemically confirmed positive control');
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

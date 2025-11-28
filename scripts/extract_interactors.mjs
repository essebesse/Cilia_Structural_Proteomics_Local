#!/usr/bin/env node
import { sql } from '@vercel/postgres';
import { writeFileSync } from 'fs';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error('❌ Usage: node extract_interactors.mjs <protein_name_or_id>');
  console.error('   Example: node extract_interactors.mjs RRP7A');
  console.error('   Example: node extract_interactors.mjs Q9Y3A4');
  process.exit(1);
}

console.log(`🔍 Extracting interactors for: ${target}\n`);

try {
  const result = await sql`
    SELECT
      CASE
        WHEN bait.gene_name = ${target} OR bait.uniprot_id = ${target}
        THEN prey.uniprot_id
        ELSE bait.uniprot_id
      END as uniprot_id,
      CASE
        WHEN bait.gene_name = ${target} OR bait.uniprot_id = ${target}
        THEN prey.gene_name
        ELSE bait.gene_name
      END as gene_name,
      CASE
        WHEN bait.gene_name = ${target} OR bait.uniprot_id = ${target}
        THEN prey.organism
        ELSE bait.organism
      END as organism,
      CASE
        WHEN bait.gene_name = ${target} OR bait.uniprot_id = ${target}
        THEN prey.organism_code
        ELSE bait.organism_code
      END as organism_code,
      i.iptm,
      i.confidence,
      i.contacts_pae_lt_3,
      i.contacts_pae_lt_6,
      i.interface_plddt,
      i.alphafold_version,
      i.source_path
    FROM interactions i
    JOIN proteins bait ON i.bait_protein_id = bait.id
    JOIN proteins prey ON i.prey_protein_id = prey.id
    WHERE bait.gene_name = ${target}
       OR prey.gene_name = ${target}
       OR bait.uniprot_id = ${target}
       OR prey.uniprot_id = ${target}
    ORDER BY
      CASE i.confidence
        WHEN 'High' THEN 1
        WHEN 'Medium' THEN 2
        WHEN 'Low' THEN 3
        ELSE 4
      END,
      i.iptm DESC,
      i.contacts_pae_lt_3 DESC
  `;

  if (result.rows.length === 0) {
    console.log('❌ No interactors found for', target);
    console.log('   Check that the protein exists in the database');
    process.exit(1);
  }

  console.log(`✅ Found ${result.rows.length} interactors\n`);

  // Summary by confidence
  const byConfidence = {
    High: result.rows.filter(r => r.confidence === 'High').length,
    Medium: result.rows.filter(r => r.confidence === 'Medium').length,
    Low: result.rows.filter(r => r.confidence === 'Low').length,
    AF2: result.rows.filter(r => r.confidence === null).length
  };

  console.log('📊 Confidence Distribution:');
  console.log(`   🟢 High:   ${byConfidence.High}`);
  console.log(`   🟠 Medium: ${byConfidence.Medium}`);
  console.log(`   🔴 Low:    ${byConfidence.Low}`);
  console.log(`   ⚪ AF2:    ${byConfidence.AF2}`);

  // Summary by organism
  const byOrganism = {};
  result.rows.forEach(r => {
    const org = r.organism || 'Unknown';
    byOrganism[org] = (byOrganism[org] || 0) + 1;
  });

  console.log('\n🧬 Organism Distribution:');
  Object.entries(byOrganism).forEach(([org, count]) => {
    console.log(`   ${org}: ${count}`);
  });

  // Show top 10 interactions
  console.log('\n🏆 Top 10 Interactions (by confidence + iPTM):');
  console.table(result.rows.slice(0, 10).map(r => ({
    Gene: r.gene_name || r.uniprot_id,
    UniProt: r.uniprot_id,
    Organism: r.organism_code || '?',
    iPTM: r.iptm?.toFixed(2),
    Confidence: r.confidence || 'AF2',
    Contacts: r.contacts_pae_lt_3 || '-',
    ipLDDT: r.interface_plddt?.toFixed(1) || '-'
  })));

  // Export to CSV
  const csv = 'uniprot_id,gene_name,organism,organism_code,iptm,confidence,contacts_pae_lt_3,contacts_pae_lt_6,interface_plddt,alphafold_version,source_path\n' +
    result.rows.map(r =>
      `${r.uniprot_id},${r.gene_name || ''},${r.organism || ''},${r.organism_code || ''},${r.iptm},${r.confidence || 'NULL'},${r.contacts_pae_lt_3 || ''},${r.contacts_pae_lt_6 || ''},${r.interface_plddt || ''},${r.alphafold_version},${r.source_path}`
    ).join('\n');

  const filename = `${target}_interactors.csv`;
  writeFileSync(filename, csv);
  console.log(`\n💾 Exported to ${filename}`);

  // Generate UniProt ID list for enrichment tools
  const uniprotList = result.rows
    .filter(r => r.confidence === 'High' || r.confidence === 'Medium') // Focus on reliable interactions
    .filter(r => r.uniprot_id && !r.uniprot_id.startsWith('AF2_') && !r.uniprot_id.startsWith('CRE')) // Valid UniProt IDs only
    .map(r => r.uniprot_id)
    .join('\n');

  const enrichFilename = `${target}_high_medium_uniprot_ids.txt`;
  writeFileSync(enrichFilename, uniprotList);
  console.log(`💾 Exported UniProt IDs (High+Medium confidence) to ${enrichFilename}`);
  console.log(`   Use this file for STRING/Enrichr pathway analysis`);

  console.log('\n📖 Next steps:');
  console.log('   1. Review the CSV file for detailed interaction data');
  console.log('   2. Upload UniProt IDs to STRING: https://string-db.org/');
  console.log('   3. Or use Enrichr: https://maayanlab.cloud/Enrichr/');
  console.log('   4. See FUNCTIONAL_ANALYSIS_GUIDE.md for detailed workflow');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

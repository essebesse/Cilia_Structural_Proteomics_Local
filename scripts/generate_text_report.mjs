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
  console.error('❌ Usage: node generate_text_report.mjs <protein_name_or_id>');
  process.exit(1);
}

console.log(`📝 Generating text reports for: ${target}\n`);

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
    console.log('❌ No interactors found');
    process.exit(1);
  }

  const rows = result.rows;
  const date = new Date().toISOString().split('T')[0];

  // Statistics
  const byConf = {
    High: rows.filter(r => r.confidence === 'High').length,
    Medium: rows.filter(r => r.confidence === 'Medium').length,
    Low: rows.filter(r => r.confidence === 'Low').length,
    AF2: rows.filter(r => r.confidence === null).length
  };

  // ====================
  // SUMMARY REPORT
  // ====================

  let summary = `================================================================================
FUNCTIONAL ANALYSIS REPORT: ${target}
Generated: ${date}
================================================================================

OVERVIEW
--------
Target Protein: ${target}
Total Interactors: ${rows.length}
Data Source: AlphaFold 3 Predictions

CONFIDENCE DISTRIBUTION
-----------------------
High Confidence:   ${byConf.High.toString().padStart(3)} interactions (iPTM ≥ 0.7 OR strong interface)
Medium Confidence: ${byConf.Medium.toString().padStart(3)} interactions (iPTM ≥ 0.6 OR moderate interface)
Low Confidence:    ${byConf.Low.toString().padStart(3)} interactions (exploratory)
AF2 Predictions:   ${byConf.AF2.toString().padStart(3)} interactions

RECOMMENDED FOCUS: High + Medium confidence (${byConf.High + byConf.Medium} interactions)

================================================================================
HIGH CONFIDENCE INTERACTORS (${byConf.High})
================================================================================
`;

  rows.filter(r => r.confidence === 'High').forEach((r, i) => {
    summary += `
${(i+1).toString().padStart(2)}. ${(r.gene_name || r.uniprot_id).padEnd(15)} (${r.uniprot_id})
    iPTM: ${r.iptm?.toFixed(3) || 'N/A'}  |  Contacts (<3Å): ${r.contacts_pae_lt_3?.toString().padStart(3) || 'N/A'}  |  ipLDDT: ${r.interface_plddt?.toFixed(1) || 'N/A'}
    Organism: ${r.organism || 'Unknown'}
`;
  });

  summary += `
================================================================================
MEDIUM CONFIDENCE INTERACTORS (${byConf.Medium})
================================================================================
`;

  rows.filter(r => r.confidence === 'Medium').forEach((r, i) => {
    summary += `
${(i+1).toString().padStart(2)}. ${(r.gene_name || r.uniprot_id).padEnd(15)} (${r.uniprot_id})
    iPTM: ${r.iptm?.toFixed(3) || 'N/A'}  |  Contacts (<3Å): ${r.contacts_pae_lt_3?.toString().padStart(3) || 'N/A'}  |  ipLDDT: ${r.interface_plddt?.toFixed(1) || 'N/A'}
`;
  });

  summary += `
================================================================================
NEXT STEPS FOR FUNCTIONAL ANALYSIS
================================================================================

1. PATHWAY ENRICHMENT
   - Upload UniProt IDs to STRING: https://string-db.org/
   - File: analysis_reports/${target}_enrichment_ids.txt (${byConf.High + byConf.Medium} proteins)
   - Expected: Enriched pathways, GO terms, protein complexes

2. LITERATURE SEARCH
   - Check PubMed for known ${target} interactions
   - Validate top High confidence hits

3. FUNCTIONAL GROUPING
   - Group interactors by biological process
   - Identify shared GO terms or pathways
   - Look for protein complexes

4. BIOLOGICAL INTERPRETATION
   - What cellular processes are enriched?
   - Do interactions suggest novel ${target} function?
   - Are there unexpected findings?

5. EXPERIMENTAL VALIDATION
   - Prioritize High confidence interactions
   - Consider co-IP, co-localization studies

================================================================================
DATA FILES GENERATED
================================================================================
- analysis_reports/${target}_summary.txt        (This summary report)
- analysis_reports/${target}_full_list.txt      (Complete formatted list)
- analysis_reports/${target}_enrichment_ids.txt (UniProt IDs for STRING/Enrichr)

For detailed workflow, see: FUNCTIONAL_ANALYSIS_GUIDE.md
================================================================================
`;

  writeFileSync(`analysis_reports/${target}_summary.txt`, summary);
  console.log(`✅ Generated: analysis_reports/${target}_summary.txt`);

  // ====================
  // FULL LIST
  // ====================

  let fullList = `================================================================================
COMPLETE INTERACTOR LIST: ${target}
All ${rows.length} Interactions | Generated: ${date}
================================================================================

Format: [Rank] Gene_Name (UniProt) | iPTM | Confidence | Contacts | ipLDDT
        Organism | Data Source

================================================================================
`;

  rows.forEach((r, i) => {
    fullList += `
[${(i+1).toString().padStart(3)}] ${(r.gene_name || r.uniprot_id).padEnd(20)} (${r.uniprot_id})
      iPTM: ${(r.iptm?.toFixed(3) || 'N/A').padEnd(8)} | Confidence: ${(r.confidence || 'AF2').padEnd(8)}
      Contacts (<3Å): ${(r.contacts_pae_lt_3?.toString() || 'N/A').padStart(4)} | ipLDDT: ${(r.interface_plddt?.toFixed(1) || 'N/A').padEnd(6)}
      Organism: ${r.organism || 'Unknown'}
      Source: ${r.source_path ? r.source_path.split('/').slice(-3).join('/') : 'N/A'}
`;
  });

  fullList += `
================================================================================
END OF LIST
================================================================================
`;

  writeFileSync(`analysis_reports/${target}_full_list.txt`, fullList);
  console.log(`✅ Generated: analysis_reports/${target}_full_list.txt`);

  // ====================
  // UNIPROT IDS FOR ENRICHMENT
  // ====================

  const uniprotIds = rows
    .filter(r => r.confidence === 'High' || r.confidence === 'Medium')
    .filter(r => r.uniprot_id && !r.uniprot_id.startsWith('AF2_') && !r.uniprot_id.startsWith('CRE'))
    .map(r => r.uniprot_id);

  const uniqueIds = [...new Set(uniprotIds)];

  let uniprotFile = `# ${target} Interactors - High + Medium Confidence
# Generated: ${date}
# Total proteins: ${uniqueIds.length}
# Use for pathway enrichment: STRING, Enrichr, GO analysis
#
# To use with STRING:
# 1. Go to https://string-db.org/
# 2. Click "Multiple proteins"
# 3. Paste these UniProt IDs (lines without #)
# 4. Select appropriate organism
# 5. Run enrichment analysis
#
${uniqueIds.join('\n')}
`;

  writeFileSync(`analysis_reports/${target}_enrichment_ids.txt`, uniprotFile);
  console.log(`✅ Generated: analysis_reports/${target}_enrichment_ids.txt`);

  console.log(`\n📊 Summary:`);
  console.log(`   Total interactors: ${rows.length}`);
  console.log(`   High confidence: ${byConf.High}`);
  console.log(`   Medium confidence: ${byConf.Medium}`);
  console.log(`   UniProt IDs for enrichment: ${uniqueIds.length}`);
  console.log(`\n📖 Next: Upload enrichment IDs to STRING or Enrichr for pathway analysis`);

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

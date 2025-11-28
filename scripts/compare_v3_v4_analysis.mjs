#!/usr/bin/env node
/**
 * Comprehensive v3 vs v4 Analysis Comparison
 *
 * This script compares the Interface Quality (v3) and ipSAE Scoring (v4) methods
 * for protein-protein interaction predictions to answer:
 *
 * 1. CONCORDANCE: Do v3 and v4 agree on top hits?
 * 2. DISCORDANCE: Where do they disagree and why?
 * 3. FILTERING IMPACT: How many interactions lost to v4's ipSAE < 0.3 cutoff?
 * 4. SYSTEMATIC BIASES: Does v4 handle large/disordered proteins differently?
 *
 * Usage:
 *   export POSTGRES_URL="postgresql://..."
 *   node scripts/compare_v3_v4_analysis.mjs
 */

import { sql } from '@vercel/postgres';
import * as fs from 'fs';

// v3 confidence classification (interface quality-centric)
function classifyV3Confidence(iptm, contacts_pae3, interface_plddt) {
  // High: iPTM ≥ 0.7 OR (contacts ≥ 40 AND ipLDDT ≥ 80) OR (contacts ≥ 30 AND iPTM ≥ 0.5 AND ipLDDT ≥ 80)
  // BUT exclude if iPTM < 0.75 AND contacts < 5
  if ((iptm >= 0.7 ||
       (contacts_pae3 >= 40 && interface_plddt >= 80) ||
       (contacts_pae3 >= 30 && iptm >= 0.5 && interface_plddt >= 80)) &&
      !(iptm < 0.75 && contacts_pae3 < 5)) {
    return 'High';
  }

  // Medium: iPTM ≥ 0.6 OR (contacts ≥ 20 AND ipLDDT ≥ 75) OR (contacts ≥ 15 AND iPTM ≥ 0.45)
  if (iptm >= 0.6 ||
      (contacts_pae3 >= 20 && interface_plddt >= 75) ||
      (contacts_pae3 >= 15 && iptm >= 0.45)) {
    return 'Medium';
  }

  // Low: Everything else
  return 'Low';
}

// v4 ipSAE confidence classification
function classifyV4Confidence(ipsae) {
  if (ipsae === null || ipsae === undefined) return 'N/A';
  if (ipsae > 0.7) return 'High';
  if (ipsae >= 0.5) return 'Medium';
  if (ipsae >= 0.3) return 'Low';
  return 'Very Low';
}

// Calculate protein size category
function getSizeCategory(baitGene, preyGene) {
  const largeProteins = ['IFT140', 'IFT122', 'WDR19', 'IFT74', 'IFT81', 'CCDC198'];
  const isLarge = largeProteins.some(p =>
    baitGene?.includes(p) || preyGene?.includes(p)
  );
  return isLarge ? 'Large' : 'Normal';
}

async function analyzeV3vsV4() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE v3 vs v4 ANALYSIS');
  console.log('='.repeat(80));
  console.log('\nFetching data from Neon database...\n');

  try {
    // Get all AF3 interactions with both v3 and v4 data
    const result = await sql`
      SELECT
        i.id,
        i.iptm,
        i.contacts_pae_lt_3,
        i.contacts_pae_lt_6,
        i.interface_plddt,
        i.ipsae,
        i.ipsae_confidence,
        i.source_path,
        bait.uniprot_id as bait_uniprot,
        bait.gene_name as bait_gene,
        bait.organism_code as bait_organism,
        prey.uniprot_id as prey_uniprot,
        prey.gene_name as prey_gene,
        prey.organism_code as prey_organism
      FROM interactions i
      JOIN proteins bait ON i.bait_protein_id = bait.id
      JOIN proteins prey ON i.prey_protein_id = prey.id
      WHERE i.alphafold_version = 'AF3'
      ORDER BY i.id
    `;

    const allInteractions = result.rows;
    console.log(`Total AF3 interactions in database: ${allInteractions.length}`);

    // Separate into v3-all and v4-available
    const v3All = allInteractions;
    const v4Available = allInteractions.filter(i => i.ipsae !== null);
    const v4Excluded = allInteractions.filter(i => i.ipsae === null);

    console.log(`  - Interactions with v4 data (ipSAE scores): ${v4Available.length}`);
    console.log(`  - Interactions without v4 data: ${v4Excluded.length}`);
    console.log(`  - v4 data coverage: ${(v4Available.length / v3All.length * 100).toFixed(1)}%`);

    // Classify all interactions for both methods
    const comparisons = v4Available.map(inter => {
      const v3Class = classifyV3Confidence(
        inter.iptm,
        inter.contacts_pae_lt_3 || 0,
        inter.interface_plddt || 0
      );
      const v4Class = classifyV4Confidence(inter.ipsae);
      const sizeCategory = getSizeCategory(inter.bait_gene, inter.prey_gene);

      return {
        ...inter,
        v3_confidence: v3Class,
        v4_confidence: v4Class,
        size_category: sizeCategory,
        agreement: v3Class === v4Class,
        pair_name: `${inter.bait_gene || inter.bait_uniprot} - ${inter.prey_gene || inter.prey_uniprot}`
      };
    });

    // ===================
    // 1. OVERALL STATISTICS
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('1. OVERALL DISTRIBUTION');
    console.log('='.repeat(80));

    const v3Distribution = {
      'High': comparisons.filter(c => c.v3_confidence === 'High').length,
      'Medium': comparisons.filter(c => c.v3_confidence === 'Medium').length,
      'Low': comparisons.filter(c => c.v3_confidence === 'Low').length,
    };

    const v4Distribution = {
      'High': comparisons.filter(c => c.v4_confidence === 'High').length,
      'Medium': comparisons.filter(c => c.v4_confidence === 'Medium').length,
      'Low': comparisons.filter(c => c.v4_confidence === 'Low').length,
      'Very Low': comparisons.filter(c => c.v4_confidence === 'Very Low').length,
    };

    console.log('\nv3 Interface Quality Distribution:');
    Object.entries(v3Distribution).forEach(([level, count]) => {
      console.log(`  ${level}: ${count} (${(count / comparisons.length * 100).toFixed(1)}%)`);
    });

    console.log('\nv4 ipSAE Distribution:');
    Object.entries(v4Distribution).forEach(([level, count]) => {
      console.log(`  ${level}: ${count} (${(count / comparisons.length * 100).toFixed(1)}%)`);
    });

    // v4 filtering impact
    const v4VeryLowCount = v4Distribution['Very Low'];
    console.log(`\n⚠️  v4 FILTERING IMPACT: ${v4VeryLowCount} interactions (${(v4VeryLowCount / comparisons.length * 100).toFixed(1)}%) excluded due to ipSAE < 0.3`);

    // ===================
    // 2. CONCORDANCE ANALYSIS
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('2. CONCORDANCE ANALYSIS (Do v3 and v4 agree?)');
    console.log('='.repeat(80));

    const agreementCount = comparisons.filter(c => c.agreement).length;
    const disagreementCount = comparisons.filter(c => !c.agreement).length;

    console.log(`\nOverall Agreement: ${agreementCount}/${comparisons.length} (${(agreementCount / comparisons.length * 100).toFixed(1)}%)`);
    console.log(`Overall Disagreement: ${disagreementCount}/${comparisons.length} (${(disagreementCount / comparisons.length * 100).toFixed(1)}%)`);

    // Agreement by confidence tier
    console.log('\nAgreement by v3 Confidence Tier:');
    ['High', 'Medium', 'Low'].forEach(tier => {
      const tierInteractions = comparisons.filter(c => c.v3_confidence === tier);
      const tierAgreement = tierInteractions.filter(c => c.agreement).length;
      if (tierInteractions.length > 0) {
        console.log(`  v3 ${tier}: ${tierAgreement}/${tierInteractions.length} (${(tierAgreement / tierInteractions.length * 100).toFixed(1)}%)`);
      }
    });

    console.log('\nAgreement by v4 Confidence Tier:');
    ['High', 'Medium', 'Low', 'Very Low'].forEach(tier => {
      const tierInteractions = comparisons.filter(c => c.v4_confidence === tier);
      const tierAgreement = tierInteractions.filter(c => c.agreement).length;
      if (tierInteractions.length > 0) {
        console.log(`  v4 ${tier}: ${tierAgreement}/${tierInteractions.length} (${(tierAgreement / tierInteractions.length * 100).toFixed(1)}%)`);
      }
    });

    // ===================
    // 3. TOP HITS COMPARISON
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('3. TOP HITS COMPARISON (Are the best interactions found by both methods?)');
    console.log('='.repeat(80));

    const v3High = comparisons.filter(c => c.v3_confidence === 'High');
    const v4High = comparisons.filter(c => c.v4_confidence === 'High');

    const v3HighPairs = new Set(v3High.map(c => c.pair_name));
    const v4HighPairs = new Set(v4High.map(c => c.pair_name));

    const bothHigh = v3High.filter(c => v4HighPairs.has(c.pair_name));
    const v3HighOnly = v3High.filter(c => !v4HighPairs.has(c.pair_name));
    const v4HighOnly = v4High.filter(c => !v3HighPairs.has(c.pair_name));

    console.log(`\nv3 High Confidence: ${v3High.length}`);
    console.log(`v4 High Confidence: ${v4High.length}`);
    console.log(`Shared High Confidence: ${bothHigh.length}`);
    console.log(`v3 High ONLY: ${v3HighOnly.length} (not High in v4)`);
    console.log(`v4 High ONLY: ${v4HighOnly.length} (not High in v3)`);

    // Show overlap percentage
    const v3HighCapture = bothHigh.length / v3High.length * 100;
    const v4HighCapture = bothHigh.length / v4High.length * 100;
    console.log(`\nv3 High confidence hits captured by v4 High: ${v3HighCapture.toFixed(1)}%`);
    console.log(`v4 High confidence hits captured by v3 High: ${v4HighCapture.toFixed(1)}%`);

    // ===================
    // 4. DISCORDANCE ANALYSIS
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('4. DISCORDANCE PATTERNS (Where and why do they disagree?)');
    console.log('='.repeat(80));

    const disagreements = comparisons.filter(c => !c.agreement);

    // Create transition matrix
    const transitionMatrix = {
      'High->High': 0, 'High->Medium': 0, 'High->Low': 0, 'High->Very Low': 0,
      'Medium->High': 0, 'Medium->Medium': 0, 'Medium->Low': 0, 'Medium->Very Low': 0,
      'Low->High': 0, 'Low->Medium': 0, 'Low->Low': 0, 'Low->Very Low': 0,
    };

    comparisons.forEach(c => {
      const key = `${c.v3_confidence}->${c.v4_confidence}`;
      if (transitionMatrix.hasOwnProperty(key)) {
        transitionMatrix[key]++;
      }
    });

    console.log('\nTransition Matrix (v3 -> v4):');
    console.log('              v4 High  v4 Medium  v4 Low  v4 Very Low');
    ['High', 'Medium', 'Low'].forEach(v3Level => {
      const row = [
        transitionMatrix[`${v3Level}->High`],
        transitionMatrix[`${v3Level}->Medium`],
        transitionMatrix[`${v3Level}->Low`],
        transitionMatrix[`${v3Level}->Very Low`]
      ];
      console.log(`v3 ${v3Level.padEnd(8)}  ${row.map(n => String(n).padStart(7)).join('  ')}`);
    });

    // ===================
    // 5. PROTEIN SIZE ANALYSIS
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('5. PROTEIN SIZE IMPACT (Does v4 handle large proteins better?)');
    console.log('='.repeat(80));

    const largeProteinComparisons = comparisons.filter(c => c.size_category === 'Large');
    const normalProteinComparisons = comparisons.filter(c => c.size_category === 'Normal');

    console.log(`\nLarge multidomain proteins (IFT140, IFT122, WDR19, etc.): ${largeProteinComparisons.length} interactions`);
    console.log(`Normal-sized proteins: ${normalProteinComparisons.length} interactions`);

    if (largeProteinComparisons.length > 0) {
      const largeAgreement = largeProteinComparisons.filter(c => c.agreement).length;
      console.log(`\nLarge proteins agreement: ${largeAgreement}/${largeProteinComparisons.length} (${(largeAgreement / largeProteinComparisons.length * 100).toFixed(1)}%)`);

      // Show v3 vs v4 distribution for large proteins
      const largeV3High = largeProteinComparisons.filter(c => c.v3_confidence === 'High').length;
      const largeV4High = largeProteinComparisons.filter(c => c.v4_confidence === 'High').length;
      console.log(`  v3 High confidence: ${largeV3High} (${(largeV3High / largeProteinComparisons.length * 100).toFixed(1)}%)`);
      console.log(`  v4 High confidence: ${largeV4High} (${(largeV4High / largeProteinComparisons.length * 100).toFixed(1)}%)`);
    }

    if (normalProteinComparisons.length > 0) {
      const normalAgreement = normalProteinComparisons.filter(c => c.agreement).length;
      console.log(`\nNormal proteins agreement: ${normalAgreement}/${normalProteinComparisons.length} (${(normalAgreement / normalProteinComparisons.length * 100).toFixed(1)}%)`);

      const normalV3High = normalProteinComparisons.filter(c => c.v3_confidence === 'High').length;
      const normalV4High = normalProteinComparisons.filter(c => c.v4_confidence === 'High').length;
      console.log(`  v3 High confidence: ${normalV3High} (${(normalV3High / normalProteinComparisons.length * 100).toFixed(1)}%)`);
      console.log(`  v4 High confidence: ${normalV4High} (${(normalV4High / normalProteinComparisons.length * 100).toFixed(1)}%)`);
    }

    // ===================
    // 6. DETAILED EXAMPLES
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('6. DETAILED DISAGREEMENT EXAMPLES');
    console.log('='.repeat(80));

    // v3 High, but v4 not High
    console.log('\nCase 1: v3 High → v4 Medium/Low (v3 more optimistic)');
    const v3HighV4Lower = comparisons
      .filter(c => c.v3_confidence === 'High' && ['Medium', 'Low'].includes(c.v4_confidence))
      .slice(0, 5);

    if (v3HighV4Lower.length > 0) {
      console.log('Pair                          iPTM   PAE<3Å  ipLDDT  ipSAE  v3→v4');
      v3HighV4Lower.forEach(c => {
        console.log(
          `${c.pair_name.substring(0, 30).padEnd(30)} ` +
          `${c.iptm.toFixed(2)}   ${String(c.contacts_pae_lt_3 || 0).padStart(6)}  ` +
          `${(c.interface_plddt || 0).toFixed(1).padStart(6)}  ` +
          `${(c.ipsae || 0).toFixed(2)}  ${c.v3_confidence}→${c.v4_confidence}`
        );
      });
    } else {
      console.log('No examples found.');
    }

    // v4 High, but v3 not High
    console.log('\nCase 2: v3 Medium/Low → v4 High (v4 more optimistic)');
    const v4HighV3Lower = comparisons
      .filter(c => ['Medium', 'Low'].includes(c.v3_confidence) && c.v4_confidence === 'High')
      .slice(0, 5);

    if (v4HighV3Lower.length > 0) {
      console.log('Pair                          iPTM   PAE<3Å  ipLDDT  ipSAE  v3→v4');
      v4HighV3Lower.forEach(c => {
        console.log(
          `${c.pair_name.substring(0, 30).padEnd(30)} ` +
          `${c.iptm.toFixed(2)}   ${String(c.contacts_pae_lt_3 || 0).padStart(6)}  ` +
          `${(c.interface_plddt || 0).toFixed(1).padStart(6)}  ` +
          `${(c.ipsae || 0).toFixed(2)}  ${c.v3_confidence}→${c.v4_confidence}`
        );
      });
    } else {
      console.log('No examples found.');
    }

    // v3 Low, but v4 High (major upgrade)
    console.log('\nCase 3: Major Upgrades - v3 Low → v4 High (v4 rescue)');
    const majorUpgrades = comparisons
      .filter(c => c.v3_confidence === 'Low' && c.v4_confidence === 'High')
      .slice(0, 5);

    if (majorUpgrades.length > 0) {
      console.log('Pair                          iPTM   PAE<3Å  ipLDDT  ipSAE  v3→v4');
      majorUpgrades.forEach(c => {
        console.log(
          `${c.pair_name.substring(0, 30).padEnd(30)} ` +
          `${c.iptm.toFixed(2)}   ${String(c.contacts_pae_lt_3 || 0).padStart(6)}  ` +
          `${(c.interface_plddt || 0).toFixed(1).padStart(6)}  ` +
          `${(c.ipsae || 0).toFixed(2)}  ${c.v3_confidence}→${c.v4_confidence}`
        );
      });
      console.log(`\n✅ v4 RESCUED ${majorUpgrades.length} interactions that v3 classified as Low!`);
    } else {
      console.log('No examples found.');
    }

    // ===================
    // 7. EXPORT DETAILED DATA
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('7. EXPORTING DETAILED DATA');
    console.log('='.repeat(80));

    // Create CSV for detailed analysis
    const csvHeader = 'bait_gene,prey_gene,bait_organism,prey_organism,iptm,contacts_pae3,contacts_pae6,interface_plddt,ipsae,v3_confidence,v4_confidence,agreement,size_category,source_path\n';
    const csvRows = comparisons.map(c =>
      `"${c.bait_gene || c.bait_uniprot}","${c.prey_gene || c.prey_uniprot}",` +
      `"${c.bait_organism || ''}","${c.prey_organism || ''}",` +
      `${c.iptm},${c.contacts_pae_lt_3 || 0},${c.contacts_pae_lt_6 || 0},${c.interface_plddt || 0},` +
      `${c.ipsae || ''},${c.v3_confidence},${c.v4_confidence},${c.agreement},${c.size_category},"${c.source_path || ''}"`
    ).join('\n');

    const csvContent = csvHeader + csvRows;
    fs.writeFileSync('v3_vs_v4_comparison.csv', csvContent);
    console.log('\n✅ Detailed comparison exported to: v3_vs_v4_comparison.csv');

    // Create summary JSON
    const summaryData = {
      timestamp: new Date().toISOString(),
      total_interactions: comparisons.length,
      v4_coverage_pct: (v4Available.length / v3All.length * 100).toFixed(1),
      v4_excluded_count: v4VeryLowCount,
      distributions: {
        v3: v3Distribution,
        v4: v4Distribution
      },
      concordance: {
        overall_agreement_pct: (agreementCount / comparisons.length * 100).toFixed(1),
        by_v3_tier: {
          high: v3High.length > 0 ? (v3High.filter(c => c.agreement).length / v3High.length * 100).toFixed(1) : 0,
          medium: comparisons.filter(c => c.v3_confidence === 'Medium' && c.agreement).length,
          low: comparisons.filter(c => c.v3_confidence === 'Low' && c.agreement).length
        }
      },
      top_hits: {
        v3_high_count: v3High.length,
        v4_high_count: v4High.length,
        shared_high_count: bothHigh.length,
        v3_high_capture_pct: v3HighCapture.toFixed(1),
        v4_high_capture_pct: v4HighCapture.toFixed(1)
      },
      protein_size_impact: {
        large_proteins: {
          count: largeProteinComparisons.length,
          agreement_pct: largeProteinComparisons.length > 0 ?
            (largeProteinComparisons.filter(c => c.agreement).length / largeProteinComparisons.length * 100).toFixed(1) : 0
        },
        normal_proteins: {
          count: normalProteinComparisons.length,
          agreement_pct: normalProteinComparisons.length > 0 ?
            (normalProteinComparisons.filter(c => c.agreement).length / normalProteinComparisons.length * 100).toFixed(1) : 0
        }
      },
      transition_matrix: transitionMatrix
    };

    fs.writeFileSync('v3_vs_v4_summary.json', JSON.stringify(summaryData, null, 2));
    console.log('✅ Summary statistics exported to: v3_vs_v4_summary.json');

    // ===================
    // 8. RECOMMENDATIONS
    // ===================
    console.log('\n' + '='.repeat(80));
    console.log('8. RECOMMENDATIONS');
    console.log('='.repeat(80));

    console.log('\nBased on this analysis:\n');

    const v4StricterPct = (v4High.length / v3High.length * 100);
    if (v4StricterPct < 80) {
      console.log('📊 v4 is MORE STRINGENT than v3:');
      console.log(`   - Identifies ${v4High.length} high-confidence hits vs ${v3High.length} from v3`);
      console.log(`   - Filters out ${v4VeryLowCount} very low confidence predictions (ipSAE < 0.3)`);
      console.log(`   - Use v4 for: Reducing false positives, prioritizing top candidates`);
      console.log(`   - Use v3 for: Comprehensive coverage, exploratory analysis`);
    } else if (v4StricterPct > 120) {
      console.log('📊 v4 is MORE PERMISSIVE than v3:');
      console.log(`   - Identifies ${v4High.length} high-confidence hits vs ${v3High.length} from v3`);
      console.log(`   - May rescue interactions v3 missed (especially for large proteins)`);
      console.log(`   - Use v4 for: Recovering potentially missed interactions`);
      console.log(`   - Use v3 for: Interface quality assessment, structural validation`);
    } else {
      console.log('📊 v3 and v4 are ROUGHLY EQUIVALENT in stringency:');
      console.log(`   - Similar numbers of high-confidence hits (${v3High.length} vs ${v4High.length})`);
      console.log(`   - Both methods complement each other`);
      console.log(`   - Consider using BOTH for comprehensive analysis`);
    }

    if (majorUpgrades.length > 0) {
      console.log(`\n✅ v4 RESCUED ${majorUpgrades.length} interactions from v3 "Low" → v4 "High"`);
      console.log('   These may represent genuine interactions in large/disordered proteins');
    }

    const highDisagreementPct = v3HighOnly.length / v3High.length * 100;
    if (highDisagreementPct > 20) {
      console.log(`\n⚠️  Significant disagreement on high-confidence hits (${highDisagreementPct.toFixed(0)}%)`);
      console.log('   Recommend manual inspection of discordant cases');
    }

    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error during analysis:', error);
    throw error;
  }
}

// Run the analysis
analyzeV3vsV4().catch(console.error);

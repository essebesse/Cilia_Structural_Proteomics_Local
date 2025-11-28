#!/usr/bin/env node
/**
 * Update Complex Display Names
 * =============================
 *
 * Updates all protein complex display names to use gene names instead of UniProt IDs.
 * Should be run after fetching protein aliases and populating gene names.
 *
 * Usage:
 *   node db/update_complex_display_names.mjs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';

/**
 * Extract variant from complex_name
 * Examples:
 *   Q9NQC8_Q9Y366_Cterm -> Cterm
 *   Q9NQC8_Q9Y366_Cterm_141-107aa -> Cterm_141-107aa
 *   Q9NQC8_Q9Y366_FL -> FL
 *   Q96LB3_Q8WYA0 -> FL (default, no variant suffix)
 *
 * Strategy: Split by underscore, find last UniProt ID, everything after is variant
 */
function extractVariant(complexName) {
  const parts = complexName.split('_');

  // Find the last part that looks like a UniProt ID (e.g., Q9NQC8, P12345)
  let lastUniprotIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[QPOAB][0-9][A-Z0-9]{4}$/i.test(parts[i])) {
      lastUniprotIndex = i;
      break;
    }
  }

  // If we found a UniProt ID and there's something after it, that's the variant
  if (lastUniprotIndex >= 0 && lastUniprotIndex < parts.length - 1) {
    // Join all parts after the last UniProt ID
    return parts.slice(lastUniprotIndex + 1).join('_');
  }

  // Default to FL if no variant suffix found
  return 'FL';
}

async function updateComplexDisplayNames() {
  console.log('Updating Complex Display Names');
  console.log('==============================\n');

  try {
    // Get all complexes
    const complexes = await sql`SELECT id, complex_name, display_name FROM protein_complexes`;
    console.log(`Found ${complexes.rows.length} complexes to update\n`);

    for (const complex of complexes.rows) {
      console.log(`Complex: ${complex.complex_name}`);
      console.log(`  Current display name: ${complex.display_name}`);

      // Extract variant from complex_name (e.g., Q9NQC8_Q9Y366_Cterm -> Cterm)
      const variant = extractVariant(complex.complex_name);

      // Generate new display name from gene names
      const geneNamesResult = await sql`
        SELECT STRING_AGG(
          COALESCE(p.gene_name, p.uniprot_id),
          ' & '
          ORDER BY cp.position
        ) as gene_names
        FROM complex_proteins cp
        JOIN proteins p ON cp.protein_id = p.id
        WHERE cp.complex_id = ${complex.id}
      `;

      const geneNames = geneNamesResult.rows[0].gene_names;

      // Add variant suffix if not FL
      const displayName = variant === 'FL'
        ? geneNames
        : `${geneNames} (${variant})`;

      // Update display name
      const result = await sql`
        UPDATE protein_complexes
        SET display_name = ${displayName}
        WHERE id = ${complex.id}
        RETURNING display_name
      `;

      console.log(`  New display name: ${result.rows[0].display_name}`);
      console.log();
    }

    console.log('✓ All complex display names updated!');
    console.log('\nYou can now view the updated names in:');
    console.log('  - Web interface dropdown');
    console.log('  - API responses (/api/complexes)');

  } catch (error) {
    console.error('Error updating display names:', error);
    throw error;
  }
}

// Main execution
updateComplexDisplayNames()
  .then(() => {
    console.log('\n✓ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Failed:', error.message);
    process.exit(1);
  });

#!/usr/bin/env node
import { db } from '@vercel/postgres';
import fetch from 'node-fetch';

const DELAY_MS = 200; // 200ms between requests (be nice to ChlamyFP server)
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

/**
 * Fetch complete ChlamyFP database
 */
async function fetchChlamyFPData() {
  const url = "https://chlamyfp.org/ChlamyFPv2/cr_server_view_total_data.php";

  try {
    console.log('📡 Fetching ChlamyFP database...');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
      },
      timeout: 60000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const entries = data.data || [];
    console.log(`✅ Loaded ${entries.length} protein entries from ChlamyFP`);
    return entries;
  } catch (error) {
    console.error(`❌ Could not fetch ChlamyFP data: ${error.message}`);
    return [];
  }
}

/**
 * Find gene name for a CRE protein ID in ChlamyFP data
 * Returns { geneName: string, source: 'chlamyfp' | 'human_homolog' }
 */
function findGeneNameInChlamyFP(proteinId, chlamyFPData) {
  // Strip AF2_ prefix if present
  const cleanId = proteinId.replace(/^AF2_/, '');

  // Handle unusual patterns like Cre12.g559300_4532.1 -> Cre12.g559300
  // Strip _4532 or similar version numbers, keeping only the base gene ID
  let normalizedId = cleanId.replace(/_\d+\.\d+$/, '');  // Remove _4532.1
  normalizedId = normalizedId.replace(/_\d+$/, '');      // Remove trailing _4532 if no .1

  // Strip trailing dots (e.g., Cre03.g208000. -> Cre03.g208000)
  normalizedId = normalizedId.replace(/\.$/, '');

  // Convert format: CRE01_G065822_T1_1 -> Cre01.g065822.t1.1
  // Make sure to lowercase all parts after Cre prefix
  let formattedId = normalizedId.replace(/_/g, '.').replace(/CRE/i, 'Cre');
  // Handle case: Cre10.G443150.T1.2 -> Cre10.g443150.t1.2
  formattedId = formattedId.replace(/^(Cre\d+)\.(.+)$/, (match, p1, p2) => `${p1}.${p2.toLowerCase()}`);

  for (const entry of chlamyFPData) {
    if (Array.isArray(entry) && entry.length > 1) {
      const entryId = String(entry[0]).trim();

      // Use prefix matching to handle version suffixes
      // E.g., Cre01.g044800.t1 matches Cre01.g044800.t1.2
      const exactMatch = formattedId === entryId;
      const prefixMatch = entryId.startsWith(formattedId + '.') || entryId.startsWith(formattedId);
      const underscoreMatch = cleanId.toLowerCase() === entryId.toLowerCase().replace(/\./g, '_');

      if (exactMatch || prefixMatch || underscoreMatch) {
        // Try field [1] first (Gene and Aliases column)
        let geneName = String(entry[1] || '').trim();

        // If field [1] is empty, try field [2] (ChlamyFPv5 Annotation column)
        if (!geneName && entry.length > 2) {
          geneName = String(entry[2] || '').trim();
        }

        // Remove HTML tags
        geneName = geneName.replace(/<[^>]+>/g, '');
        geneName = geneName.replace(/&nbsp;/g, ' ').trim();

        if (geneName && geneName !== cleanId && geneName !== proteinId) {
          // Extract first gene name if multiple (separated by semicolon)
          const firstGene = geneName.split(';')[0].trim();
          return { geneName: firstGene, source: 'chlamyfp' };
        }

        // If no Chlamydomonas gene name, try to extract human homolog from field [6]
        if (entry.length > 6 && entry[6]) {
          let humanHomolog = String(entry[6]).trim();
          // Remove HTML tags and extract gene name
          humanHomolog = humanHomolog.replace(/<[^>]+>/g, '');
          humanHomolog = humanHomolog.replace(/&nbsp;/g, ' ').trim();

          // Extract gene name from patterns like "PLEKHA8, pleckstrin homology..."
          const match = humanHomolog.match(/^([A-Z0-9]+)/);
          if (match && match[1]) {
            return { geneName: `${match[1]} (Hs homolog)`, source: 'human_homolog' };
          }
        }

        // If still no gene name, try extracting from E-values field [8]
        // Pattern: "Hs: 5E-03 (NABP2)" -> extract NABP2 if E-value < 1e-2
        if (entry.length > 8 && entry[8]) {
          let evalues = String(entry[8]).trim();
          // Remove HTML tags
          evalues = evalues.replace(/<[^>]+>/g, '');
          evalues = evalues.replace(/&#8226/g, '').replace(/&nbsp;/g, ' ').trim();

          // Extract Hs homolog with E-value: "Hs: 5E-03 (NABP2)"
          const hsMatch = evalues.match(/Hs:\s*([\d.E-]+)\s*\(([A-Z0-9]+)\)/i);
          if (hsMatch && hsMatch[1] && hsMatch[2]) {
            const evalue = parseFloat(hsMatch[1]);
            // Only use if E-value < 1e-2 (0.01)
            if (!isNaN(evalue) && evalue < 0.01) {
              return { geneName: `${hsMatch[2]} (Hs homolog)`, source: 'evalues' };
            }
          }
        }
      }
    }
  }

  return null;
}

async function updateChlamyGeneNames() {
  const client = await db.connect();

  try {
    console.log('🧬 ChlamyFP Gene Name Lookup Tool');
    console.log('This tool updates CRE* and AF2_Cre* proteins with gene names from ChlamyFP\n');

    // Get all CRE/AF2_Cre/Cre proteins without gene names, with redundant gene names, or with long names
    const creProteins = await client.query(`
      SELECT id, uniprot_id, gene_name
      FROM proteins
      WHERE (uniprot_id LIKE 'CRE%' OR uniprot_id LIKE 'AF2_Cre%' OR uniprot_id LIKE 'Cre%')
        AND (
          gene_name IS NULL
          OR gene_name = ''
          OR gene_name = REPLACE(uniprot_id, 'AF2_', '')
          OR LENGTH(gene_name) > 40
        )
      ORDER BY uniprot_id
    `);

    console.log(`🔍 Found ${creProteins.rows.length} Chlamydomonas proteins without gene names`);

    if (creProteins.rows.length === 0) {
      console.log('✅ All CRE proteins already have gene names!');
      return;
    }

    // Fetch ChlamyFP database
    const chlamyFPData = await fetchChlamyFPData();

    if (chlamyFPData.length === 0) {
      console.error('❌ Cannot proceed without ChlamyFP data');
      return;
    }

    console.log(`\n📝 Looking up gene names for ${creProteins.rows.length} proteins...\n`);

    let updated = 0;
    let notFound = 0;
    let truncated = 0;

    for (const protein of creProteins.rows) {
      const result = findGeneNameInChlamyFP(protein.uniprot_id, chlamyFPData);

      if (result) {
        let displayName = result.geneName;
        let fullDescription = result.geneName;
        let wasTruncated = false;

        // If gene name is long (> 40 chars), truncate for display
        if (result.geneName.length > 40) {
          // Extract first 3-4 words
          const words = result.geneName.split(/\s+/);
          const truncatedWords = words.slice(0, 4);
          displayName = truncatedWords.join(' ') + '...';
          wasTruncated = true;
          truncated++;
        }

        // Update protein with gene name and common_name
        await client.query(`
          UPDATE proteins
          SET gene_name = $1, common_name = $2
          WHERE id = $3
        `, [displayName, wasTruncated ? fullDescription : null, protein.id]);

        // Add alias for searchability (use full name for search)
        await client.query(`
          INSERT INTO protein_aliases (protein_id, alias_name, alias_type, source)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [protein.id, fullDescription, 'gene_name', result.source]);

        const sourceTag = result.source === 'human_homolog' ? '🧬 (Hs homolog)' : '';
        const truncTag = wasTruncated ? ' 📝' : '';
        console.log(`✅ ${protein.uniprot_id} → ${displayName} ${sourceTag}${truncTag}`);
        updated++;
      } else {
        console.log(`⚠️  ${protein.uniprot_id} → Not found in ChlamyFP`);
        notFound++;
      }

      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    console.log('\n📈 Summary:');
    console.log(`  ✅ Updated: ${updated} proteins`);
    console.log(`  📝 Truncated (long names): ${truncated} proteins`);
    console.log(`  ⚠️  Not found: ${notFound} proteins`);
    console.log(`  📊 Coverage: ${Math.round(100 * updated / creProteins.rows.length)}%`);

  } finally {
    await client.release();
  }
}

console.log('🧬 ChlamyFP Gene Name Lookup\n');

updateChlamyGeneNames()
  .then(() => console.log('\n✅ ChlamyFP gene name lookup completed'))
  .catch(err => console.error('❌ Lookup failed:', err));

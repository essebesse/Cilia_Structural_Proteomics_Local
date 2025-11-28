
import { db } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const client = await db.connect();
  const { searchParams } = new URL(request.url);
  const confidenceLevels = searchParams.get('confidence')?.split(',') || [];
  const filterMode = searchParams.get('mode') || 'v3'; // 'v3' or 'ipsae'

  // Parse organism prefix if present
  // Supports both "Hs:BBS7" (with colon) and "HsBBS7" (without colon)
  let searchTerm = params.id;
  let organismCode: string | null = null;

  // Try matching with colon first (e.g., "Hs:BBS7" or "Cr:IFT144")
  const colonMatch = searchTerm.match(/^([A-Z][a-z]):(.+)$/);
  if (colonMatch) {
    organismCode = colonMatch[1];
    searchTerm = colonMatch[2];
  } else {
    // Try matching without colon (e.g., "HsBBS7" or "CrIFT144")
    // Only match known organism codes to avoid false positives
    const noColonMatch = searchTerm.match(/^(Hs|Cr|Mm|Dm|Ce|Sc|Dr|Xl|Rn)(.+)$/i);
    if (noColonMatch) {
      organismCode = noColonMatch[1].charAt(0).toUpperCase() + noColonMatch[1].charAt(1).toLowerCase();
      searchTerm = noColonMatch[2];
    }
  }

  let query = `
    SELECT
      i.id,
      i.iptm,
      i.confidence,
      i.alphafold_version,
      i.source_path,
      i.contacts_pae_lt_3,
      i.contacts_pae_lt_6,
      i.interface_plddt,
      i.ipsae,
      i.ipsae_confidence,
      i.ipsae_pae_cutoff,
      i.analysis_version,
      i.experimental_validation,
      bait.uniprot_id as bait_uniprot,
      bait.gene_name as bait_gene,
      bait.organism as bait_organism,
      bait.organism_code as bait_organism_code,
      bait.common_name as bait_common_name,
      prey.uniprot_id as prey_uniprot,
      prey.gene_name as prey_gene,
      prey.organism as prey_organism,
      prey.organism_code as prey_organism_code,
      prey.common_name as prey_common_name
    FROM interactions i
    JOIN proteins bait ON i.bait_protein_id = bait.id
    JOIN proteins prey ON i.prey_protein_id = prey.id
    WHERE i.id IN (
      SELECT DISTINCT i2.id
      FROM interactions i2
      JOIN proteins bait2 ON i2.bait_protein_id = bait2.id
      JOIN proteins prey2 ON i2.prey_protein_id = prey2.id
      LEFT JOIN protein_aliases bait_aliases ON bait2.id = bait_aliases.protein_id
      LEFT JOIN protein_aliases prey_aliases ON prey2.id = prey_aliases.protein_id
      WHERE (
        bait2.uniprot_id = $1 OR prey2.uniprot_id = $1 OR
        bait2.uniprot_id ILIKE '%' || $1 || '%' OR prey2.uniprot_id ILIKE '%' || $1 || '%' OR
        bait2.gene_name ILIKE '%' || $1 || '%' OR prey2.gene_name ILIKE '%' || $1 || '%' OR
        bait2.common_name ILIKE '%' || $1 || '%' OR prey2.common_name ILIKE '%' || $1 || '%' OR
        bait_aliases.alias_name ILIKE '%' || $1 || '%' OR prey_aliases.alias_name ILIKE '%' || $1 || '%' OR
        i2.source_path ILIKE '%' || $1 || '%'
      )
      ${organismCode ? `AND ((bait2.organism_code = $${organismCode ? 2 : 1}) OR (prey2.organism_code = $${organismCode ? 2 : 1}))` : ''}
    )
  `;

  let queryParams: any[] = [searchTerm];
  if (organismCode) {
    queryParams.push(organismCode);
  }

  // Apply filtering based on mode
  if (filterMode === 'ipsae') {
    // ipSAE mode: STRICT - only show v4 data with ipSAE scores
    query += ` AND i.ipsae IS NOT NULL`;

    if (confidenceLevels.length > 0) {
      const confidenceParamNum = queryParams.length + 1;
      query += ` AND i.ipsae_confidence = ANY($${confidenceParamNum})`;
      queryParams.push(confidenceLevels as any);
    }
  } else {
    // v3 mode: Interface quality filtering - all data
    if (confidenceLevels.length > 0) {
      // Check if "AF2" is in the confidence filter
      const includeAF2 = confidenceLevels.includes('AF2');
      // Remove "AF2" from the array (it's not a database enum value)
      const dbConfidenceLevels = confidenceLevels.filter((c: string) => c !== 'AF2');

      if (dbConfidenceLevels.length > 0 && includeAF2) {
        // Both AF3 confidence levels AND AF2 requested
        const confidenceParamNum = queryParams.length + 1;
        query += ` AND (i.confidence = ANY($${confidenceParamNum}) OR (i.alphafold_version = 'AF2' AND i.confidence IS NULL))`;
        queryParams.push(dbConfidenceLevels as any);
      } else if (dbConfidenceLevels.length > 0) {
        // Only AF3 confidence levels (no AF2)
        const confidenceParamNum = queryParams.length + 1;
        query += ` AND i.confidence = ANY($${confidenceParamNum})`;
        queryParams.push(dbConfidenceLevels as any);
      } else if (includeAF2) {
        // Only AF2 requested
        query += ` AND i.alphafold_version = 'AF2' AND i.confidence IS NULL`;
      }
    }
  }

  // Different sorting logic based on mode
  if (filterMode === 'ipsae') {
    // ipSAE mode: Sort by ipSAE confidence tier, then ipSAE score
    query += ` ORDER BY
      CASE i.ipsae_confidence
        WHEN 'High' THEN 1
        WHEN 'Medium' THEN 2
        WHEN 'Low' THEN 3
        ELSE 4
      END,
      i.ipsae DESC NULLS LAST,
      i.iptm DESC`;
  } else {
    // v3 mode: Interface quality sorting
    query += ` ORDER BY
      -- AF3 first, AF2 last
      CASE WHEN i.alphafold_version = 'AF3' THEN 1 ELSE 2 END,
      -- New confidence classification for AF3
      CASE
        -- High: iPTM ≥ 0.7 OR (contacts ≥ 40 AND ipLDDT ≥ 80) OR (contacts ≥ 30 AND iPTM ≥ 0.5 AND ipLDDT ≥ 80)
        -- BUT exclude if iPTM < 0.75 AND contacts < 5
        WHEN i.alphafold_version = 'AF3' AND (
          i.iptm >= 0.7 OR
          (i.contacts_pae_lt_3 >= 40 AND i.interface_plddt >= 80) OR
          (i.contacts_pae_lt_3 >= 30 AND i.iptm >= 0.5 AND i.interface_plddt >= 80)
        ) AND NOT (i.iptm < 0.75 AND COALESCE(i.contacts_pae_lt_3, 0) < 5) THEN 1
        -- Medium: iPTM ≥ 0.6 OR (contacts ≥ 20 AND ipLDDT ≥ 75) OR (contacts ≥ 15 AND iPTM ≥ 0.45)
        WHEN i.alphafold_version = 'AF3' AND (
          i.iptm >= 0.6 OR
          (i.contacts_pae_lt_3 >= 20 AND i.interface_plddt >= 75) OR
          (i.contacts_pae_lt_3 >= 15 AND i.iptm >= 0.45)
        ) THEN 2
        -- Low: Everything else
        WHEN i.alphafold_version = 'AF3' THEN 3
        -- AF2: No confidence tiers, just sort by iPTM
        ELSE 4
      END,
      -- Within each tier, sort by contacts (for AF3) and iPTM
      COALESCE(i.contacts_pae_lt_3, 0) DESC,
      i.iptm DESC`;
  }

  try {
    // Debug: Check if protein_aliases table exists
    let debugInfo: any = {};
    try {
      const tableCheck = await client.query("SELECT COUNT(*) FROM protein_aliases");
      debugInfo.aliasCount = tableCheck.rows[0].count;
    } catch (e: any) {
      debugInfo.aliasTableError = e.message;
    }

    const { rows } = await client.query(query, queryParams);

    return NextResponse.json({
      interactions: rows,
      debug: debugInfo,
      searchTerm: params.id,
      filterMode: filterMode,
      confidenceLevels: confidenceLevels
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({
      error: 'Failed to fetch interactions',
      details: error.message,
      query: query,
      params: queryParams
    }, { status: 500 });
  } finally {
    await client.release();
  }
}

import { db } from '@vercel/postgres';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/complex-interactions/[id]
 *
 * Fetches interactions for a specific protein complex.
 * Supports confidence level filtering and v3/v4 mode switching.
 *
 * URL Parameters:
 *   id - Complex name (e.g., "IFT74_IFT81")
 *
 * Query Parameters:
 *   confidence - Comma-separated list of confidence levels to include
 *                (e.g., "Very High Confidence,Worth Investigating")
 *   mode       - Analysis mode: 'v3' (default) or 'ipsae' (v4)
 *
 * Response format:
 * {
 *   complex: {
 *     id: 1,
 *     complex_name: "IFT74_IFT81",
 *     display_name: "IFT74 & IFT81",
 *     proteins: [...]
 *   },
 *   interactions: [
 *     {
 *       prey_uniprot: "Q9H7X7",
 *       prey_gene: "IFT22",
 *       iptm: 0.38,
 *       contacts_pae_lt_3: 0,
 *       contacts_pae_lt_6: 39,
 *       interface_plddt: 82.5,
 *       confidence: "Low iPTM - Proceed with Caution",
 *       ipsae: 0.751,                    // v4 only
 *       ipsae_confidence: "High",         // v4 only
 *       analysis_version: "v4",           // v4 only
 *       per_chain_plddt: { "A": {...}, "B": {...}, "C": {...} }
 *     }
 *   ]
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const client = await db.connect();
  const complexIdentifier = params.id;

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const confidenceParam = searchParams.get('confidence');
    const mode = searchParams.get('mode') || 'v3';
    const confidenceLevels = confidenceParam
      ? confidenceParam.split(',').map((c) => c.trim())
      : [];

    // Get complex information
    const { rows: complexRows } = await client.query(
      `
      SELECT
        pc.id,
        pc.complex_name,
        pc.display_name,
        pc.num_proteins,
        pc.description
      FROM protein_complexes pc
      WHERE pc.complex_name = $1 OR pc.id::text = $1
      LIMIT 1
      `,
      [complexIdentifier]
    );

    if (complexRows.length === 0) {
      return NextResponse.json(
        { error: 'Complex not found' },
        { status: 404 }
      );
    }

    const complex = complexRows[0];

    // Get complex component proteins
    const { rows: proteins } = await client.query(
      `
      SELECT
        p.uniprot_id,
        p.gene_name,
        p.organism,
        p.organism_code,
        p.common_name,
        cp.chain_id,
        cp.position
      FROM complex_proteins cp
      JOIN proteins p ON cp.protein_id = p.id
      WHERE cp.complex_id = $1
      ORDER BY cp.position ASC
      `,
      [complex.id]
    );

    // Build query for interactions
    // For network visualization, we need to provide bait fields (the complex info)
    let interactionsQuery = `
      SELECT
        ci.id,
        ci.iptm,
        ci.contacts_pae_lt_3,
        ci.contacts_pae_lt_6,
        ci.interface_plddt,
        ci.confidence,
        ci.alphafold_version,
        ci.source_path,
        ci.per_chain_plddt,
        ci.ranking_score,
        ci.ptm,
        ci.mean_plddt,
        ci.interface_residue_count,
        ci.ipsae,
        ci.ipsae_confidence,
        ci.ipsae_pae_cutoff,
        ci.analysis_version,
        ci.experimental_validation,
        pc.complex_name as bait_uniprot,
        pc.display_name as bait_gene,
        pc.display_name as bait_common_name,
        NULL as bait_organism,
        NULL as bait_organism_code,
        prey.uniprot_id as prey_uniprot,
        prey.gene_name as prey_gene,
        prey.organism as prey_organism,
        prey.organism_code as prey_organism_code,
        prey.common_name as prey_common_name
      FROM complex_interactions ci
      JOIN protein_complexes pc ON ci.bait_complex_id = pc.id
      JOIN proteins prey ON ci.prey_protein_id = prey.id
      WHERE ci.bait_complex_id = $1
    `;

    const queryParams: any[] = [complex.id];

    // v4 mode: ONLY show interactions with ipSAE scores
    if (mode === 'ipsae') {
      interactionsQuery += ` AND ci.ipsae IS NOT NULL AND ci.analysis_version = 'v4'`;
    }

    // Add confidence filter if provided
    // ONLY filter server-side in v4 (ipSAE) mode
    // v3 mode filtering is done client-side to support dynamic confidence calculation
    if (confidenceLevels.length > 0 && mode === 'ipsae') {
      // For v4 mode, filter by ipsae_confidence (accurate server-side filtering)
      interactionsQuery += ` AND ci.ipsae_confidence = ANY($${queryParams.length + 1})`;
      queryParams.push(confidenceLevels);
    }

    // Sort by analysis version (v4 first), confidence, then metrics
    if (mode === 'ipsae') {
      // v4 mode: Sort by ipSAE score (descending)
      interactionsQuery += `
        ORDER BY
          ci.ipsae DESC NULLS LAST,
          ci.contacts_pae_lt_6 DESC,
          ci.iptm DESC
      `;
    } else {
      // v3 mode: Sort by confidence tier, then contacts, then iPTM
      interactionsQuery += `
        ORDER BY
          CASE ci.confidence
            WHEN 'Very High Confidence' THEN 4
            WHEN 'Worth Investigating' THEN 3
            WHEN 'Low iPTM - Proceed with Caution' THEN 2
            ELSE 1
          END DESC,
          ci.contacts_pae_lt_6 DESC,
          ci.iptm DESC
      `;
    }

    const { rows: interactions } = await client.query(
      interactionsQuery,
      queryParams
    );

    return NextResponse.json({
      complex: {
        ...complex,
        proteins,
      },
      interactions,
      count: interactions.length,
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch complex interactions',
        details: error.message,
      },
      { status: 500 }
    );
  } finally {
    await client.release();
  }
}

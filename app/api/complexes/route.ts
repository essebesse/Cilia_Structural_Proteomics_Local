import { db } from '@vercel/postgres';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/complexes
 *
 * Returns all protein complexes with their component proteins and interaction counts.
 * Used to populate the complex dropdown in the UI.
 * Supports mode filtering to show v3 or v4 interaction counts.
 *
 * Query Parameters:
 *   mode - Analysis mode: 'v3' (default) or 'ipsae' (v4)
 *
 * Response format:
 * {
 *   complexes: [
 *     {
 *       id: 1,
 *       complex_name: "IFT74_IFT81",
 *       display_name: "IFT74 & IFT81",
 *       num_proteins: 2,
 *       interaction_count: 14,
 *       proteins: [
 *         { uniprot_id: "Q96LB3", gene_name: "IFT74", chain_id: "A", position: 0 },
 *         { uniprot_id: "Q8WYA0", gene_name: "IFT81", chain_id: "B", position: 1 }
 *       ]
 *     }
 *   ],
 *   count: 1,
 *   mode: "v3"
 * }
 *
 * Updated: 2025-10-16 - Added IFT46 & IFT52 complex
 * Updated: 2025-10-23 - Added mode parameter for v3/v4 filtering
 * Updated: 2025-10-30 - Added variant support (FL/Cterm/Nterm)
 */
export async function GET(request: NextRequest) {
  const client = await db.connect();

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'v3';

    // Build query for complexes with interaction counts
    let complexQuery = `
      SELECT
        pc.id,
        pc.complex_name,
        pc.display_name,
        pc.num_proteins,
        pc.created_at,
        COUNT(ci.id) as interaction_count
      FROM protein_complexes pc
      LEFT JOIN complex_interactions ci ON pc.id = ci.bait_complex_id
    `;

    // In v4 (ipSAE) mode, only count interactions with ipSAE scores
    if (mode === 'ipsae') {
      complexQuery += ` AND ci.ipsae IS NOT NULL AND ci.analysis_version = 'v4'`;
    }

    complexQuery += `
      GROUP BY pc.id, pc.complex_name, pc.display_name, pc.num_proteins, pc.created_at
      ORDER BY pc.display_name ASC
    `;

    const { rows: complexes } = await client.query(complexQuery);

    // For each complex, get its component proteins
    const complexesWithProteins = await Promise.all(
      complexes.map(async (complex) => {
        const { rows: proteins } = await client.query(
          `
          SELECT
            p.uniprot_id,
            p.gene_name,
            p.organism,
            p.organism_code,
            p.common_name,
            cp.chain_id,
            cp.position,
            cp.role
          FROM complex_proteins cp
          JOIN proteins p ON cp.protein_id = p.id
          WHERE cp.complex_id = $1
          ORDER BY cp.position ASC
          `,
          [complex.id]
        );

        return {
          ...complex,
          proteins,
        };
      })
    );

    return NextResponse.json({
      complexes: complexesWithProteins,
      count: complexesWithProteins.length,
      mode: mode
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch protein complexes',
        details: error.message,
      },
      { status: 500 }
    );
  } finally {
    await client.release();
  }
}

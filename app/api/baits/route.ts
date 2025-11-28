import { db } from '@vercel/postgres';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/baits
 *
 * Returns all bait proteins with interaction counts.
 * Supports mode filtering to show v3 or v4 interaction counts.
 *
 * Query Parameters:
 *   mode - Analysis mode: 'v3' (default) or 'ipsae' (v4)
 *
 * Response format:
 * {
 *   baits: [
 *     { uniprot_id: "Q8NEZ3", gene_name: "WDR19", organism: "Homo sapiens", organism_code: "Hs", interaction_count: 45 }
 *   ],
 *   count: 1,
 *   mode: "v3"
 * }
 */
export async function GET(request: NextRequest) {
  const client = await db.connect();

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'v3';

    let query = `
      SELECT DISTINCT
        bait.uniprot_id,
        bait.gene_name,
        bait.organism,
        bait.organism_code,
        COUNT(i.id) as interaction_count
      FROM interactions i
      JOIN proteins bait ON i.bait_protein_id = bait.id
    `;

    // In v4 (ipSAE) mode, only count interactions with ipSAE scores
    if (mode === 'ipsae') {
      query += ` WHERE i.ipsae IS NOT NULL AND i.analysis_version = 'v4'`;
    }

    query += `
      GROUP BY bait.uniprot_id, bait.gene_name, bait.organism, bait.organism_code
      HAVING COUNT(i.id) > 0
      ORDER BY bait.gene_name ASC, bait.uniprot_id ASC
    `;

    const { rows } = await client.query(query);

    return NextResponse.json({
      baits: rows,
      count: rows.length,
      mode: mode
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({
      error: 'Failed to fetch bait proteins',
      details: error.message
    }, { status: 500 });
  } finally {
    await client.release();
  }
}
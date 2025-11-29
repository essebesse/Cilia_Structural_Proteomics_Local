/**
 * API Route: Serve CIF Structure Files (Local Deployment)
 * =========================================================
 *
 * Returns the CIF file for a given interaction ID from local filesystem.
 *
 * Usage: GET /api/structure/123
 *
 * Data source: Local structures/ directory with UniProt-based naming
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import fs from 'fs';
import path from 'path';

// Force dynamic rendering (no static generation)
export const dynamic = 'force-dynamic';

interface CifManifestEntry {
  id: number;
  bait_uniprot: string;
  prey_uniprot: string;
  bait_gene: string;
  prey_gene: string;
  status: string;
  cif_path?: string;
}

interface CifManifest {
  entries: Record<string, CifManifestEntry>;
}

// Load manifest once (cached)
let manifest: CifManifest | null = null;

async function loadManifest(): Promise<CifManifest> {
  if (manifest) return manifest;

  const manifestPath = path.join(process.cwd(), 'cif_manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('CIF manifest not found');
  }

  const data = await readFile(manifestPath, 'utf8');
  manifest = JSON.parse(data);
  return manifest;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const interactionId = resolvedParams.id;
    const { searchParams } = new URL(request.url);
    const isDownload = searchParams.get('download') === 'true';

    // Load manifest to get CIF file path
    const manifest = await loadManifest();
    const entry = manifest.entries[interactionId];

    if (!entry) {
      return NextResponse.json(
        { error: 'Interaction not found', id: interactionId },
        { status: 404 }
      );
    }

    // Check if CIF file exists for this interaction
    if (entry.status !== 'found' || !entry.cif_path) {
      return NextResponse.json(
        {
          error: 'CIF file not available for this interaction',
          id: interactionId,
          status: entry.status
        },
        { status: 404 }
      );
    }

    // Construct local file path
    // CIF files are in structures/ directory at project root
    const cifFilename = `${entry.bait_uniprot.toLowerCase()}_and_${entry.prey_uniprot.toLowerCase()}.cif`;
    const cifPath = path.join(process.cwd(), 'structures', cifFilename);

    // Check if file exists
    if (!fs.existsSync(cifPath)) {
      return NextResponse.json(
        {
          error: 'CIF file not found on filesystem',
          id: interactionId,
          filename: cifFilename,
          path: cifPath
        },
        { status: 404 }
      );
    }

    // Read the CIF file
    const cifContent = await readFile(cifPath, 'utf8');

    return new NextResponse(cifContent, {
      status: 200,
      headers: {
        'Content-Type': 'chemical/x-cif',
        'Content-Disposition': isDownload
          ? `attachment; filename="${entry.bait_gene}_${entry.prey_gene}.cif"`
          : `inline; filename="${cifFilename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });

  } catch (error) {
    console.error('Error serving CIF file:', error);

    return NextResponse.json(
      {
        error: 'Failed to load structure',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

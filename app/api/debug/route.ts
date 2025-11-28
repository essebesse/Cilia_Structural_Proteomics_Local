import { db } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Check if POSTGRES_URL is available
    if (!process.env.POSTGRES_URL) {
      return NextResponse.json({
        error: 'POSTGRES_URL environment variable not set',
        hasUrl: false
      }, { status: 500 });
    }

    const client = await db.connect();

    try {
      // Test basic connection
      const testQuery = await client.query('SELECT NOW() as current_time');

      // Check if tables exist
      const tablesQuery = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `);

      // Check proteins count
      const proteinCount = await client.query('SELECT COUNT(*) FROM proteins');

      // Check interactions count and columns
      const interactionCount = await client.query('SELECT COUNT(*) FROM interactions');

      const columnsQuery = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'interactions'
      `);

      // Test a simple query
      const sampleProteins = await client.query('SELECT uniprot_id FROM proteins LIMIT 3');

      return NextResponse.json({
        success: true,
        hasUrl: true,
        currentTime: testQuery.rows[0].current_time,
        tables: tablesQuery.rows.map(r => r.table_name),
        proteinCount: proteinCount.rows[0].count,
        interactionCount: interactionCount.rows[0].count,
        interactionColumns: columnsQuery.rows.map(r => r.column_name),
        sampleProteins: sampleProteins.rows,
        urlLastChars: process.env.POSTGRES_URL.slice(-10)
      });

    } finally {
      await client.release();
    }

  } catch (error) {
    return NextResponse.json({
      error: error.message,
      hasUrl: !!process.env.POSTGRES_URL,
      urlLastChars: process.env.POSTGRES_URL ? process.env.POSTGRES_URL.slice(-10) : 'none'
    }, { status: 500 });
  }
}
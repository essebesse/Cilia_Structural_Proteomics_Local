'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Spinner } from 'react-bootstrap';

// Dynamically import StructureViewer
const StructureViewer = dynamic(() => import('../../../components/StructureViewer'), {
  ssr: false,
  loading: () => <div className="text-center p-5"><Spinner animation="border" /> Loading structure viewer...</div>
});

interface InteractionInfo {
  baitGene: string;
  preyGene: string;
}

// Calculate safe canvas dimensions based on screen size and memory constraints
function calculateSafeCanvasDimensions() {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 };

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  // Target container size: 95% of viewport
  let containerWidth = Math.floor(screenWidth * 0.95);
  let containerHeight = Math.floor(screenHeight * 0.95);

  // Calculate actual canvas pixels (considering devicePixelRatio)
  const canvasPixelWidth = containerWidth * dpr;
  const canvasPixelHeight = containerHeight * dpr;
  const totalPixels = canvasPixelWidth * canvasPixelHeight;

  // Safe limit: ~20 million pixels (balances quality and memory)
  // 1080p @ 2x = 3840x2160 = 8.3M pixels (no scaling needed)
  // 4K @ 1x = 3840x2160 = 8.3M pixels (no scaling needed)
  // 5K @ 1x = 5120x2880 = 14.7M pixels (no scaling needed)
  // 4K @ 2x = 7680x4320 = 33M pixels (scales down to 20M)
  // 5K @ 2x = 10240x5760 = 59M pixels (scales down to 20M)
  const SAFE_PIXEL_LIMIT = 20_000_000;

  if (totalPixels > SAFE_PIXEL_LIMIT) {
    // Scale down proportionally to stay within limit
    const scale = Math.sqrt(SAFE_PIXEL_LIMIT / totalPixels);
    containerWidth = Math.floor(containerWidth * scale);
    containerHeight = Math.floor(containerHeight * scale);

    console.log(`Canvas scaled down from ${canvasPixelWidth}x${canvasPixelHeight} to ${containerWidth * dpr}x${containerHeight * dpr} pixels`);
  }

  console.log(`Screen: ${screenWidth}x${screenHeight}, DPR: ${dpr}, Container: ${containerWidth}x${containerHeight}, Canvas pixels: ${containerWidth * dpr}x${containerHeight * dpr}`);

  return { width: containerWidth, height: containerHeight };
}

export default function StructurePage() {
  const params = useParams();
  const id = params.id as string;
  const [info, setInfo] = useState<InteractionInfo | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });

  // Calculate safe dimensions on mount
  useEffect(() => {
    const dims = calculateSafeCanvasDimensions();
    setDimensions(dims);

    // Recalculate on window resize
    const handleResize = () => {
      const newDims = calculateSafeCanvasDimensions();
      setDimensions(newDims);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!id) return;

    // Fetch interaction info from manifest
    fetch('/cif_manifest.json')
      .then(res => res.json())
      .then(data => {
        const entry = data.entries[id];
        if (entry) {
          setInfo({
            baitGene: entry.bait_gene || 'Unknown',
            preyGene: entry.prey_gene || 'Unknown'
          });
        }
      })
      .catch(err => console.error('Failed to load interaction info:', err));
  }, [id]);

  if (!info) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      overflow: 'auto',
      background: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        display: 'flex',
        flexDirection: 'column'
      }}>
        <StructureViewer
          interactionId={parseInt(id)}
          baitGene={info.baitGene}
          preyGene={info.preyGene}
          onClose={() => window.close()}
          closeButtonText="✕ Close Window"
        />
      </div>
    </div>
  );
}

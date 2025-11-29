'use client';

/**
 * Structure Viewer Component
 * ===========================
 *
 * 3D structure visualization using Mol* (Molstar) with optional PAE-based interface coloring.
 *
 * Features:
 * - Load CIF files from API
 * - Toggle PAE interface highlighting (off by default):
 *   - Yellow: High precision contacts (PAE <3Å)
 *   - Magenta: Moderate precision contacts (PAE 3-6Å)
 * - Distinct chain colors for protein visualization
 * - Interactive camera controls
 * - Loading states and error handling
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec';
import { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import { Color } from 'molstar/lib/mol-util/color';
import { Script } from 'molstar/lib/mol-script/script';
import { StructureSelection } from 'molstar/lib/mol-model/structure';
import { setStructureOverpaint, clearStructureOverpaint } from 'molstar/lib/mol-plugin-state/helpers/structure-overpaint';
import 'molstar/lib/mol-plugin-ui/skin/light.scss';

interface Contact {
  chain1: string;
  resi1: number;
  aa1: string;
  chain2: string;
  resi2: number;
  aa2: string;
  pae: number;
  distance: number;
  confidence: string;
  color: string;
}

interface ContactData {
  interaction_id: number;
  generated_at: string;
  data: {
    chains: string[];
    chain_lengths: Record<string, number>;
    contacts: Contact[];
    summary: {
      total_contacts: number;
      very_high_count: number;
      high_count: number;
      medium_count: number;
      low_count: number;
    };
  };
}

interface StructureViewerProps {
  interactionId: number;
  baitGene: string;
  preyGene: string;
  onClose: () => void;
  closeButtonText?: string;
}

export default function StructureViewer({
  interactionId,
  baitGene,
  preyGene,
  onClose,
  closeButtonText = '← Back to Network'
}: StructureViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactData, setContactData] = useState<ContactData | null>(null);
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [pluginReady, setPluginReady] = useState(false);
  const [paeHighlightEnabled, setPaeHighlightEnabled] = useState(false);

  // Initialize Mol* plugin
  useEffect(() => {
    if (!containerRef.current || pluginRef.current) return;

    const initPlugin = async () => {
      try {
        console.log('### INITIALIZING MOLSTAR PLUGIN ###');
        if (!containerRef.current) return;

        // Custom spec to disable external network calls
        const customSpec = DefaultPluginUISpec();

        console.log('Filtering behaviors to remove external calls...');
        // Disable all external behaviors and validation
        customSpec.behaviors = customSpec.behaviors.filter(b =>
          b.transformer.definition.name !== 'rcsb-assembly-symmetry' &&
          b.transformer.definition.name !== 'pdbe-structure-quality-report'
        );

        console.log('Creating Molstar UI...');
        const plugin = await createPluginUI({
          target: containerRef.current,
          render: renderReact18,
          spec: customSpec
        });

        console.log('✓ Molstar plugin initialized successfully!');
        pluginRef.current = plugin;
        setPluginReady(true);

      } catch (err) {
        console.error('!!! Failed to initialize Mol*:', err);
        setError('Failed to initialize 3D viewer');
        setLoading(false);
      }
    };

    initPlugin();

    return () => {
      if (pluginRef.current) {
        pluginRef.current.dispose();
        pluginRef.current = null;
      }
    };
  }, []);

  // Load structure and contact data
  useEffect(() => {
    console.log('Structure loading useEffect triggered, interactionId:', interactionId);
    console.log('Plugin ready?', pluginReady);
    console.log('Plugin ref exists?', !!pluginRef.current);

    if (!pluginReady || !pluginRef.current) {
      console.log('⚠️ Plugin not ready, skipping structure load');
      return;
    }

    const loadStructure = async () => {
      console.log('=== STARTING STRUCTURE LOAD ===');
      console.log('Interaction ID:', interactionId);

      setLoading(true);
      setError(null);
      setStructureLoaded(false);
      setContactData(null);
      setPaeHighlightEnabled(false); // Reset PAE state when loading new structure

      try {
        const plugin = pluginRef.current!;

        // Clear any existing structures
        console.log('Clearing existing structures...');
        await plugin.clear();

        // Fetch PAE contact data
        console.log('Fetching PAE data from:', `/api/structure/${interactionId}/pae`);
        const paeResponse = await fetch(`/api/structure/${interactionId}/pae`);
        let paeData: ContactData | null = null;
        console.log('PAE response status:', paeResponse.status, 'ok:', paeResponse.ok);
        if (paeResponse.ok) {
          paeData = await paeResponse.json();
          setContactData(paeData);
          console.log('✓ PAE data loaded successfully:', paeData.data.summary);
        } else {
          const errorText = await paeResponse.text();
          console.warn('⚠️ PAE contact data not available:', paeResponse.status, errorText);
        }

        // Load structure into Mol*
        console.log('Fetching CIF from:', `/api/structure/${interactionId}`);
        const data = await plugin.builders.data.download(
          { url: `/api/structure/${interactionId}`, isBinary: false },
          { state: { isGhost: false } }
        );
        console.log('CIF data downloaded, parsing...');

        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');

        // Apply default preset (chains will get default colors)
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');

        setStructureLoaded(true);
        setLoading(false);

      } catch (err) {
        console.error('Error loading structure:', err);
        setError(err instanceof Error ? err.message : 'Failed to load structure');
        setLoading(false);
      }
    };

    loadStructure();
  }, [interactionId, pluginReady]);

  // Toggle PAE highlighting on/off
  const togglePAEHighlight = async () => {
    if (!pluginRef.current || !structureLoaded) return;

    const plugin = pluginRef.current;
    const structures = plugin.managers.structure.hierarchy.current.structures;

    if (structures.length === 0) return;

    try {
      if (paeHighlightEnabled) {
        // Turn OFF: Clear PAE highlighting
        console.log('Clearing PAE highlighting...');
        await clearStructureOverpaint(plugin, structures[0].components);
        setPaeHighlightEnabled(false);
      } else {
        // Turn ON: Apply PAE highlighting
        if (contactData) {
          console.log('Applying PAE highlighting...');
          await applyPAEColoring(plugin, contactData);
          setPaeHighlightEnabled(true);
        }
      }
    } catch (err) {
      console.error('Error toggling PAE highlight:', err);
    }
  };

  // Apply PAE-based coloring to structure
  const applyPAEColoring = async (plugin: PluginUIContext, contactData: ContactData) => {
    try {
      console.log('=== Starting PAE interface highlighting ===');
      console.log('Contact data:', contactData.data.summary);

      // Get the structure
      const structures = plugin.managers.structure.hierarchy.current.structures;
      console.log('Found structures:', structures.length);

      if (structures.length === 0) {
        console.warn('No structure found for PAE highlighting');
        return;
      }

      const structure = structures[0];
      const structureData = structure.cell.obj?.data;
      if (!structureData) {
        console.warn('No structure data found');
        return;
      }

      // Separate residues by PAE confidence tiers
      const veryHighConfidence = new Set<string>(); // PAE <3Å
      const highConfidence = new Set<string>();     // PAE 3-6Å

      for (const contact of contactData.data.contacts) {
        if (contact.pae < 3) {
          veryHighConfidence.add(`${contact.chain1}:${contact.resi1}`);
          veryHighConfidence.add(`${contact.chain2}:${contact.resi2}`);
        } else if (contact.pae < 6) {
          highConfidence.add(`${contact.chain1}:${contact.resi1}`);
          highConfidence.add(`${contact.chain2}:${contact.resi2}`);
        }
      }

      console.log(`PAE <3Å (Very High): ${veryHighConfidence.size} residues`);
      console.log(`PAE 3-6Å (High): ${highConfidence.size} residues`);

      // Helper function to create selection from residue set
      const createSelection = (residues: Set<string>) => {
        const residueArray = Array.from(residues).map(key => {
          const [chain, resi] = key.split(':');
          return { chain, resi: parseInt(resi) };
        });

        return Script.getStructureSelection(
          Q => Q.struct.generator.atomGroups({
            'residue-test': Q.core.logic.or(
              residueArray.map(r =>
                Q.core.logic.and([
                  Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_asym_id(), r.chain]),
                  Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_seq_id(), r.resi])
                ])
              )
            )
          }),
          structureData
        );
      };

      // Apply very high confidence (PAE <3Å) in bright yellow
      if (veryHighConfidence.size > 0) {
        const selection = createSelection(veryHighConfidence);
        await setStructureOverpaint(
          plugin,
          structure.components,
          Color(0xFFFF00),  // Bright yellow
          async () => StructureSelection.toLociWithSourceUnits(selection)
        );
        console.log(`✓ Highlighted ${veryHighConfidence.size} residues (PAE <3Å) in yellow`);
      }

      // Apply high confidence (PAE 3-6Å) in bright magenta
      if (highConfidence.size > 0) {
        const selection = createSelection(highConfidence);
        await setStructureOverpaint(
          plugin,
          structure.components,
          Color(0xFF00FF),  // Bright magenta
          async () => StructureSelection.toLociWithSourceUnits(selection)
        );
        console.log(`✓ Highlighted ${highConfidence.size} residues (PAE 3-6Å) in magenta`);
      }

      console.log('✓ PAE interface highlighting complete!');

    } catch (err) {
      console.error('!!! Error applying PAE highlighting:', err);
    }
  };

  return (
    <div className="structure-viewer-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '15px' }}>
      {/* Header */}
      <div className="structure-viewer-header" style={{ flexShrink: 0 }}>
        <div className="header-left">
          <h5 className="mb-0 d-inline-block">
            3D Structure: {baitGene} ↔ {preyGene}
          </h5>
          {structureLoaded && contactData && (
            <>
              <button
                onClick={togglePAEHighlight}
                className={`btn btn-sm ms-3 ${paeHighlightEnabled ? 'btn-success' : 'btn-outline-secondary'}`}
                style={{ verticalAlign: 'middle' }}
              >
                {paeHighlightEnabled ? '✓ PAE Interface ON' : 'Show PAE Interface'}
              </button>
              {paeHighlightEnabled && (
                <span className="pae-legend ms-3" style={{ verticalAlign: 'middle' }}>
                  <span className="legend-item">
                    <span className="color-dot" style={{ backgroundColor: '#FFFF00' }}></span>
                    High precision contacts (PAE &lt;3Å)
                  </span>
                  <span className="legend-item ms-2">
                    <span className="color-dot" style={{ backgroundColor: '#FF00FF' }}></span>
                    Moderate precision contacts (PAE 3-6Å)
                  </span>
                </span>
              )}
            </>
          )}
          {structureLoaded && !contactData && (
            <span className="text-muted small ms-3" style={{ verticalAlign: 'middle' }}>
              (PAE data not available)
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="btn btn-sm btn-secondary"
        >
          {closeButtonText}
        </button>
      </div>

      {/* Contact Summary */}
      {structureLoaded && contactData && (
        <div className="contact-info mb-3" style={{ flexShrink: 0 }}>
          <small className="text-muted">
            Interface contacts: {contactData.data.summary.total_contacts}
            {' '}• Very High: {contactData.data.summary.very_high_count}
            {' '}• High: {contactData.data.summary.high_count}
            {' '}• Medium: {contactData.data.summary.medium_count}
            {' '}• Low: {contactData.data.summary.low_count}
          </small>
        </div>
      )}

      {/* Mol* Viewer Container */}
      <div
        ref={containerRef}
        className="molstar-container"
        style={{
          width: '100%',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          border: '1px solid #ddd',
          borderRadius: '4px'
        }}
      />

      {/* Loading State */}
      {loading && (
        <div className="structure-loading">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading structure...</span>
          </div>
          <p className="mt-2">Loading 3D structure...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="alert alert-danger mt-3" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      <style jsx>{`
        .structure-viewer-container {
          padding: 20px;
        }

        .structure-viewer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid #e0e0e0;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .pae-legend {
          font-size: 0.85rem;
          color: #666;
        }

        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .color-dot {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1px solid #666;
        }

        .contact-info {
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 4px;
          border-left: 3px solid #007bff;
        }

        .molstar-container {
          background: #f8f9fa;
        }

        .structure-loading {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 1000;
        }
      `}</style>
    </div>
  );
}

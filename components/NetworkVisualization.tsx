'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface ProteinNode {
  id: string;
  name: string;
  uniprot: string;
  gene: string;
  group: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface InteractionLink {
  source: string | ProteinNode;
  target: string | ProteinNode;
  confidence: string | null;
  iptm: number;
  contacts_pae_lt_3?: number;
  contacts_pae_lt_6?: number;
  interface_plddt?: number;
  alphafold_version: string;
}

interface NetworkVisualizationProps {
  interactions: any[];
  width?: number;
  height?: number;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  title?: string;
  centerProtein?: string;
  layout?: 'force' | 'radial';
  showLayoutControl?: boolean;
  onLayoutChange?: (layout: 'force' | 'radial') => void;
  legendType?: 'nodes' | 'edges' | 'both';
}

export const NetworkVisualization: React.FC<NetworkVisualizationProps> = ({
  interactions,
  width = 800,
  height = 600,
  onNodeClick,
  title,
  centerProtein,
  layout = 'force',
  showLayoutControl = false,
  onLayoutChange,
  legendType = 'both'
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);

  // Helper function to shorten long protein names
  const shortenProteinName = (name: string, maxLength: number = 15): string => {
    if (!name || name.length <= maxLength) return name;

    // If it contains parentheses with homolog info, prioritize the main name
    const parenMatch = name.match(/^(.+?)\s*\(/);
    if (parenMatch && parenMatch[1].length <= maxLength) {
      return parenMatch[1];
    }

    // For long names, truncate with ellipsis
    return name.substring(0, maxLength - 3) + '...';
  };

  // Transform interaction data to D3 format
  const prepareNetworkData = () => {
    const nodesMap = new Map<string, ProteinNode>();
    const links: InteractionLink[] = [];
    const organismCounts = new Map<string, number>();

    // First pass: count organisms
    interactions.forEach((inter) => {
      const baitOrg = inter.bait_organism_code;
      const preyOrg = inter.prey_organism_code;

      if (baitOrg) {
        organismCounts.set(baitOrg, (organismCounts.get(baitOrg) || 0) + 1);
      }
      if (preyOrg) {
        organismCounts.set(preyOrg, (organismCounts.get(preyOrg) || 0) + 1);
      }
    });

    // Find predominant organism (if >70% of proteins are from one organism)
    let predominantOrganism: string | null = null;
    const totalProteins = Array.from(organismCounts.values()).reduce((a, b) => a + b, 0);

    Array.from(organismCounts.entries()).forEach(([org, count]) => {
      if (!predominantOrganism && count / totalProteins > 0.7) {
        predominantOrganism = org;
      }
    });

    // Helper function to get best protein name
    const getProteinDisplayName = (inter: any, type: 'bait' | 'prey') => {
      const commonName = inter[`${type}_common_name`];
      const geneName = inter[`${type}_gene`];
      const organismCode = inter[`${type}_organism_code`];

      let displayName = commonName || geneName;

      // Shorten long names
      displayName = shortenProteinName(displayName);

      // Only show organism prefix if it differs from predominant organism
      if (organismCode && predominantOrganism && organismCode !== predominantOrganism) {
        return `${organismCode}:${displayName}`;
      }

      return displayName;
    };

    interactions.forEach((inter) => {
      // Add bait protein
      if (!nodesMap.has(inter.bait_uniprot)) {
        nodesMap.set(inter.bait_uniprot, {
          id: inter.bait_uniprot,
          name: getProteinDisplayName(inter, 'bait'),
          uniprot: inter.bait_uniprot,
          gene: inter.bait_gene,
          group: 'bait'
        });
      }

      // Add prey protein
      if (!nodesMap.has(inter.prey_uniprot)) {
        nodesMap.set(inter.prey_uniprot, {
          id: inter.prey_uniprot,
          name: getProteinDisplayName(inter, 'prey'),
          uniprot: inter.prey_uniprot,
          gene: inter.prey_gene,
          group: 'prey'
        });
      }

      // Add link
      links.push({
        source: inter.bait_uniprot,
        target: inter.prey_uniprot,
        confidence: inter.confidence,
        iptm: inter.iptm,
        contacts_pae_lt_3: inter.contacts_pae_lt_3,
        contacts_pae_lt_6: inter.contacts_pae_lt_6,
        interface_plddt: inter.interface_plddt,
        alphafold_version: inter.alphafold_version
      });
    });

    return {
      nodes: Array.from(nodesMap.values()),
      links: links,
      predominantOrganism: predominantOrganism
    };
  };

  // Calculate dynamic confidence level
  const getConfidenceLevel = (interaction: InteractionLink): string => {
    if (interaction.alphafold_version === 'AF2') {
      return 'AF2';
    }

    // High: iPTM ≥ 0.7 OR (contacts ≥ 40 AND ipLDDT ≥ 80) OR (contacts ≥ 30 AND iPTM ≥ 0.5 AND ipLDDT ≥ 80)
    // BUT exclude if iPTM < 0.75 AND contacts < 5
    const meetsHighCriteria =
      interaction.iptm >= 0.7 ||
      ((interaction.contacts_pae_lt_3 ?? 0) >= 40 && (interaction.interface_plddt ?? 0) >= 80) ||
      ((interaction.contacts_pae_lt_3 ?? 0) >= 30 && interaction.iptm >= 0.5 && (interaction.interface_plddt ?? 0) >= 80);

    const isExcludedFromHigh = interaction.iptm < 0.75 && (interaction.contacts_pae_lt_3 ?? 0) < 5;

    if (meetsHighCriteria && !isExcludedFromHigh) {
      return 'High';
    }

    // Medium: iPTM ≥ 0.6 OR (contacts ≥ 20 AND ipLDDT ≥ 75) OR (contacts ≥ 15 AND iPTM ≥ 0.45)
    if (
      interaction.iptm >= 0.6 ||
      ((interaction.contacts_pae_lt_3 ?? 0) >= 20 && (interaction.interface_plddt ?? 0) >= 75) ||
      ((interaction.contacts_pae_lt_3 ?? 0) >= 15 && interaction.iptm >= 0.45)
    ) {
      return 'Medium';
    }

    return 'Low';
  };

  // Get link color based on confidence
  const getLinkColor = (interaction: InteractionLink) => {
    const level = getConfidenceLevel(interaction);

    switch (level) {
      case 'High':
        return '#28a745'; // Green
      case 'Medium':
        return '#f59e0b'; // Orange
      case 'Low':
        return '#dc3545'; // Red
      case 'AF2':
        return '#6b7280'; // Gray
      default:
        return '#6b7280'; // Gray
    }
  };

  // Get link width based on confidence
  const getLinkWidth = (interaction: InteractionLink) => {
    const level = getConfidenceLevel(interaction);

    switch (level) {
      case 'High':
        return 3;
      case 'Medium':
        return 2.5;
      case 'Low':
        return 2;
      case 'AF2':
        return interaction.iptm > 0.7 ? 2 : 1.5;
      default:
        return 1.5;
    }
  };

  const [predominantOrganism, setPredominantOrganism] = useState<string | null>(null);

  useEffect(() => {
    if (!svgRef.current || interactions.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous

    const { nodes, links, predominantOrganism: detectedOrganism } = prepareNetworkData();
    setPredominantOrganism(detectedOrganism);

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });

    svg.call(zoom);

    const container = svg.append('g');

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id((d: any) => d.id)
        .distance(80)
        .strength(0.5)
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('collision', d3.forceCollide().radius(25))
      .force('x', d3.forceX(width / 2).strength(0.3))
      .force('y', d3.forceY(height / 2).strength(0.3));

    // Apply layout-specific forces
    if (layout === 'radial') {
      simulation
        .force('radial', d3.forceRadial(150, width / 2, height / 2).strength(0.3))
        .force('x', d3.forceX(width / 2).strength(0.2))
        .force('y', d3.forceY(height / 2).strength(0.2));
    }

    // Create links
    const link = container.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter().append('line')
      .attr('stroke', d => getLinkColor(d))
      .attr('stroke-width', d => getLinkWidth(d))
      .attr('stroke-opacity', 0.7);

    // Create nodes
    const node = container.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes)
      .enter().append('circle')
      .attr('r', d => {
        if (centerProtein && d.id === centerProtein) return 15; // Larger for center protein
        return d.group === 'bait' ? 12 : 8;
      })
      .attr('fill', d => {
        if (centerProtein && d.id === centerProtein) return '#dc3545'; // Red for center protein
        return d.group === 'bait' ? '#8b5cf6' : '#10b981';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .call(d3.drag<SVGCircleElement, ProteinNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    // Add node labels
    const label = container.append('g')
      .attr('class', 'labels')
      .selectAll('text')
      .data(nodes)
      .enter().append('text')
      .text(d => d.name)
      .attr('font-size', 10)
      .attr('font-family', 'Arial, sans-serif')
      .attr('text-anchor', 'middle')
      .attr('dy', 25)
      .attr('fill', '#374151')
      .style('pointer-events', 'none');

    // Tooltip functions
    const showTooltip = (event: any, d: any) => {
      let content = '';
      if (d.group) {
        // Node tooltip
        const nodeLinks = links.filter(l =>
          (typeof l.source === 'object' ? l.source.id : l.source) === d.id ||
          (typeof l.target === 'object' ? l.target.id : l.target) === d.id
        );
        content = `
          <div style="font-weight: bold; margin-bottom: 5px;">${d.name} (${d.uniprot})</div>
          <div>Type: ${d.group === 'bait' ? 'Bait protein' : 'Prey protein'}</div>
          <div>Interactions: ${nodeLinks.length}</div>
        `;
      } else {
        // Link tooltip
        const confLevel = getConfidenceLevel(d);
        content = `
          <div style="font-weight: bold; margin-bottom: 5px;">Interaction</div>
          <div>Confidence: ${confLevel}</div>
          <div>iPTM: ${d.iptm.toFixed(3)}</div>
          <div>AlphaFold: ${d.alphafold_version}</div>
          ${d.contacts_pae_lt_3 !== undefined ? `<div>PAE &lt;3Å: ${d.contacts_pae_lt_3}</div>` : ''}
          ${d.interface_plddt ? `<div>ipLDDT: ${d.interface_plddt.toFixed(1)}</div>` : ''}
        `;
      }

      setTooltip({
        x: event.pageX + 10,
        y: event.pageY - 10,
        content
      });
    };

    const hideTooltip = () => {
      setTooltip(null);
    };

    // Add tooltip and click events
    node
      .on('mouseover', showTooltip)
      .on('mouseout', hideTooltip)
      .on('click', (event, d) => {
        if (onNodeClick && d.id !== centerProtein) {
          onNodeClick(d.id, d.name);
        }
      });

    link.on('mouseover', showTooltip).on('mouseout', hideTooltip);

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      label
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });

    // Center the network after simulation settles
    setTimeout(() => {
      const bounds = container.node()?.getBBox();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const scale = Math.min(width / bounds.width, height / bounds.height) * 0.7;
        const translateX = (width - bounds.width * scale) / 2 - bounds.x * scale;
        const translateY = (height - bounds.height * scale) / 2 - bounds.y * scale;

        svg.transition()
          .duration(1000)
          .call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
      }
    }, 1000);

  }, [interactions, layout, width, height]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Title with optional layout control */}
      {title && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', padding: '8px 12px', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#374151' }}>{title}</div>
            {showLayoutControl && onLayoutChange && (
              <button
                onClick={() => onLayoutChange(layout === 'force' ? 'radial' : 'force')}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  background: '#f8f9fa',
                  cursor: 'pointer'
                }}
              >
                {layout === 'force' ? 'Switch to Radial' : 'Switch to Force'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Organism indicator in top-right corner */}
      {predominantOrganism && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
          <div style={{
            background: 'rgba(59, 130, 246, 0.9)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            fontWeight: 'bold',
            fontSize: '13px',
            letterSpacing: '0.5px'
          }}>
            {predominantOrganism}
          </div>
        </div>
      )}

      {/* SVG */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
        }}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            background: 'rgba(0,0,0,0.9)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 1000,
            maxWidth: '250px',
            lineHeight: '1.4'
          }}
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      )}

      {/* Node Legend (bottom-right) */}
      {(legendType === 'nodes' || legendType === 'both') && (
        <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', padding: '8px 10px', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', fontSize: '11px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#374151' }}>Nodes</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <svg width="12" height="12">
                <circle cx="6" cy="6" r="5" fill="#8b5cf6" stroke="#fff" strokeWidth="1"/>
              </svg>
              <span style={{ color: '#374151' }}>Bait</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <svg width="12" height="12">
                <circle cx="6" cy="6" r="4" fill="#10b981" stroke="#fff" strokeWidth="1"/>
              </svg>
              <span style={{ color: '#374151' }}>Prey</span>
            </div>
            {centerProtein && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="12" height="12">
                  <circle cx="6" cy="6" r="6" fill="#dc3545" stroke="#fff" strokeWidth="1"/>
                </svg>
                <span style={{ color: '#374151' }}>Searched</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edge Legend (bottom-left) */}
      {(legendType === 'edges' || legendType === 'both') && (
        <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', padding: '8px 10px', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', fontSize: '11px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#374151' }}>Confidence</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
              <svg width="16" height="3">
                <line x1="0" y1="1.5" x2="16" y2="1.5" stroke="#28a745" strokeWidth="2"/>
              </svg>
              <span style={{ color: '#374151' }}>High</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
              <svg width="16" height="3">
                <line x1="0" y1="1.5" x2="16" y2="1.5" stroke="#f59e0b" strokeWidth="2"/>
              </svg>
              <span style={{ color: '#374151' }}>Medium</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
              <svg width="16" height="3">
                <line x1="0" y1="1.5" x2="16" y2="1.5" stroke="#dc3545" strokeWidth="2"/>
              </svg>
              <span style={{ color: '#374151' }}>Low</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="16" height="3">
                <line x1="0" y1="1.5" x2="16" y2="1.5" stroke="#6b7280" strokeWidth="2"/>
              </svg>
              <span style={{ color: '#374151' }}>AF2</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
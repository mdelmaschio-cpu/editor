'use client'

import { type AnyNodeId, useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { cn } from '../../../lib/utils'
import { PALETTE_COLORS } from '../primitives/color-dot'
import { PanelSection } from '../controls/panel-section'
import { PanelWrapper } from './panel-wrapper'

function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += polygon[i]?.[0] * polygon[j]?.[1]
    area -= polygon[j]?.[0] * polygon[i]?.[1]
  }
  return Math.abs(area) / 2
}

export function ZonePanel() {
  const zoneId = useViewer((s) => s.selection.zoneId)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const node = zoneId ? (nodes[zoneId as AnyNodeId] as ZoneNode | undefined) : undefined

  const handleUpdate = useCallback(
    (updates: Partial<ZoneNode>) => {
      if (!zoneId) return
      updateNode(zoneId as AnyNodeId, updates)
    },
    [zoneId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ zoneId: null })
  }, [setSelection])

  if (!node || node.type !== 'zone') return null

  const area = calculatePolygonArea(node.polygon)

  return (
    <PanelWrapper icon="/icons/zone.png" onClose={handleClose} title={node.name || 'Zone'} width={280}>
      <PanelSection title="Color">
        <div className="grid grid-cols-6 gap-1.5 px-2 py-1">
          {PALETTE_COLORS.map((c) => (
            <button
              className={cn(
                'h-7 w-full rounded-md border transition-transform hover:scale-105',
                c === node.color
                  ? 'border-foreground/50 ring-1 ring-ring/50'
                  : 'border-border/30',
              )}
              key={c}
              onClick={() => handleUpdate({ color: c })}
              style={{ backgroundColor: c }}
              type="button"
            />
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Area</span>
          <span className="font-mono text-foreground">{area.toFixed(2)} m²</span>
        </div>
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Points</span>
          <span className="font-mono text-foreground">{node.polygon.length}</span>
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}

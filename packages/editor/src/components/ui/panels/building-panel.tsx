'use client'

import { type AnyNodeId, type BuildingNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function BuildingPanel() {
  const buildingId = useViewer((s) => s.selection.buildingId)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const node = buildingId ? (nodes[buildingId as AnyNodeId] as BuildingNode | undefined) : undefined

  const handleUpdate = useCallback(
    (updates: Partial<BuildingNode>) => {
      if (!buildingId) return
      updateNode(buildingId as AnyNodeId, updates)
    },
    [buildingId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ buildingId: null })
  }, [setSelection])

  if (!node || node.type !== 'building') return null

  const levelCount = node.children.length
  const rotationDeg = ((node.rotation[1] ?? 0) * 180) / Math.PI

  return (
    <PanelWrapper icon="/icons/building.png" onClose={handleClose} title={node.name || 'Building'} width={280}>
      <PanelSection title="Rotation">
        <SliderControl
          label="Heading"
          max={180}
          min={-180}
          onChange={(v) => {
            const rad = (v * Math.PI) / 180
            handleUpdate({ rotation: [node.rotation[0], rad, node.rotation[2]] })
          }}
          precision={1}
          step={1}
          unit="°"
          value={Math.round(rotationDeg * 10) / 10}
        />
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Levels</span>
          <span className="font-mono text-foreground">{levelCount}</span>
        </div>
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Position</span>
          <span className="font-mono text-foreground">
            {node.position[0].toFixed(1)}, {node.position[2].toFixed(1)} m
          </span>
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}

'use client'

import { SummaryWidget } from './dom/SummaryWidget'
import { Scene } from './three/Scene'
import { useWarehouseData } from './useWarehouseData'

export function WarehouseView() {
  const { layout, flow, summary, error } = useWarehouseData()
  return (
    <div className="warehouse">
      <div className="warehouse-card">
        {layout && flow ? <Scene layout={layout} flow={flow} /> : <p className="warehouse-status">{error ?? 'Loading warehouse…'}</p>}
        {layout && flow && error && <p className="warehouse-status warehouse-error">Refresh failed: {error}</p>}
      </div>
      {summary && <SummaryWidget summary={summary} />}
    </div>
  )
}

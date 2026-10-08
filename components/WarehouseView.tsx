'use client'

import { Scene } from './three/Scene'
import { useWarehouseData } from './useWarehouseData'

export function WarehouseView() {
  const { layout, error } = useWarehouseData()
  return (
    <div className="warehouse-card">
      {layout ? <Scene layout={layout} /> : <p className="warehouse-status">{error ?? 'Loading warehouse…'}</p>}
      {layout && error && <p className="warehouse-status warehouse-error">Refresh failed: {error}</p>}
    </div>
  )
}

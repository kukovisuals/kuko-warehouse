import { WarehouseView } from '@/components/WarehouseView'

export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Death Wish Coffee</h1>
        <p>Product slotting</p>
      </header>
      <WarehouseView />
    </main>
  )
}

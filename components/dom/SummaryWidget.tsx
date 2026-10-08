'use client'

import { useId, useState } from 'react'
import { COLORS } from '@/lib/theme'
import type { Summary, SummarySection } from '@/lib/warehouse/summary'

type Tone = 'inbound' | 'neutral' | 'outbound'

const TONE_COLOR: Record<Tone, string> = {
  inbound: COLORS.inbound,
  neutral: '#1B1E25',
  outbound: COLORS.outbound,
}

const fmt = (n: number) => n.toLocaleString('en-US')

function Section({
  label,
  tone,
  section,
  empty,
  defaultOpen = false,
}: {
  label: string
  tone: Tone
  section: SummarySection
  empty: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const listId = useId()
  const color = TONE_COLOR[tone]

  return (
    <section className="summary-section">
      <header className="summary-head">
        <div>
          <p className="summary-label">
            <span className="summary-dot" style={{ background: color }} aria-hidden />
            {label}
          </p>
          <p className="summary-total" style={{ color }}>
            {fmt(section.total)}
          </p>
          <p className="summary-detail">{section.detail}</p>
        </div>
        <button
          type="button"
          className="summary-toggle"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`${open ? 'Hide' : 'Show'} ${label.toLowerCase()} products`}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined }}>
            <path d="M0 0h10L5 6z" fill="currentColor" />
          </svg>
        </button>
      </header>

      <div id={listId} hidden={!open}>
        {section.items.length === 0 ? (
          <p className="summary-empty">{empty}</p>
        ) : (
          <ul className="summary-list">
            {section.items.map((item) => (
              <li key={item.id} className="summary-item">
                <span className="summary-swatch" style={{ background: item.color }} aria-hidden />
                <span className="summary-name">
                  <span className="summary-title">{item.title}</span>
                  {item.subtitle && <span className="summary-sub">{item.subtitle}</span>}
                </span>
                <span className="summary-qty">
                  <span className="summary-count">{fmt(item.quantity)}</span>
                  {item.note && <span className="summary-note">{item.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Received, in-inventory and packed totals, each with a toggle that lists the products behind the number. */
export function SummaryWidget({ summary }: { summary: Summary }) {
  return (
    <aside className="summary" aria-label="Warehouse summary">
      <Section label="RECEIVED · LAST 24H" tone="inbound" section={summary.received} empty="Nothing received in the last 24 hours." defaultOpen />
      <Section label="IN INVENTORY" tone="neutral" section={summary.inventory} empty="No stock on the racks." />
      <Section label="PACKED" tone="outbound" section={summary.packed} empty="No packed orders waiting to ship." />
    </aside>
  )
}

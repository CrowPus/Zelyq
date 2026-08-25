'use client'

import { useRef } from 'react'
import { CinematicCanvas } from './CinematicCanvas'
import { ProductScene } from './ProductScene'
import { useCinematicTimeline } from './useCinematicTimeline'

export default function CinematicPageExample() {
  const scope = useRef(null)
  const trigger = useRef(null)
  const productRef = useRef(null)

  useCinematicTimeline({ scope, trigger, productRef })

  return (
    <main ref={scope}>
      <CinematicCanvas>
        <ProductScene ref={productRef} />
      </CinematicCanvas>

      <section ref={trigger} style={{ minHeight: '100vh' }}>
        <div className="copy">
          <p>Product family</p>
          <h1>A clear semantic headline.</h1>
          <a href="#details">Explore</a>
        </div>
      </section>

      <section id="details" style={{ minHeight: '100vh' }}>
        <h2>Details</h2>
        <p>Important content remains available as HTML.</p>
      </section>
    </main>
  )
}

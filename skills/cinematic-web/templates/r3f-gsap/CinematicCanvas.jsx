'use client'

import { Canvas } from '@react-three/fiber'
import { Environment } from '@react-three/drei'

export function CinematicCanvas({ children }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 5], fov: 42, near: 0.1, far: 100 }}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
    >
      <Environment preset="studio" />
      {children}
    </Canvas>
  )
}

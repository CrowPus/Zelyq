'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useGLTF } from '@react-three/drei'

export const ProductScene = forwardRef(function ProductScene(
  { url = '/models/product.glb' },
  ref
) {
  const group = useRef()
  const { scene } = useGLTF(url)

  useImperativeHandle(ref, () => ({ group: group.current }))

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  )
})

'use client'

import { useLayoutEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function useCinematicTimeline({ scope, trigger, productRef }) {
  useLayoutEffect(() => {
    if (!scope.current || !trigger.current || !productRef.current?.group) return

    const ctx = gsap.context(() => {
      const product = productRef.current.group

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: trigger.current,
          start: 'top top',
          end: '+=2200',
          scrub: 0.8,
          pin: true,
          invalidateOnRefresh: true,
        },
      })

      tl
        .addLabel('establish')
        .fromTo(product.rotation, { y: -0.25 }, { y: 0.25, duration: 1.2 })
        .addLabel('inspect')
        .to(product.rotation, { y: 1.15, duration: 1.8 })
        .to(product.position, { x: 0.55, duration: 1.2 }, '<0.2')
        .addLabel('resolve')
        .to(product.rotation, { y: 0.4, duration: 1.2 })
        .to(product.position, { x: 0, duration: 1.2 }, '<')
    }, scope)

    return () => ctx.revert()
  }, [scope, trigger, productRef])
}

# R3F + GSAP + Lenis Template Overlay

Use only when smooth scrolling adds real value.

Dependencies:

```bash
npm install three @react-three/fiber @react-three/drei gsap lenis
```

Use the sibling R3F + GSAP architecture and add `SmoothScrollProvider.jsx` near the application root.

Do not create a second manual RAF loop after integrating Lenis with GSAP's ticker.

/// <reference types="nativewind/types" />

// NativeWind reads global.css via the Metro config; this keeps the
// side-effect import in app/_layout.tsx type-clean.
declare module "*.css";

# Project instructions

Notes for the coding agent about *this* project. Edit this file — keep it short — and every
session reads it before it starts work. It wins over the agent's general defaults; it does not
override what you actually ask for in a message.

## Stack

React 19 + TypeScript + Vite + Tailwind CSS v4. Tailwind is configured in `src/index.css`
(`@import "tailwindcss";` plus an `@theme` block for tokens). No other CSS framework.

## Conventions

- Components in `src/components/`, one component per file, named the same as the file.
- Prefer function components and hooks. No class components.
- Reach for a design token (a CSS variable / a Tailwind scale value) before a one-off size or
  colour.
- Keep files readable — split a component up before it gets long.

## What this project is not

A single-page frontend. There is no backend, no database, and no deploy pipeline in this repo
unless you add one because a request needs it.

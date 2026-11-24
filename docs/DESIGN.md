# Design Document

## Overview
This document outlines the design principles and structural components of the frontend and the Express REST API.

## Frontend Design

### Styling Strategy
The project utilizes a hybrid styling approach to combine the speed of utility-first CSS with the power of pre-processed styling.

- **Tailwind CSS:** Used for 90% of the styling, focusing on layout, spacing, colors, and rapid UI prototyping.
- **SCSS:** Used for complex animations, custom properties (CSS variables), and highly specific component styles that are difficult to manage with utility classes alone.
- **Workflow:** SCSS files are compiled into a single `app.css` which includes Tailwind directives.

### Component-Based Architecture
The frontend is built using React components to ensure reusability and maintainability.

Key Design Principles:
- **Atomicity:** Breaking UI down into smallest possible pieces (Buttons, Inputs, Labels).
- **Composition:** Building complex components by composing smaller ones.
- **Responsiveness:** Mobile-first approach using Tailwind's responsive modifiers (e.g., `md:`, `lg:`).

### State Management
- **Local State:** Managed using React hooks (`useState`, `useReducer`) for component-specific logic.
- **Global State:** (If necessary) Managed using React Context API or a dedicated state management library for app-wide data.
- **Data Fetching:** Managed via `useEffect` or data-fetching libraries (e.g., TanStack Query) to fetch data from the backend.

## Backend Design

### RESTful API
The backend serves as a stateless API providing data in JSON format.

Endpoints:
- Standard CRUD operations on resource endpoints (e.g., `/api/projects`).
- Authentication and authorization endpoints.

## Design System
- **Typography:** Sans-serif font family for readability.
- **Color Palette:** Defined via Tailwind config and SCSS variables for consistent application across the UI.
- **Spacing/Layout:** Based on a standard 4px/8px grid system.

### Dark Mode
The site supports a light and a dark theme. Users pick **System**, **Light** or **Dark** with the theme button in the nav bar. Each click moves to the next mode, and the button shows the current one.

- **System** follows the operating system's appearance setting and switches live when it changes. This is the default.
- **Light** and **Dark** pin the theme. The choice is saved in `localStorage` under `theme` (System clears it).

How it works:
- **Tokens, not per-component styles.** Every color is a CSS variable in `client/src/styles/_tokens.scss`. Dark mode redefines the same variables under `:root.dark`, so utilities such as `bg-ink-50` or `text-brand-700` adapt on their own. Components should use palette utilities and never hard-coded colors like `bg-white` or hex values.
- **How the scales flip.** In each dark scale, the light end (50-300, used for tints, borders and subtle fills) becomes dark. The dark end (700-900, used for text) becomes light. Steps 400-600 stay mid-tone because they are solid fills under white text, such as primary buttons.
- **Surface.** Cards, menus, dialogs, inputs and the nav use `bg-surface`: white in light mode, a raised dark grey in dark mode. The page background is `bg-ink-50`.
- **`dark:` utilities** (Tailwind `darkMode: 'class'`) are only for what the token swap cannot express:
  - Solid buttons darken to 700 on hover in light mode. In dark mode they keep the 600 fill and dim it (`dark:hover:bg-*-600 dark:hover:brightness-90`), because a lighter fill would drop white text below AA contrast.
  - The modal backdrop uses `dark:bg-black/60`.
  - The black logo uses `dark:invert dark:hue-rotate-180`.
- **No flash.** `client/public/theme-init.js` applies the `dark` class before first paint. It is a separate file, not an inline script, because the Content-Security-Policy only allows same-origin scripts.
- **Native controls.** `color-scheme` is set per theme, so date pickers, selects, checkboxes and scrollbars match.
- **Contrast.** The main pairings meet WCAG AA (4.5:1) in both themes. Check any new color pairing in both themes.

  | Pairing | Light | Dark |
  | --- | --- | --- |
  | Body text (ink-900 on ink-50) | 17.0 | 17.8 |
  | Muted text (ink-500 on surface) | 4.8 | 5.8 |
  | White on primary button (brand-600) | 6.1 | 4.8 |
  | White on primary button, hovered | 7.6 | 4.5 |

### Motion
Animations share one bouncy easing curve, defined in the "Bounce motion" section of `client/src/styles/app.scss`. Components opt in with classes (`anim-bounce-in`, `anim-row`, `anim-drop`, `press`, and others). Users with reduced motion enabled get no animation or delays.

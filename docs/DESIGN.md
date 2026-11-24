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

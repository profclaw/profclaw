# GLINR UI Design Guidelines (Apple Liquid Style)

This document outlines the design principles and implementation details for the GLINR Task Manager UI, following the **Apple Liquid Design** aesthetic from macOS 26+.

## 🌈 Core Principles

1. **Liquid Glass & Depth**: Use multi-layered glassmorphism. Objects should feel like they are floating above a dynamic background with deep blurs and subtle inner highlights.
2. **Organic Shapes**: Use large border radii (**20px / 1.25rem**) for all main containers (Sidebars, Modals, Headers).
3. **Vibrancy through OKLCH**: Always use the OKLCH color space for perceptually uniform vibrancy and saturation.
4. **Motion & Life**: Every interaction should have smooth, cubic-bezier based transitions. Elements should "lift" on hover.

## 🎨 Theme Variants

The system supports three primary professional themes + a system default.

### 1. Light Mode
- **Background**: Soft cool tint (`oklch(0.99 0.005 260)`).
- **Glass**: High blur (`40px`), medium saturation (`180%`).
- **Primary**: Deep professional blue.

### 2. Dark Blue (Default Dark)
- **Background**: Deep Indigo-tinted charcoal (`oklch(0.12 0.02 260)`).
- **Glass**: Subtle bluish tint in the frost effect.
- **Vibe**: Modern, developer-focused, high energy.



## 🛠️ CSS Utility Classes

Use these predefined utilities in `index.css` to maintain consistency:

- `.sidebar-glass`: Specialized deep blur with inner highlights for floating sidebars.
- `.header-glass`: Pill-shaped glass container with elevated shadows.
- `.glass-heavy`: Intense 40px blur for popovers and menus.
- `.shadow-float`: 4-layer stacked shadow for lifted elements.
- `.hover-lift`: Smooth `translateY(-2px)` + shadow elevation on hover.
- `.transition-liquid`: Standard `0.3s` cubic-bezier transition for all properties.

## 📐 Layout Rules

- **Floating Sidebar**: Should always have a **12px - 20px margin** from the screen edges. Never touch the border.
- **Main Container**: Should stagger with the sidebar (e.g., `pl-[300px]` if the sidebar is `w-72`).
- **Pill Headers**: Top headers should be pill-shaped or rounded-rectangle floating bars, not full-width lines.

## 🔘 Component Guidelines

### Buttons
- Primary buttons should have a subtle gradient and a soft shadow of their own color.
- Secondary buttons should use the `.glass` utility.

### Inputs/Selects
- Always use the `backdrop-blur` even on small inputs.
- Use `rounded-xl` (12px) for form elements.

---

*Note: When creating new components, ensure they inherit the backdrop-blur and border-radii defined here to maintain the "liquid" feel.*

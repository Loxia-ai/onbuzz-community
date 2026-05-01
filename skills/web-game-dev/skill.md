---
name: web-game-dev
description: Step-by-step guidance for designing, optimizing and deploying modern browser-based games and game-like web applications.
---

# Web Game Development

This skill helps the agent support developers in building state-of-the-art games that run completely inside a web browser. These can be small hyper-casual titles, immersive 3D experiences, or complex multiplayer web applications. The goal is to ensure cross-platform support, high performance and an app-like feel without requiring users to download native apps.

## When to Use

Activate this skill whenever a developer or user asks about:

- Creating a new game that runs in a browser
- Choosing a game engine or technology stack for web games
- Converting an existing game to a Progressive Web App (PWA)
- Optimizing graphics, performance or responsiveness of browser-based games
- Implementing multiplayer networking, WebGPU, WebAssembly or AI in games
- Deploying or publishing a browser game, including PWA features

## Selecting Frameworks and Engines

Use the following guidelines to help choose appropriate tools:

- **Three.js** — A popular JavaScript library for rendering 3D graphics with WebGL/WebGPU. It offers high performance, a large community and PBR materials but does not include built-in game mechanics like physics or collisions.
- **Babylon.js** — A full-featured engine for 3D games with PBR rendering, a visual editor and strong community support.
- **Pixi.js** — A fast 2D renderer that falls back to canvas when WebGL is unavailable.
- **Phaser** — A mature framework for 2D games with a sound structure, TypeScript support and many plugins; its large build size and limited mobile optimisation are trade-offs.
- **Matter.js** — A lightweight 2D physics engine; ideal when you need rigid bodies, constraints and collisions, but it does not handle continuous collision detection.
- **PlayCanvas** — A cloud-hosted, mobile-optimised 3D engine with zero compile time and an asset pipeline.
- **Godot, Defold, GDevelop, Construct** — Cross-platform engines that can export to the web. Godot and Defold use scripting languages and provide 2D/3D support. GDevelop and Construct offer no-code/low-code editors for simple 2D games.

Encourage the developer to prototype with one engine and validate performance across devices.

## Modern Web Technologies

Modern browser APIs enable games to approach the capabilities of native applications:

- **WebGPU** — The successor to WebGL, providing explicit control over GPU pipelines, compute shaders and higher performance. By late 2025 it shipped in all major browsers and frameworks like Three.js and Babylon.js are adding WebGPU renderers.
- **WebAssembly (Wasm)** — A portable binary format that allows C/C++/Rust code to run in the browser at near-native speed. Engines like Unity compile to WebAssembly for complex games. Use Wasm modules for physics, AI or heavy computation.
- **Progressive Web Apps (PWA)** — Combine service workers, a manifest and responsive design to make web games installable, offline capable and discoverable. Use service workers to cache essential assets and sync data while offline.
- **Web Workers & OffscreenCanvas** — Move expensive logic and rendering off the main thread. OffscreenCanvas allows drawing in a worker using WebGL/WebGPU, keeping the UI responsive.
- **AI & Procedural Generation** — Use generative AI models and procedural algorithms to generate levels, assets or behaviours. Integrate AI via WebGPU compute shaders or server-side APIs and ensure safety and fairness.
- **Real-time Networking** — Use WebSocket or WebRTC for multiplayer games. WebRTC enables peer-to-peer communication with low latency; WebSockets provide reliable client-server communication.

## Game Development Process

### 1. Preproduction & Design

- Define the core loop, genre, narrative, mechanics and art style
- Create a game design document and prototype on paper or with simple code
- Plan user interactions, accessibility features and input methods (keyboard, touch, gamepad)

### 2. Setup and Architecture

- Choose an engine or library and set up a project using a bundler (Vite, Webpack, Parcel)
- Structure the code into modules for scenes, entities, systems and utilities
- Define a state management system to handle menus, gameplay states and UI

### 3. Implement Gameplay

- Import and manage assets using an asset pipeline. Use sprite sheets or atlases to minimise draw calls
- Create scenes and entities. Use physics engines or built-in collision detection
- Implement controls and camera systems. For 3D games, manage lighting and PBR materials
- Add sound using Web Audio API and compress audio files (e.g., Ogg)
- Use modular, reusable code and data-driven design to facilitate iteration

### 4. Optimise Performance

- Compress images (WebP, AVIF) and audio
- Lazy-load assets and load only what is needed for the current scene
- Use `requestAnimationFrame` with delta time to drive your game loop
- Redraw only what has changed; avoid clearing the entire canvas each frame
- Leverage GPU hardware acceleration via WebGL/WebGPU and avoid expensive DOM manipulation
- Profile and debug with browser devtools, measuring FPS, memory usage and GPU/CPU load
- Use OffscreenCanvas and Web Workers to offload rendering and computation from the main thread

### 5. Progressive Web App Integration

- Create a `manifest.json` with icons, name and start URL
- Register a service worker to pre-cache core assets and enable offline play
- Provide a clear user flow to install the game; support "Add to Home Screen" prompts
- Use IndexedDB or localStorage for saved games and preferences
- Implement push notifications or background sync for multiplayer features

### 6. Multiplayer and Cloud Streaming

- For synchronous multiplayer, use WebRTC for peer-to-peer or WebSockets for client-server architectures
- Implement an authoritative server to handle game logic and anti-cheat
- Handle latency by interpolating positions and implementing prediction and reconciliation
- Consider cloud streaming via WebRTC when the game is too heavy for the client device; encode video on the server and stream to the browser

### 7. Testing and Deployment

- Test across multiple browsers (Chrome, Edge, Firefox, Safari) and devices (desktop, mobile)
- Use responsive design to adapt to different resolutions and aspect ratios
- Benchmark performance with and without PWA caching
- Minify and bundle code; remove unused modules
- Host static assets on a CDN to reduce latency
- Provide clear documentation and accessible controls for end users

## Safety and Ethics

- Avoid including content inappropriate for minors (e.g., gambling, explicit violence or sexual themes)
- Comply with age rating guidelines and data-privacy regulations (GDPR, COPPA)
- Ensure fairness in gameplay and avoid exploiting players through manipulative monetisation
- Be mindful of energy efficiency and carbon footprint; optimise code to reduce CPU/GPU load

## Resources

Encourage developers to consult official documentation and reputable resources:

- Three.js: https://threejs.org/docs
- Babylon.js: https://doc.babylonjs.com
- Pixi.js: https://pixijs.com
- Phaser: https://phaser.io
- PlayCanvas: https://developer.playcanvas.com
- Godot: https://docs.godotengine.org
- MDN Web Docs: WebGPU, WebAssembly, Service Workers and WebRTC references
- web.dev: Tutorials on Progressive Web Apps and performance optimisation

Always cross-check the latest browser support tables and engine documentation, as web technologies evolve rapidly.


**1. Yuka.js**
 * **Updated Overview:** Yuka is an active, highly regarded open-source JavaScript Game AI library (with over 1.3k stars on GitHub). It was specifically built to bring long-standing video game industry best practices to web-based games.
 * **Core Components:** It provides a robust suite of tools including autonomous agent design (both state-driven and goal-driven), steering behaviors, navigation meshes (navmesh) for pathfinding, perception systems (giving entities "vision" and short-term memory), and fuzzy logic inference.
 * **Key Insight:** Yuka is completely rendering-engine agnostic. While its official showcases (like the "Dive" shooter AI demo) often use Three.js, the core logic is entirely separate and can easily be paired with Babylon.js, custom 2D canvas engines, or Phaser.
**2. phaser-simple-soccer (and "Simple Soccer" architecture)**
 * **Updated Overview:** This is a TypeScript/Phaser 3 adaptation of the famous "Simple Soccer" environment found in Chapter 4 of Mat Buckland’s foundational book, *Programming Game AI by Example*.
 * **Core Components:** It focuses heavily on finite state machines (FSM) to dictate team and player states. It handles passing logic, support spot calculations, and the critical "who should chase the ball" decision-making process.
 * **Key Insight:** Because Buckland's original code was written in C++, "Simple Soccer" has been ported across the internet in various formats. This specific Phaser/TypeScript port is not meant to be a plug-and-play npm module, but rather a direct architectural blueprint for building state-driven arcade sports games.
**3. AI-3DSoccer**
 * **Updated Overview:** Developed by GitHub user "xbeat", this is an open-source 3D soccer environment built entirely in JavaScript using Three.js.
 * **Core Components:** Like the Phaser implementation above, it explicitly credits Mat Buckland's *Programming Game AI by Example* for its underlying AI logic, translating 2D steering and state-machine concepts into a 3D space.
 * **Key Insight:** The repository is several years old and largely inactive (with around 12 stars). The search confirms your earlier assessment: it is a fantastic learning resource to see how 2D AI logic is mapped to 3D coordinates in Three.js, but it is not a maintained production library.
**4. football-simulator (and TypeScript Manager Engines)**
 * **Updated Overview:** Projects in this space—such as the open-source *Openfoot Manager*—often utilize TypeScript alongside highly performant backends (like Rust) to run complex match simulations.
 * **Core Components:** Instead of real-time physics and steering, these simulation engines are event-driven. They focus on macro-level tactics, calculating statistical probabilities for passes, interceptions, shots, and fouls based on player attributes and formations.
 * **Key Insight:** These frameworks are strictly built for the "Football Manager" genre. They calculate game states and output text-based commentary or abstract 2D positional data rather than driving real-time arcade gameplay.
**5. RoboCup Soccer Simulation**
 * **Updated Overview:** RoboCup is a massive, international scientific initiative dating back to 1995. It is designed to advance the state-of-the-art in intelligent robotics and multi-agent systems, with the ultimate goal of fielding a team of robots that can beat the human world champions by 2050.
 * **Core Components:** The simulation league is split into two main categories:
   * **2D Simulation:** Autonomous software agents (represented as circles) receive noisy, relative sensor data (visual and acoustic) and must send basic commands (dash, turn, kick) to a central server every 100 milliseconds.
   * **3D Simulation:** Highly complex physics simulation where agents must calculate low-level controls for humanoid robots, managing up to 22 individual hinges just to walk, stand up, or kick.
 * **Key Insight:** This is a heavy academic research platform used by universities worldwide to test machine learning and multi-agent cooperation. It is far too complex and resource-intensive for standard web game development.

---

## More engines & repositories (second wave)

These range from real-time 3D multiplayer architectures to deep macro-level simulators.

**6. Notblox (Three.js Multiplayer ECS Engine)**
A modern, open-source multiplayer game engine built with **Three.js** and TypeScript. It uses an Entity Component System (ECS) for network synchronization and Rapier.js for physics, and ships a server-authoritative **Football game mode** demo.
 * **What it consists of:** A Node.js backend using WebSockets, client-side Three.js rendering, and modular TypeScript game scripts.
 * **Verdict:** Highly relevant for a 3D browser-based multiplayer football game — a working blueprint for server-authoritative ball physics and player synchronization. Its headline takeaway for a single-player arcade game is **real, physics-driven ball motion in 3D** (height, gravity, bounce).

**7. footballSimulationEngine**
A pure Node.js module designed strictly for backend match logic. It runs iterative 2D football matches by taking two JSON files (teams + player stats) and outputting positional data step-by-step.
 * **What it consists of:** Iterative logic handling ball movement scaled to kick power, possession states, and player actions (shoot, **through-ball**, intercept, **slide**). It separates player movement decisions from ball physics to prevent simultaneous conflicting actions.
 * **Verdict:** A lightweight headless backend for a custom renderer. Its transferable gift is an explicit **action set** — through-ball, slide tackle, intercept — beyond plain pass/shoot.

**8. Openfoot Manager**
A highly active, completely free open-source alternative to *Football Manager*.
 * **What it consists of:** A fast match engine (Rust) paired with a React + TypeScript UI, running as a Tauri desktop app. Zone-based minute-by-minute simulation, full squad management, transfers, training.
 * **Verdict:** Not arcade gameplay, but the reference for **attribute-driven squads** — named players with distinct ratings and lots of structured JSON player data.

**9. open-football (by ZOXEXIVO)**
A pure Rust "football world simulator" that runs autonomously, simulating entire ecosystems over decades.
 * **What it consists of:** A single-binary engine simulating leagues, club finances, AI-driven transfers and **player reputations** without human intervention, plus a web UI to view the world.
 * **Verdict:** A macro-level simulator, disconnected from real-time control. The transferable spark is **named player identities/reputations** giving characters on the pitch.

*(Note: the repo `fbsim-core` simulates American Football (NFL), not soccer — out of scope.)*


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

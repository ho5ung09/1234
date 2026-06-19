import React, { useEffect, useRef, useState } from "react";
import { Trash, MarineLife, TrashType, MarineLifeType, Upgrade } from "../types";
import { playCollectChirp, playHazardAlarm, playTractorHum, playSonarPing } from "../utils/audio";

interface OceanCanvasProps {
  robot: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    energy: number;
    cargo: Trash[];
    maxCapacity: number;
    speedMultiplier: number;
    radarRange: number;
    autopilot: boolean;
  };
  onUpdateRobot: (updater: (prev: any) => any) => void;
  trashList: Trash[];
  onUpdateTrash: (trash: Trash[]) => void;
  marineLifeList: MarineLife[];
  onUpdateMarineLife: (life: MarineLife[]) => void;
  onAddAiLog: (message: string, type: 'info' | 'warning' | 'success' | 'ai') => void;
  onCollideMarineLife: (name: string) => void;
  onDeposit: (depositedItems: Trash[]) => void;
  recycleStation: { x: number; y: number; radius: number };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
}

export const OceanCanvas: React.FC<OceanCanvasProps> = ({
  robot,
  onUpdateRobot,
  trashList,
  onUpdateTrash,
  marineLifeList,
  onUpdateMarineLife,
  onAddAiLog,
  onCollideMarineLife,
  onDeposit,
  recycleStation,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Refs for animation loop to avoid stale closure issues
  const stateRef = useRef({
    robot,
    trashList,
    marineLifeList,
    recycleStation,
  });

  // Track keyboard inputs
  const keysRef = useRef<{ [key: string]: boolean }>({});

  // Local visual-only particles to keep game smooth
  const particlesRef = useRef<Particle[]>([]);
  const sonarSweepRef = useRef({ angle: 0, active: true });
  const activeTractorBeamsRef = useRef<{ trashId: string; progress: number }[]>([]);

  // Keep stateRef in sync with props
  useEffect(() => {
    stateRef.current = {
      robot,
      trashList,
      marineLifeList,
      recycleStation,
    };
  }, [robot, trashList, marineLifeList, recycleStation]);

  // Handle Resize of canvas container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({
        width: Math.max(width, 400),
        height: Math.max(height, 300),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Keyboard listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const g = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(g) || e.key === ' ') {
        keysRef.current[g] = true;
        // Prevent scrolling with arrows/space inside game
        if (['arrowup', 'arrowdown', 'space', ' '].includes(e.key.toLowerCase())) {
          e.preventDefault();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const g = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(g) || e.key === ' ') {
        keysRef.current[g] = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Trigger manual sonar ping on click/space occasionally
  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (stateRef.current.robot.energy > 5) {
        playSonarPing();
      }
    }, 4500);
    return () => clearInterval(pingInterval);
  }, []);

  // Main game logic update and render loop
  useEffect(() => {
    let animationId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const MAP_LIMIT = 2400;

    const gameLoop = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const currentSec = Date.now();

      // Retrieve latest states from the ref
      const currentRobot = { ...stateRef.current.robot };
      let currentTrash = [...stateRef.current.trashList];
      let currentLife = [...stateRef.current.marineLifeList];
      const currentStation = stateRef.current.recycleStation;

      // 1. UPDATE PHYSICS & CONTROLS

      // Movement damping/friction
      const friction = 0.94;
      let targetVx = currentRobot.vx * friction;
      let targetVy = currentRobot.vy * friction;

      // Autopilot AI calculations (Potential Field AI + Marine Avoidance)
      if (currentRobot.autopilot && currentRobot.energy > 0) {
        let aiTargetX = currentStation.x;
        let aiTargetY = currentStation.y;

        // Auto-pilot goal selection: Find closest trash, or head to center if cargo is full or no trash left
        if (currentRobot.cargo.length < currentRobot.maxCapacity) {
          let closestTrash: Trash | null = null;
          let minDistance = Infinity;

          currentTrash.forEach((t) => {
            const dist = Math.hypot(t.x - currentRobot.x, t.y - currentRobot.y);
            if (dist < minDistance) {
              minDistance = dist;
              closestTrash = t;
            }
          });

          if (closestTrash) {
            aiTargetX = (closestTrash as Trash).x;
            aiTargetY = (closestTrash as Trash).y;
          }
        }

        // Determine base attraction vector to sub-target
        let dx = aiTargetX - currentRobot.x;
        let dy = aiTargetY - currentRobot.y;
        let distToTarget = Math.hypot(dx, dy);

        let forceX = 0;
        let forceY = 0;

        if (distToTarget > 15) {
          forceX = (dx / distToTarget) * 0.75 * currentRobot.speedMultiplier;
          forceY = (dy / distToTarget) * 0.75 * currentRobot.speedMultiplier;
        }

        // MARINE LIFE AVOIDANCE ALGORITHM (REPULES VECTOR FOR PROTECTION)
        currentLife.forEach((life) => {
          const ldx = currentRobot.x - life.x;
          const ldy = currentRobot.y - life.y;
          const ldist = Math.hypot(ldx, ldy);

          // If close to sea animals (< 170px), generate heavy repulse
          if (ldist < 170 && ldist > 5) {
            const repStrength = (2500 / (ldist * ldist)) * currentRobot.speedMultiplier;
            forceX += (ldx / ldist) * repStrength;
            forceY += (ldy / ldist) * repStrength;

            // Occasional AI logging
            if (Math.random() < 0.005) {
              onAddAiLog(
                `[AI 회피 알고리즘]: ${life.name} 보호 구역 감지. 충돌 방지 기동 가동!`,
                "ai"
              );
            }
          }
        });

        // Apply forces to velocity
        targetVx += forceX * 0.4;
        targetVy += forceY * 0.4;

        // Set facing angle towards computed movement direction
        if (Math.hypot(targetVx, targetVy) > 0.1) {
          const targetAngle = Math.atan2(targetVy, targetVx);
          // Interpolate angle smoothly
          let diff = targetAngle - currentRobot.angle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          currentRobot.angle += diff * 0.12;
        }

        // Deplete battery slowly in AI mode
        currentRobot.energy = Math.max(0, currentRobot.energy - 0.025);
      } else {
        // MANUAL MODE WASD Steering
        let moveX = 0;
        let moveY = 0;

        // Up/Down/Left/Right triggers
        if (keysRef.current['w'] || keysRef.current['arrowup']) moveY -= 1;
        if (keysRef.current['s'] || keysRef.current['arrowdown']) moveY += 1;
        if (keysRef.current['a'] || keysRef.current['arrowleft']) moveX -= 1;
        if (keysRef.current['d'] || keysRef.current['arrowright']) moveX += 1;

        if ((moveX !== 0 || moveY !== 0) && currentRobot.energy > 0) {
          const mag = Math.hypot(moveX, moveY);
          const force = 0.42 * currentRobot.speedMultiplier;
          targetVx += (moveX / mag) * force;
          targetVy += (moveY / mag) * force;

          // Rotate robot towards thrust vector
          const targetAngle = Math.atan2(moveY, moveX);
          let diff = targetAngle - currentRobot.angle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          currentRobot.angle += diff * 0.15;

          // Drain battery for active moving
          currentRobot.energy = Math.max(0, currentRobot.energy - 0.04);

          // Emit propeller bubbles behind robot
          if (Math.random() < 0.35) {
            const bAngle = currentRobot.angle + Math.PI + (Math.random() * 0.4 - 0.2);
            particlesRef.current.push({
              x: currentRobot.x - Math.cos(currentRobot.angle) * 20,
              y: currentRobot.y - Math.sin(currentRobot.angle) * 20,
              vx: Math.cos(bAngle) * (2 + Math.random() * 2),
              vy: Math.sin(bAngle) * (2 + Math.random() * 2) - 0.5,
              size: Math.random() * 3 + 1,
              alpha: 0.8,
              life: 0,
              maxLife: 30 + Math.random() * 20,
              color: "rgba(220, 245, 255, 0.7)",
            });
          }
        }
      }

      // Apply movement variables
      currentRobot.vx = targetVx;
      currentRobot.vy = targetVy;
      currentRobot.x += currentRobot.vx;
      currentRobot.y += currentRobot.vy;

      // Handle map boundaries
      if (currentRobot.x < 50) { currentRobot.x = 50; currentRobot.vx = 0; }
      if (currentRobot.x > MAP_LIMIT - 50) { currentRobot.x = MAP_LIMIT - 50; currentRobot.vx = 0; }
      if (currentRobot.y < 50) { currentRobot.y = 50; currentRobot.vy = 0; }
      if (currentRobot.y > MAP_LIMIT - 50) { currentRobot.y = MAP_LIMIT - 50; currentRobot.vy = 0; }

      // Recharge battery at Recycle Station automatically
      const distToStation = Math.hypot(currentRobot.x - currentStation.x, currentRobot.y - currentStation.y);
      if (distToStation < currentStation.radius) {
        if (currentRobot.energy < 100) {
          currentRobot.energy = Math.min(100, currentRobot.energy + 1.2);
          if (Math.random() < 0.03) {
            onAddAiLog("[전력 기지]: 고속 안전 스마트 충전 패드 도킹됨. 에너지 급속 복구 중...", "info");
          }
        }

        // Automatic garbage discharge deposit
        if (currentRobot.cargo.length > 0) {
          const deposited = [...currentRobot.cargo];
          currentRobot.cargo = [];
          onDeposit(deposited);
        }
      }

      // Generate background ambient water bubbles
      if (Math.random() < 0.08) {
        particlesRef.current.push({
          x: Math.random() * MAP_LIMIT,
          y: MAP_LIMIT + 10,
          vx: Math.random() * 0.4 - 0.2,
          vy: -(0.5 + Math.random() * 1.5),
          size: Math.random() * 2.5 + 0.5,
          alpha: 0.2 + Math.random() * 0.4,
          life: 0,
          maxLife: 400 + Math.random() * 200,
          color: "rgba(100, 210, 255, 0.4)",
        });
      }

      // 2. UPDATE SEA LIFE & TRASH INTERACTIONS

      // Update Sea Animals (Moving with beautiful sine waves or smooth turns)
      currentLife = currentLife.map((life) => {
        let nvx = life.vx;
        let nvy = life.vy;

        // Add small random currents to change path organically
        if (Math.random() < 0.02) {
          const wobble = Math.random() * 0.6 - 0.3;
          const currentAngle = Math.atan2(life.vy, life.vx) + wobble;
          nvx = Math.cos(currentAngle) * life.speed;
          nvy = Math.sin(currentAngle) * life.speed;
        }

        let nx = life.x + nvx;
        let ny = life.y + nvy;

        // Turn around at boundaries
        if (nx < 80 || nx > MAP_LIMIT - 80) { nvx = -nvx; nx = life.x + nvx; }
        if (ny < 80 || ny > MAP_LIMIT - 80) { nvy = -nvy; ny = life.y + nvy; }

        // Compute swimming angle
        const targetAngle = Math.atan2(nvy, nvx);
        let nAngle = life.angle;
        let diff = targetAngle - nAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        nAngle += diff * 0.1;

        // Emit tiny bubble streams from animals occasionally
        let bubbleT = life.bubbleTimer - 1;
        if (bubbleT <= 0) {
          bubbleT = 60 + Math.random() * 120;
          particlesRef.current.push({
            x: nx,
            y: ny - 5,
            vx: Math.random() * 0.6 - 0.3,
            vy: -0.8 - Math.random() * 0.8,
            size: Math.random() * 2 + 1,
            alpha: 0.6,
            life: 0,
            maxLife: 100 + Math.random() * 50,
            color: "rgba(180, 240, 255, 0.5)",
          });
        }

        // Colision detection robot <-> marine creature
        const distToCreature = Math.hypot(currentRobot.x - nx, currentRobot.y - ny);
        if (distToCreature < (life.size + 24)) {
          // Accidental collision warning! Repel robot away safely
          const rx = currentRobot.x - nx;
          const ry = currentRobot.y - ny;
          const rdist = Math.hypot(rx, ry) || 1;

          // Push robot away
          currentRobot.vx += (rx / rdist) * 3;
          currentRobot.vy += (ry / rdist) * 3;

          playHazardAlarm();
          onCollideMarineLife(life.name);

          // Push animal away in fright
          nvx = -(rx / rdist) * life.speed * 2.5;
          nvy = -(ry / rdist) * life.speed * 2.5;

          // Shock waves particles
          for (let p = 0; p < 12; p++) {
            const pAngle = Math.random() * Math.PI * 2;
            const pSpd = 1.5 + Math.random() * 3;
            particlesRef.current.push({
              x: nx,
              y: ny,
              vx: Math.cos(pAngle) * pSpd,
              vy: Math.sin(pAngle) * pSpd,
              size: Math.random() * 3 + 1,
              alpha: 0.9,
              life: 0,
              maxLife: 40,
              color: "rgba(239, 68, 68, 0.8)", // bright hazard red
            });
          }
        }

        return {
          ...life,
          x: nx,
          y: ny,
          vx: nvx,
          vy: nvy,
          angle: nAngle,
          bubbleTimer: bubbleT,
        };
      });

      // Update Sonar Radar Sweep
      sonarSweepRef.current.angle = (sonarSweepRef.current.angle + 0.035) % (Math.PI * 2);

      // LiDAR automation Scan and Grapple beam sequence
      let updatedTrashList = currentTrash.map((trash) => {
        const dist = Math.hypot(trash.x - currentRobot.x, trash.y - currentRobot.y);

        // 1. Sonar Sweep scan triggers
        let isScanned = trash.scanned;
        let pScan = trash.scanProgress;

        if (dist <= currentRobot.radarRange) {
          if (!isScanned) {
            pScan = Math.min(1, pScan + 0.025);
            if (pScan >= 1) {
              isScanned = true;
              onAddAiLog(
                `[AI 레이더 수색]: ${trash.label} 자동 식별 성공! (신뢰도: ${(90 + Math.random() * 9.9).toFixed(1)}%)`,
                "ai"
              );
            }
          }
        }

        // 2. Tractor Beam pulling algorithm
        let tx = trash.x;
        let ty = trash.y;

        const isTractorAble =
          isScanned &&
          dist < 130 &&
          currentRobot.cargo.length < currentRobot.maxCapacity &&
          currentRobot.energy > 5;

        if (isTractorAble) {
          // Play hum sound
          if (Math.random() < 0.12) playTractorHum();

          // Move debris towards robot mouth
          const pullSpeed = 2.8;
          tx += ((currentRobot.x - trash.x) / dist) * pullSpeed;
          ty += ((currentRobot.y - trash.y) / dist) * pullSpeed;

          // Spawn grapple lightning sparks or tractor line bubbles
          if (Math.random() < 0.6) {
            particlesRef.current.push({
              x: trash.x + Math.random() * 10 - 5,
              y: trash.y + Math.random() * 10 - 5,
              vx: (currentRobot.x - trash.x) * 0.08 + (Math.random() * 2 - 1),
              vy: (currentRobot.y - trash.y) * 0.08 + (Math.random() * 2 - 1),
              size: Math.random() * 2 + 1,
              alpha: 0.9,
              life: 0,
              maxLife: 15,
              color: "rgba(34, 211, 238, 0.95)", // cyan neon
            });
          }
        }

        return {
          ...trash,
          scanned: isScanned,
          scanProgress: pScan,
          x: tx,
          y: ty,
        };
      });

      // Handle actual garbage pickup collision
      const grabbedTrashIds: string[] = [];
      updatedTrashList = updatedTrashList.filter((trash) => {
        const dist = Math.hypot(trash.x - currentRobot.x, trash.y - currentRobot.y);
        const scoopLimit = 32;

        if (dist < scoopLimit && currentRobot.cargo.length < currentRobot.maxCapacity) {
          // Check if space left in cargo
          currentRobot.cargo.push(trash);
          grabbedTrashIds.push(trash.id);
          playCollectChirp();
          onAddAiLog(
            `[AI 수거 적재 완료]: ${trash.label}을 소형 보관함에 적재함 (${currentRobot.cargo.length}/${currentRobot.maxCapacity})`,
            "success"
          );

          // Success particles splash
          for (let pi = 0; pi < 15; pi++) {
            const angle = Math.random() * Math.PI * 2;
            const velocity = 2 + Math.random() * 4;
            particlesRef.current.push({
              x: trash.x,
              y: trash.y,
              vx: Math.cos(angle) * velocity,
              vy: Math.sin(angle) * velocity,
              size: Math.random() * 4 + 1.5,
              alpha: 1,
              life: 0,
              maxLife: 30,
              color: "rgba(6, 182, 212, 1)", // rich cyan
            });
          }
          return false; // remove from map
        }
        return true;
      });

      // 3. UPDATE PARTICLES VISUAL
      particlesRef.current = particlesRef.current
        .map((p) => {
          return {
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            life: p.life + 1,
            alpha: Math.max(0, p.alpha - 1 / p.maxLife),
          };
        })
        .filter((p) => p.life < p.maxLife && p.alpha > 0);

      // Trigger state notifications to React if changes occurred
      if (grabbedTrashIds.length > 0 || currentTrash.length !== updatedTrashList.length) {
        onUpdateTrash(updatedTrashList);
      }

      onUpdateRobot(() => currentRobot);
      onUpdateMarineLife(currentLife);

      // 4. RENDERING SECTION (CAMERA VIEWPORT SYSTEM)

      // Calculate smooth camera centering on Robot
      const camX = currentRobot.x - dimensions.width / 2;
      const camY = currentRobot.y - dimensions.height / 2;

      // Clear Canvas
      ctx.fillStyle = "#0c1524"; // Oceanic dark deep-sea blue
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      // Apply Camera translation only to drawing components
      ctx.save();
      ctx.translate(-camX, -camY);

      // A. Ocean Water Gradients Grid
      ctx.strokeStyle = "rgba(22, 40, 70, 0.65)";
      ctx.lineWidth = 1;
      const gridSize = 100;
      const startX = Math.floor(camX / gridSize) * gridSize;
      const endX = startX + dimensions.width + gridSize * 2;
      const startY = Math.floor(camY / gridSize) * gridSize;
      const endY = startY + dimensions.height + gridSize * 2;

      for (let x = Math.max(0, startX); x <= Math.min(MAP_LIMIT, endX); x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, Math.max(0, camY));
        ctx.lineTo(x, Math.min(MAP_LIMIT, camY + dimensions.height + gridSize));
        ctx.stroke();
      }
      for (let y = Math.max(0, startY); y <= Math.min(MAP_LIMIT, endY); y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(Math.max(0, camX), y);
        ctx.lineTo(Math.min(MAP_LIMIT, camX + dimensions.width + gridSize), y);
        ctx.stroke();
      }

      // Draw map border lines
      ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, MAP_LIMIT, MAP_LIMIT);

      // Draw Recycle research base
      const stationX = currentStation.x;
      const stationY = currentStation.y;
      const stationR = currentStation.radius;

      // Draw station background dome aura
      const stationGlow = ctx.createRadialGradient(stationX, stationY, stationR - 50, stationX, stationY, stationR + 60);
      stationGlow.addColorStop(0, "rgba(34, 197, 94, 0.12)");
      stationGlow.addColorStop(0.6, "rgba(34, 197, 94, 0.04)");
      stationGlow.addColorStop(1, "rgba(34, 197, 94, 0)");
      ctx.fillStyle = stationGlow;
      ctx.beginPath();
      ctx.arc(stationX, stationY, stationR + 60, 0, Math.PI * 2);
      ctx.fill();

      // Station docking circle ring
      ctx.strokeStyle = "rgba(34, 197, 94, 0.7)";
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(stationX, stationY, stationR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw inner station research pod
      ctx.strokeStyle = "rgba(74, 222, 128, 0.9)";
      ctx.lineWidth = 4;
      ctx.fillStyle = "#142818";
      ctx.beginPath();
      ctx.arc(stationX, stationY, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Recycling symbol decal rotators
      ctx.strokeStyle = "rgba(74, 222, 128, 0.8)";
      ctx.lineWidth = 2;
      ctx.save();
      ctx.translate(stationX, stationY);
      ctx.rotate(Date.now() * 0.001);
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.moveTo(0, -32);
        ctx.lineTo(12, -20);
        ctx.lineTo(-6, -20);
        ctx.stroke();
      }
      ctx.restore();

      // Clean station label HUD
      ctx.fillStyle = "#4ade80";
      ctx.font = "bold 11px font-mono, Courier New";
      ctx.textAlign = "center";
      ctx.fillText("ECO RECYCLE HUB", stationX, stationY + 70);
      ctx.fillText("DOCK TO DROP CARGO", stationX, stationY + 84);

      // Outer directional sonar rings indicator pointing to station if robot is far away
      if (distToStation > 300) {
        const baseAngle = Math.atan2(stationY - currentRobot.y, stationX - currentRobot.x);
        const indDist = 80;
        const indX = currentRobot.x + Math.cos(baseAngle) * indDist;
        const indY = currentRobot.y + Math.sin(baseAngle) * indDist;

        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(indX, indY, 4 + Math.sin(Date.now() * 0.01) * 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(34, 197, 94, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(indX, indY, 12, baseAngle - 0.4, baseAngle + 0.4);
        ctx.stroke();
      }

      // B. Draw Trash items on the floor
      updatedTrashList.forEach((trash) => {
        const size = trash.size;

        if (trash.scanned) {
          // Draw Neon brackets for fully AI processed debris
          ctx.strokeStyle = "rgba(6, 182, 212, 0.55)";
          ctx.lineWidth = 1;
          const bracketOffset = size + 8;
          ctx.beginPath();
          // Top Left
          ctx.moveTo(trash.x - bracketOffset, trash.y - bracketOffset + 6);
          ctx.lineTo(trash.x - bracketOffset, trash.y - bracketOffset);
          ctx.lineTo(trash.x - bracketOffset + 6, trash.y - bracketOffset);
          // Top Right
          ctx.moveTo(trash.x + bracketOffset - 6, trash.y - bracketOffset);
          ctx.lineTo(trash.x + bracketOffset, trash.y - bracketOffset);
          ctx.lineTo(trash.x + bracketOffset, trash.y - bracketOffset + 6);
          // Bottom Left
          ctx.moveTo(trash.x - bracketOffset, trash.y + bracketOffset - 6);
          ctx.lineTo(trash.x - bracketOffset, trash.y + bracketOffset);
          ctx.lineTo(trash.x - bracketOffset + 6, trash.y + bracketOffset);
          // Bottom Right
          ctx.moveTo(trash.x + bracketOffset - 6, trash.y + bracketOffset);
          ctx.lineTo(trash.x + bracketOffset, trash.y + bracketOffset);
          ctx.lineTo(trash.x + bracketOffset, trash.y + bracketOffset - 6);
          ctx.stroke();

          // Text classification indicator
          ctx.fillStyle = "#06b6d4";
          ctx.font = "9px font-mono, Courier New, monospace";
          ctx.textAlign = "center";
          ctx.fillText(trash.label, trash.x, trash.y - size - 12);
        } else if (trash.scanProgress > 0) {
          // Scan Loading bar outline
          ctx.strokeStyle = "rgba(234, 179, 8, 0.6)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(trash.x, trash.y, size + 4, 0, Math.PI * 2 * trash.scanProgress);
          ctx.stroke();
        }

        // Draw Debris shapes
        ctx.save();
        ctx.translate(trash.x, trash.y);
        ctx.rotate(trash.id.charCodeAt(0) * 0.1); // dynamic rotation angle based on ID

        if (trash.type === "plastic_bottle") {
          ctx.fillStyle = "rgba(100, 200, 255, 0.45)";
          ctx.strokeStyle = "rgba(150, 220, 255, 0.85)";
          ctx.lineWidth = 1.5;
          // Bottle body shape
          ctx.beginPath();
          ctx.roundRect(-8, -14, 16, 24, 3);
          ctx.fill();
          ctx.stroke();
          // Neck
          ctx.fillStyle = "#3b82f6";
          ctx.fillRect(-4, -18, 8, 4);
        } else if (trash.type === "tire") {
          ctx.fillStyle = "#2d3545";
          ctx.strokeStyle = "#1a202c";
          ctx.lineWidth = 3;
          // Outer tire
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Inner hub
          ctx.fillStyle = "#1e293b";
          ctx.beginPath();
          ctx.arc(0, 0, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (trash.type === "pesticide_can") {
          ctx.fillStyle = "#eab308"; // rusted toxic yellow
          ctx.strokeStyle = "#854d0e";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(-10, -12, 20, 24);
          ctx.fill();
          ctx.stroke();
          // Draw hazard symbol skull/crossbones style indicator
          ctx.strokeStyle = "#de2c2c";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-5, -5); ctx.lineTo(5, 5);
          ctx.moveTo(5, -5); ctx.lineTo(-5, 5);
          ctx.stroke();
        } else if (trash.type === "nylon_net") {
          ctx.strokeStyle = "rgba(164, 180, 200, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          // Network of wavy net strings
          for (let i = -14; i <= 14; i += 7) {
            ctx.moveTo(i, -14);
            ctx.quadraticCurveTo(0, 0, i, 14);
            ctx.moveTo(-14, i);
            ctx.quadraticCurveTo(0, 0, 14, i);
          }
          ctx.stroke();
        } else {
          // aluminum can
          ctx.fillStyle = "#94a3b8";
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-8, -13, 16, 26, 4);
          ctx.fill();
          ctx.stroke();
          // stripes on can
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(-8, -4, 16, 6);
        }

        ctx.restore();
      });

      // C. Draw Marine Life Animals swimming under the sea
      currentLife.forEach((life) => {
        ctx.save();
        ctx.translate(life.x, life.y);
        ctx.rotate(life.angle);

        // Scan sonar shield glowing around species
        if (robot.radarRange > Math.hypot(life.x - currentRobot.x, life.y - currentRobot.y)) {
          ctx.strokeStyle = "rgba(34, 197, 94, 0.4)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(0, 0, life.size + 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Small AI bio tags
          ctx.fillStyle = "#22c55e";
          ctx.font = "8px font-mono, Courier New, monospace";
          ctx.fillText("BIO-SAFE", 0, -life.size - 13);
        }

        const wiggle = Math.sin(Date.now() * 0.009 + life.x * 0.05);

        if (life.type === "turtle") {
          // Shell back green
          ctx.fillStyle = "#166534";
          ctx.strokeStyle = "#14532d";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(0, 0, 20, 16, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Flaps/Flippers swimming wiggles
          ctx.fillStyle = "#22c55e";
          ctx.beginPath();
          // Front paddle left
          ctx.ellipse(8, -14 + wiggle * 2, 12, 6, -0.6 + wiggle * 0.15, 0, Math.PI * 2);
          // Front paddle right
          ctx.ellipse(8, 14 - wiggle * 2, 12, 6, 0.6 - wiggle * 0.15, 0, Math.PI * 2);
          // Rear paddlers
          ctx.ellipse(-14, -10 + wiggle * 1, 7, 4, -0.3, 0, Math.PI * 2);
          ctx.ellipse(-14, 10 - wiggle * 1, 7, 4, 0.3, 0, Math.PI * 2);
          ctx.fill();

          // Turtle Head
          ctx.beginPath();
          ctx.ellipse(22, 0, 7, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (life.type === "dolphin") {
          ctx.fillStyle = "#4b5563"; // dolphin sleeks grey
          ctx.strokeStyle = "#374151";
          ctx.lineWidth = 2;

          // Main body streamline
          ctx.beginPath();
          ctx.moveTo(35, 0);
          ctx.quadraticCurveTo(15, -12, -15, -4);
          ctx.quadraticCurveTo(-30, wiggle * 4, -35, wiggle * 6); // tail wiggle
          ctx.quadraticCurveTo(-15, 10, 15, 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Flippers
          ctx.beginPath();
          ctx.ellipse(5, 5, 12, 4, 0.4, 0, Math.PI * 2);
          ctx.ellipse(5, -5, 12, 4, -0.4, 0, Math.PI * 2);
          // Dorsal top fin
          ctx.moveTo(-5, -7);
          ctx.quadraticCurveTo(-12, -18, -18, -12);
          ctx.lineTo(-10, -5);
          ctx.fill();
        } else if (life.type === "jellyfish") {
          // Pulsing cap dome
          const pulse = 1 + Math.sin(Date.now() * 0.007) * 0.12;

          ctx.fillStyle = "rgba(244, 114, 182, 0.45)"; // glowing pink jellies
          ctx.strokeStyle = "rgba(244, 114, 182, 0.9)";
          ctx.lineWidth = 2;

          ctx.beginPath();
          ctx.arc(0, 0, 16 * pulse, Math.PI, 0);
          ctx.lineTo(16 * pulse, 3);
          ctx.quadraticCurveTo(0, 8 * pulse, -16 * pulse, 3);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Tentacles trailing wavy
          ctx.strokeStyle = "rgba(244, 114, 182, 0.65)";
          ctx.lineWidth = 1.2;
          for (let i = -10; i <= 10; i += 5) {
            ctx.beginPath();
            ctx.moveTo(i * pulse, 6);
            ctx.bezierCurveTo(
              i * pulse + wiggle * 3, 14,
              i * pulse - wiggle * 3, 26,
              i * pulse + wiggle * 4, 38
            );
            ctx.stroke();
          }
        } else if (life.type === "ray") {
          // Stingray body diamond shapes
          ctx.fillStyle = "#334155";
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 2;

          const flap = Math.sin(Date.now() * 0.009) * 5;

          ctx.beginPath();
          ctx.moveTo(25, 0); // Head snout
          ctx.quadraticCurveTo(5, -20 - flap, -15, -26); // Wing left flap
          ctx.quadraticCurveTo(-10, 0, -25, 0); // body back
          ctx.quadraticCurveTo(-10, 0, -15, 26); // Wing right flap
          ctx.quadraticCurveTo(5, 20 + flap, 25, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Tail whip long
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-25, 0);
          ctx.quadraticCurveTo(-45, wiggle * 6, -65, wiggle * 10);
          ctx.stroke();
        } else {
          // Clownfish body (Nemo style)
          ctx.fillStyle = "#f97316"; // bright orange
          ctx.strokeStyle = "#7c2d12";
          ctx.lineWidth = 1.8;

          // Body oval
          ctx.beginPath();
          ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // White stripes decals
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.ellipse(-2, 0, 4, 10, 0, 0, Math.PI * 2);
          ctx.ellipse(8, 0, 3, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          // Black border outline stripes
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(-2, 0, 4, 10, 0, 0, Math.PI * 2);
          ctx.stroke();

          // Waving tail fin
          ctx.fillStyle = "#ec4899"; // pink accents tail fin
          ctx.beginPath();
          ctx.moveTo(-15, 0);
          ctx.quadraticCurveTo(-24, -8 + wiggle * 3, -26, -11 + wiggle * 4);
          ctx.lineTo(-24, wiggle * 2);
          ctx.quadraticCurveTo(-24, 8 - wiggle * 3, -26, 11 - wiggle * 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      });

      // D. Draw Particles (bubbles, laser sparks)
      particlesRef.current.forEach((p) => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // E. DRAW THE ECOBOT CLEANUP SUBMARINE ROBOT
      ctx.save();
      ctx.translate(currentRobot.x, currentRobot.y);
      ctx.rotate(currentRobot.angle);

      // Draw LiDAR LiDAR scanning area cone sweep
      if (currentRobot.energy > 0) {
        ctx.save();
        const scanAngleWidth = 0.8;
        const scanGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, currentRobot.radarRange);
        scanGrad.addColorStop(0, "rgba(6, 182, 212, 0.45)");
        scanGrad.addColorStop(0.4, "rgba(6, 182, 212, 0.1)");
        scanGrad.addColorStop(1, "rgba(6, 182, 212, 0)");

        ctx.fillStyle = scanGrad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, currentRobot.radarRange, -scanAngleWidth / 2, scanAngleWidth / 2);
        ctx.closePath();
        ctx.fill();

        // Laser scan sweep line sweeps
        const laserAngle = Math.sin(Date.now() * 0.005) * (scanAngleWidth / 2);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(laserAngle) * currentRobot.radarRange, Math.sin(laserAngle) * currentRobot.radarRange);
        ctx.stroke();
        ctx.restore();
      }

      // Tractor grapple active lines to pulling debris
      updatedTrashList.forEach((trash) => {
        const dist = Math.hypot(trash.x - currentRobot.x, trash.y - currentRobot.y);
        if (trash.scanned && dist < 130 && currentRobot.cargo.length < currentRobot.maxCapacity && currentRobot.energy > 5) {
          // Draw lightning-like tractor beam connectors
          ctx.strokeStyle = "rgba(34, 211, 238, 0.75)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(10, 0);
          
          const segments = 4;
          for (let s = 1; s < segments; s++) {
            const ratio = s / segments;
            const rx = 10 + (trash.x - currentRobot.x - 10) * ratio;
            const ry = (trash.y - currentRobot.y) * ratio;
            // Add lightning noise perp vector
            const perpAngle = Math.atan2(trash.y - currentRobot.y, trash.x - currentRobot.x) + Math.PI / 2;
            const jitter = (Math.random() * 8 - 4);
            ctx.lineTo(
              rx + Math.cos(perpAngle) * jitter,
              ry + Math.sin(perpAngle) * jitter
            );
          }
          ctx.lineTo(trash.x - currentRobot.x, trash.y - currentRobot.y);
          ctx.stroke();
        }
      });

      // Draw Submarine Chassis body (Yellow cybernetic eco hull)
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#b45309";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Mechanical metal lines rivets
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 11, -0.6, 0.6);
      ctx.stroke();

      // Front Camera Lens Glass (Glowing cyan camera eye scans trash)
      ctx.fillStyle = currentRobot.energy > 0 ? "#22d3ee" : "#475569";
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(17, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glowing lens reflection dot
      if (currentRobot.energy > 0) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(19, -2, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Left Back Propeller Engine
      ctx.strokeStyle = "#475569";
      ctx.fillStyle = "#1e293b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(-28, -13, 8, 26);
      ctx.fill();
      ctx.stroke();

      // Rotating fin blades wiggles
      const spin = (Date.now() * 0.05) % (Math.PI * 2);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-28, -6);
      ctx.lineTo(-34, -6 + Math.sin(spin) * 6);
      ctx.moveTo(-28, 6);
      ctx.lineTo(-34, 6 + Math.cos(spin) * 6);
      ctx.stroke();

      // Eco Cargo bay indicator grid lights (red, orange, green based on fullness)
      const fillPercentage = currentRobot.cargo.length / currentRobot.maxCapacity;
      const lightColor = fillPercentage >= 1.0 ? "#ef4444" : fillPercentage >= 0.6 ? "#f97316" : "#22c55e";
      ctx.fillStyle = currentRobot.energy > 0 ? lightColor : "#475569";
      ctx.beginPath();
      ctx.arc(-8, -4, 3, 0, Math.PI * 2);
      ctx.arc(-8, 4, 3, 0, Math.PI * 2);
      ctx.fill();

      // Force Field defensive bubble overlay when low on battery or hit animals
      if (currentRobot.energy < 25 && currentRobot.energy > 0) {
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.2 + Math.sin(Date.now() * 0.01) * 0.15})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 32, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore(); // end of translated context relative to camera offsets

      ctx.restore(); // remove translated camera offsets

      // F. HUD Radar sonar coordinate grids on top right (Mini map relative HUD)
      // High-tech minimal local sonar sweep
      const hudRadarR = 45;
      const hudRadarX = dimensions.width - hudRadarR - 35;
      const hudRadarY = hudRadarR + 35;

      ctx.save();
      // HUD frame box
      ctx.fillStyle = "rgba(10, 18, 30, 0.8)";
      ctx.strokeStyle = "rgba(6, 182, 212, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(hudRadarX - hudRadarR - 10, hudRadarY - hudRadarR - 10, hudRadarR * 2 + 20, hudRadarR * 2 + 20);
      ctx.fill();
      ctx.stroke();

      // Sonar rings
      ctx.strokeStyle = "rgba(6, 182, 212, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hudRadarX, hudRadarY, hudRadarR, 0, Math.PI * 2);
      ctx.arc(hudRadarX, hudRadarY, hudRadarR * 0.6, 0, Math.PI * 2);
      ctx.arc(hudRadarX, hudRadarY, hudRadarR * 0.3, 0, Math.PI * 2);
      ctx.stroke();

      // Scanning line
      const localSweepAngle = (Date.now() * 0.0025) % (Math.PI * 2);
      ctx.strokeStyle = "rgba(6, 182, 212, 0.8)";
      ctx.beginPath();
      ctx.moveTo(hudRadarX, hudRadarY);
      ctx.lineTo(hudRadarX + Math.cos(localSweepAngle) * hudRadarR, hudRadarY + Math.sin(localSweepAngle) * hudRadarR);
      ctx.stroke();

      // Draw red dots for scanned trash and green dot for station on radar
      ctx.fillStyle = "rgba(22, 163, 74, 0.9)"; // Station
      const radarS_dx = ((currentStation.x - currentRobot.x) / MAP_LIMIT) * hudRadarR * 3;
      const radarS_dy = ((currentStation.y - currentRobot.y) / MAP_LIMIT) * hudRadarR * 3;
      const sx_clamp = Math.min(hudRadarR - 4, Math.max(-hudRadarR + 4, radarS_dx));
      const sy_clamp = Math.min(hudRadarR - 4, Math.max(-hudRadarR + 4, radarS_dy));
      ctx.beginPath();
      ctx.arc(hudRadarX + sx_clamp, hudRadarY + sy_clamp, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Trash dots
      ctx.fillStyle = "rgba(6, 182, 212, 0.9)";
      currentTrash.slice(0, 15).forEach((t) => {
        const r_dx = ((t.x - currentRobot.x) / MAP_LIMIT) * hudRadarR * 3;
        const r_dy = ((t.y - currentRobot.y) / MAP_LIMIT) * hudRadarR * 3;
        if (Math.hypot(r_dx, r_dy) < hudRadarR - 3) {
          ctx.beginPath();
          ctx.arc(hudRadarX + r_dx, hudRadarY + r_dy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Middle self robot dot pulsing
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(hudRadarX, hudRadarY, 3, 0, Math.PI * 2);
      ctx.fill();

      // Coordinates text
      ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
      ctx.font = "bold 8px font-mono, Courier New, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `POS: X(${Math.floor(currentRobot.x)}) Y(${Math.floor(currentRobot.y)})`,
        hudRadarX,
        hudRadarY + hudRadarR + 18
      );
      ctx.restore();

      animationId = requestAnimationFrame(gameLoop);
    };

    animationId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationId);
  }, [dimensions]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-slate-950 rounded-xl border border-slate-800">
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="block cursor-crosshair w-full h-full"
      />
      {/* Floating control overlays */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none">
        <div className="bg-slate-900/90 border border-slate-800/80 p-3 rounded-lg flex flex-col gap-1 select-none text-xs text-slate-400 font-sans pointer-events-auto">
          <div className="flex gap-2 items-center">
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded shadow-sm font-mono font-bold">W</kbd>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded shadow-sm font-mono font-bold">A</kbd>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded shadow-sm font-mono font-bold">S</kbd>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded shadow-sm font-mono font-bold">D</kbd>
            <span className="text-slate-300 font-semibold font-mono">로봇 제어 기동 (Thrust)</span>
          </div>
          <div className="text-[11px] text-cyan-400/90 flex items-center gap-1.5 mt-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            레이더 자율감지 장치가 수거 범위 내 쓰레기를 탐지합니다.
          </div>
        </div>

        <div className="text-right text-[11px] text-slate-500 bg-slate-900/40 p-2 rounded border border-slate-800/35 backdrop-blur-sm pointer-events-auto">
          MAP SIZE: 2400m x 2400m | ECO RECYCLE HUB: CENTER (1200, 1200)
        </div>
      </div>
    </div>
  );
};

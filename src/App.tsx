/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { Trash, TrashType, MarineLife, MarineLifeType, Upgrade, GameStats, AiLog, GeminiAnalysis } from "./types";
import { OceanCanvas } from "./components/OceanCanvas";
import { playDepositChime, playHazardAlarm, playSonarPing } from "./utils/audio";
import { 
  Bot, 
  Sparkles, 
  Recycle, 
  Zap, 
  ShieldAlert, 
  Coins, 
  TrendingUp, 
  Compass, 
  ShoppingBag, 
  ListRestart, 
  Trash2, 
  Play, 
  Volume2, 
  Anchor, 
  ShieldCheck, 
  HeartHandshake,
  Workflow, 
  Activity,
  Cpu,
  ChevronRight,
  HelpCircle,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const MAP_LIMIT = 2400;

const GARBAGE_TYPES: { type: TrashType; label: string; points: number; color: string }[] = [
  { type: "plastic_bottle", label: "페트병 (Plastic Bottle)", points: 15, color: "#22d3ee" },
  { type: "aluminum_can", label: "알루미늄 캔 (Aluminum Can)", points: 20, color: "#ef4444" },
  { type: "nylon_net", label: "수중 폐어망 (Discarded Net)", points: 40, color: "#a4b4c8" },
  { type: "pesticide_can", label: "독성 폐농약병 (Pesticide Container)", points: 55, color: "#eab308" },
  { type: "tire", label: "침적 폐타이어 (Marine Tire)", points: 30, color: "#64748b" },
];

const ANIMAL_SPECIES: { type: MarineLifeType; name: string; size: number; speed: number; color: string }[] = [
  { type: "turtle", name: "푸른 바다거북 (Green Sea Turtle)", size: 18, speed: 1.1, color: "#22c55e" },
  { type: "dolphin", name: "남방큰돌고래 (Indo-Pacific Bottlenose Dolphin)", size: 24, speed: 1.8, color: "#38bdf8" },
  { type: "jellyfish", name: "심해 해파리 (Deep Ocean Jellyfish)", size: 14, speed: 0.6, color: "#f472b6" },
  { type: "ray", name: "대왕 가오리 (Giant Manta Ray)", size: 22, speed: 1.3, color: "#475569" },
  { type: "clownfish", name: "흰동가리 군집 (Anemone Clownfish)", size: 10, speed: 1.5, color: "#f97316" },
];

export default function App() {
  const [isGameStarted, setIsGameStarted] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [showTutorial, setShowTutorial] = useState<boolean>(false);

  // Stats
  const [stats, setStats] = useState<GameStats>({
    score: 0,
    credits: 300, // start with shopping credits
    oilSpillCleared: 0,
    trashRecycled: 0,
    marineLifeInjuries: 0,
    totalRuns: 0,
  });

  // Upgrade lists
  const [upgrades, setUpgrades] = useState<Upgrade[]>([
    { id: "capacity", name: "저장용량 강화", description: "소형 보관함 크기를 증가하여 더 많은 잔해를 한 번에 운반합니다.", cost: 100, level: 1, maxLevel: 5, multiplier: 1 },
    { id: "speed", name: "제트 프로펠러", description: "수류를 뚫고 더 빠르게 기동하는 추진 추진 엔진을 장착합니다.", cost: 150, level: 1, maxLevel: 5, multiplier: 1 },
    { id: "radar", name: "LiDAR 레이더 소나", description: "쓰레기 원격 자동 스캔 감지 필터 범위를 한 차원 확장합니다.", cost: 120, level: 1, maxLevel: 5, multiplier: 1 },
  ]);

  // Robot dynamic state
  const [robot, setRobot] = useState({
    x: 1100,
    y: 1100,
    vx: 0,
    vy: 0,
    angle: 0,
    energy: 100,
    cargo: [] as Trash[],
    maxCapacity: 4,
    speedMultiplier: 1.0,
    radarRange: 160,
    autopilot: false,
  });

  // Dynamic entity structures
  const [trashList, setTrashList] = useState<Trash[]>([]);
  const [marineLifeList, setMarineLifeList] = useState<MarineLife[]>([]);
  const [aiLogs, setAiLogs] = useState<AiLog[]>([]);

  // Modals / Overlays
  const [showShop, setShowShop] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiAnalysis, setAiAnalysis] = useState<GeminiAnalysis | null>(null);
  const [trashForAnalysis, setTrashForAnalysis] = useState<Trash[]>([]);

  // Audio mute/unmute
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const [activeKeys, setActiveKeys] = useState<{ [key: string]: boolean }>({});
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      setActiveKeys(prev => ({ ...prev, [k]: true }));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      setActiveKeys(prev => ({ ...prev, [k]: false }));
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize Trash and Marine life on game startup
  useEffect(() => {
    generateInitialEntities();
    addAiLog("EcoBot v4.2 모듈 가동 성공. 해양정화 연동 준비 완료.", "info");
    addAiLog("LiDAR 소나 원격 쓰레기 자동 스펙트럼 식별 기술이 활성화되었습니다.", "ai");
    addAiLog("[지침: WASD 키로 이동하며 자동으로 대상을 탐색하십시오. Space키로 오토파일럿 자율제어로 전환가능]", "warning");
  }, []);

  // Set up upgrades dynamic variables when levels change
  useEffect(() => {
    const capacityLvl = upgrades.find(u => u.id === "capacity")?.level || 1;
    const speedLvl = upgrades.find(u => u.id === "speed")?.level || 1;
    const radarLvl = upgrades.find(u => u.id === "radar")?.level || 1;

    setRobot(prev => ({
      ...prev,
      maxCapacity: 3 + capacityLvl, // Level 1 is 4, Level 5 is 8
      speedMultiplier: 0.9 + speedLvl * 0.15,
      radarRange: 130 + radarLvl * 30, // Level 1 is 160, Level 5 is 280
    }));
  }, [upgrades]);

  // Keep logs scrolled down
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [aiLogs]);

  // Generate Initial Trash and Sea Animals
  const generateInitialEntities = () => {
    const freshTrash: Trash[] = [];
    const freshLife: MarineLife[] = [];

    // Create 32 garbage objects randomly spread
    for (let i = 0; i < 32; i++) {
      freshTrash.push(spawnRandomTrash(i.toString()));
    }

    // Create 15 marine animals spread across coordinates
    for (let k = 0; k < 15; k++) {
      freshLife.push(spawnRandomAnimal(k.toString()));
    }

    setTrashList(freshTrash);
    setMarineLifeList(freshLife);
  };

  const spawnRandomTrash = (id: string): Trash => {
    // Avoid spawning in the absolute center docking area (1200, 1200)
    let rx = Math.random() * (MAP_LIMIT - 160) + 80;
    let ry = Math.random() * (MAP_LIMIT - 160) + 80;
    while (Math.hypot(rx - 1200, ry - 1200) < 220) {
      rx = Math.random() * (MAP_LIMIT - 160) + 80;
      ry = Math.random() * (MAP_LIMIT - 160) + 80;
    }

    const typePreset = GARBAGE_TYPES[Math.floor(Math.random() * GARBAGE_TYPES.length)];
    return {
      id: `trash_${id}_${Date.now()}`,
      x: rx,
      y: ry,
      type: typePreset.type,
      scanned: false,
      scanProgress: 0,
      size: typePreset.type === "tire" ? 14 : typePreset.type === "pesticide_can" ? 11 : 8,
      label: typePreset.label,
      points: typePreset.points,
      color: typePreset.color,
    };
  };

  const spawnRandomAnimal = (id: string): MarineLife => {
    const rx = Math.random() * (MAP_LIMIT - 200) + 100;
    const ry = Math.random() * (MAP_LIMIT - 200) + 100;
    const species = ANIMAL_SPECIES[Math.floor(Math.random() * ANIMAL_SPECIES.length)];
    const angle = Math.random() * Math.PI * 2;

    return {
      id: `animal_${id}_${Date.now()}`,
      x: rx,
      y: ry,
      vx: Math.cos(angle) * species.speed,
      vy: Math.sin(angle) * species.speed,
      type: species.type,
      name: species.name,
      size: species.size,
      speed: species.speed,
      angle: angle,
      color: species.color,
      bubbleTimer: Math.floor(Math.random() * 120) + 30,
    };
  };

  // Autogenerate trash if map drops below 10 elements
  useEffect(() => {
    if (trashList.length < 12 && isGameStarted) {
      const extraTrash: Trash[] = [];
      const numToSpawn = 16;
      for (let i = 0; i < numToSpawn; i++) {
        extraTrash.push(spawnRandomTrash(`extra_${i}`));
      }
      setTrashList(prev => [...prev, ...extraTrash]);
      addAiLog("[LiDAR 스캔 업데이트]: 소나 그리드 분석 결과, 새 해상 고유 쓰레기 파편 지대가 감지되어 센서에 랭크되었습니다.", "ai");
    }
  }, [trashList, isGameStarted]);

  // Logging utility
  const addAiLog = (message: string, type: 'info' | 'warning' | 'success' | 'ai') => {
    const timeStr = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    setAiLogs(prev => [...prev, { timestamp: timeStr, type, message }].slice(-50)); // keep last 50 logs
  };

  // Accidental Sea Animal crash trigger
  const handleCollideMarineLife = (name: string) => {
    addAiLog(`[경고!!]: ${name} 충돌 위험 감지! 회피 추진 및 음파 보호막 기동!`, "warning");
    
    // Penalize score and battery
    setStats(prev => ({
      ...prev,
      marineLifeInjuries: prev.marineLifeInjuries + 1,
      score: Math.max(0, prev.score - 10),
    }));

    setRobot(prev => ({
      ...prev,
      energy: Math.max(0, prev.energy - 8),
    }));
  };

  // Toggle dynamic Autopilot
  const toggleAutopilot = () => {
    setRobot(prev => {
      const nextAuto = !prev.autopilot;
      addAiLog(
        nextAuto 
          ? "[AI 자율 기동 모드]: 자동 경로 분석 활성화. 잠재적 안전 역관계 회피 주행 및 근거리 폐기물 자율 수집을 진행합니다."
          : "[조종 제어 수동 변환]: 운전 제어 권한이 탑승자 조종실로 완전히 반환되었습니다.",
        "info"
      );
      return { ...prev, autopilot: nextAuto };
    });
  };

  // Deposit Cargo items into Recycle Base Station and call real server side Gemini API
  const handleDepositCargo = async (depositedItems: Trash[]) => {
    if (depositedItems.length === 0) return;

    playDepositChime();
    setTrashForAnalysis(depositedItems);
    setIsAnalyzing(true);
    addAiLog(`[에코 기지 도킹]: 쓰레기 ${depositedItems.length}개 적재 하역을 실시합니다. 실시간 스마트 에너지 충전 모듈 동작.`, "success");

    // Compute basic scoring immediately so the player feels gratification
    let runScore = 0;
    let runCredits = 0;
    depositedItems.forEach(t => {
      runScore += t.points;
      runCredits += Math.floor(t.points * 0.7);
    });

    setStats(prev => ({
      ...prev,
      score: prev.score + runScore,
      credits: prev.credits + runCredits,
      trashRecycled: prev.trashRecycled + depositedItems.length,
      totalRuns: prev.totalRuns + 1,
    }));

    // Trigger Server side Gemini AI environmental impact report
    try {
      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trashList: depositedItems.map(t => ({
            type: t.type,
            label: t.label,
            points: t.points,
          })),
        }),
      });

      const result = await response.json();
      if (result.data) {
        setAiAnalysis(result.data);
        addAiLog(`[AI 인텔리전스 통신 완료]: 충돌 예방 성과 분석 및 유기 화합물 해체 보고서 생성 완료.`, "ai");
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err: any) {
      console.error("AI Analysis error:", err);
      addAiLog(`[AI 경고]: 인텔리전스 위성 접속 중단 상태. 백업 프로세스로 해양 가치 분석을 출력합니다.`, "warning");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Buy Upgrades
  const buyUpgrade = (upgradeId: string) => {
    const upgrade = upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return;

    if (stats.credits < upgrade.cost) {
      addAiLog(`[상점 경고]: 소나 에너지 에코 크레딧이 부족합니다. (부족: ${upgrade.cost - stats.credits} Cr)`, "warning");
      return;
    }

    if (upgrade.level >= upgrade.maxLevel) {
      addAiLog(`[상점 알림]: 해당 하드웨어 업그레이드는 이미 독보적인 최대 출력 단계입니다.`, "info");
      return;
    }

    // Process Upgrade
    setStats(prev => ({
      ...prev,
      credits: prev.credits - upgrade.cost,
    }));

    setUpgrades(prev => prev.map(u => {
      if (u.id === upgradeId) {
        return {
          ...u,
          level: u.level + 1,
          cost: Math.floor(u.cost * 1.8), // Cost doubles almost
        };
      }
      return u;
    }));

    addAiLog(`[연구소 승인]: 로봇의 [${upgrade.name}] 사양이 Level ${upgrade.level + 1}로 신속하게 보강 구체화되었습니다!`, "success");
  };

  const closeAnalysisModal = () => {
    setAiAnalysis(null);
    setTrashForAnalysis([]);
  };

  // Total safe marine status percentage
  const marineSafetyScore = Math.max(0, 100 - (stats.marineLifeInjuries * 3));

  return (
    <div className="w-full min-h-screen bg-[#020d1a] text-[#a0e9ff] flex flex-col font-sans select-none overflow-x-hidden p-4 space-y-4 relative">
      
      {/* BACKGROUND GRAPHIC LINES */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(79,195,247,0.06)_0%,_transparent_75%)] pointer-events-none z-0" />
      <div className="absolute inset-0 opacity-5 pointer-events-none z-0" style={{ backgroundImage: "radial-gradient(#4fc3f7 1px, transparent 1px)", backgroundImageSize: "32px 32px" }}></div>

      {/* TOP HUD: SYSTEM STATUS (Exactly following the Geometric Balance design HTML spec) */}
      <div className="w-full grid grid-cols-1 md:grid-cols-4 gap-4 z-10 relative">
        {/* Card 1: Unit ID */}
        <div className="bg-[#041b2d] border border-[#1e4a6d] flex flex-col justify-center py-3.5 px-4 relative overflow-hidden">
          <span className="text-[9px] uppercase tracking-widest text-[#4fc3f7] opacity-60 font-mono">Unit ID // Core Spec</span>
          <div className="text-lg font-bold tracking-tighter font-mono flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#00ffcc] animate-pulse"></span>
            AQUABOT-ECO-X1
          </div>
          <div className="absolute top-0 right-0 w-1 h-full bg-[#4fc3f7]"></div>
        </div>

        {/* Card 2: Battery/Energy Level */}
        <div className="bg-[#041b2d] border border-[#1e4a6d] flex flex-col justify-center py-3.5 px-4 relative">
          <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-[#4fc3f7] opacity-60 font-mono mb-1">
            <span>Battery Level</span>
            <span className={robot.energy < 25 ? "text-red-400 animate-pulse font-bold" : "text-[#00ffcc]"}>
              {robot.energy.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`w-full h-2 bg-[#0a2e47] flex overflow-hidden border border-[#1e4a6d]/40 ${robot.energy < 25 ? "border-red-500/50" : ""}`}>
              <div 
                className={`h-full transition-all duration-150 ${robot.energy < 25 ? "bg-red-500 animate-pulse" : "bg-[#00ffcc]"}`} 
                style={{ width: `${robot.energy}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Card 3: Cargo Load */}
        <div className="bg-[#041b2d] border border-[#1e4a6d] flex flex-col justify-center py-3.5 px-4">
          <span className="text-[9px] uppercase tracking-widest text-[#4fc3f7] opacity-60 font-mono">Cargo Load Storage</span>
          <div className="text-lg font-bold font-mono text-[#a0e9ff] flex justify-between items-end">
            <span>{robot.cargo.length} / {robot.maxCapacity} <span className="text-xs opacity-50">KG</span></span>
            <span className="text-[9px] text-[#4fc3f7] font-semibold opacity-75">
              {robot.cargo.length >= robot.maxCapacity ? "[FULL]" : "READY"}
            </span>
          </div>
        </div>

        {/* Card 4: Mission Progress */}
        <div className="bg-[#041b2d] border border-[#1e4a6d] flex flex-col justify-center py-3.5 px-4 relative overflow-hidden">
          <span className="text-[9px] uppercase tracking-widest text-[#4fc3f7] opacity-60 font-mono">MISSION PARAMETERS</span>
          <div className="text-sm font-extrabold font-mono text-[#00ffcc] truncate uppercase flex justify-between tracking-tight">
            <span>ZONE B-4 {stats.score > 200 ? "CLEAR" : "ENGAGED"}</span>
            <span className="opacity-70 text-right text-[10px] text-[#a0e9ff]">{marineSafetyScore}% Safe</span>
          </div>
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#4fc3f7] to-transparent"></div>
        </div>
      </div>

      {/* MAIN INTERFACE GRID AREA */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 z-10 relative">
        
        {/* LEFT COLUMN: AI DETECTION LOG & TEAM STATS */}
        <div className="lg:col-span-1 flex flex-col space-y-4">
          
          {/* SYSTEM PERFORMANCE DETAILS CARD */}
          <div className="bg-[#041b2d] border border-[#1e4a6d] p-4 flex flex-col relative">
            <h3 className="text-[11px] font-bold border-b border-[#1e4a6d] pb-2 mb-3 tracking-[0.2em] uppercase text-[#4fc3f7] font-mono flex items-center justify-between">
              <span>Telemetry Indices</span>
              <Activity className="w-3.5 h-3.5 opacity-80" />
            </h3>
            
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-[#020d1a] border border-[#1e4a6d]/50 p-2.5">
                <span className="block text-[8px] text-[#4fc3f7] opacity-60 tracking-wider font-mono">ECO SCORE</span>
                <span className="text-base font-mono font-bold text-[#00ffcc]">{stats.score}</span>
              </div>
              <div className="bg-[#020d1a] border border-[#1e4a6d]/50 p-2.5 relative overflow-hidden">
                <span className="block text-[8px] text-[#4fc3f7] opacity-60 tracking-wider font-mono">ECO CREDITS</span>
                <span className="text-base font-mono font-bold text-[#ffeb3b] flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5 shrink-0" /> {stats.credits}
                </span>
                <span className="absolute bottom-0.5 right-1 text-[7px] opacity-40 font-mono">Cr</span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs font-mono text-[#a0e9ff]/90 border-t border-[#1e4a6d]/30 pt-3">
              <div className="flex justify-between">
                <span className="opacity-60">정화 완료 기동:</span>
                <span>{stats.totalRuns} 회</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">적재 가치 수거:</span>
                <span>{stats.trashRecycled} PCS</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">생명체 보호 사고:</span>
                <span className={stats.marineLifeInjuries > 0 ? "text-red-400 font-bold" : "text-[#00ffcc]"}>
                  {stats.marineLifeInjuries} 건 감지
                </span>
              </div>
            </div>
          </div>

          {/* AI NEURAL LOG (Exactly following left sidebar spec) */}
          <div className="flex-1 bg-[#041b2d] border border-[#1e4a6d] p-4 flex flex-col h-[280px] lg:h-auto overflow-hidden">
            <h3 className="text-[11px] font-bold border-b border-[#1e4a6d] pb-2 mb-3 tracking-[0.2em] uppercase text-[#4fc3f7] font-mono">
              AI Neural Engine Logs
            </h3>
            
            <div className="flex-1 overflow-y-auto space-y-2.5 font-mono text-[10px] bg-[#020d1a] p-3 border border-[#1e4a6d]/50 rounded mb-3 max-h-[180px] lg:max-h-[none] scrollbar-thin scrollbar-thumb-[#1e4a6d]">
              {aiLogs.length === 0 ? (
                <div className="text-slate-500 text-center py-6">
                  No telemetry feeds active...
                </div>
              ) : (
                aiLogs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-1 leading-snug text-left border-b border-blue-950/20 pb-1">
                    <span className="text-[#4fc3f7] opacity-50 shrink-0 font-light">[{log.timestamp}]</span>
                    <span className={
                      log.type === "warning" ? "text-red-400" :
                      log.type === "success" ? "text-[#00ffcc]" :
                      log.type === "ai" ? "text-cyan-400 font-bold" : "text-[#a0e9ff]"
                    }>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="p-2 bg-[#0a2e47] border border-[#1e4a6d] rounded">
              <div className="text-[9px] text-[#4fc3f7] font-mono leading-tight">
                SYS_LOG: NEURAL_PATH_OPTIMIZED<br/>
                THRUSTERS: ACTIVE_JET_PROPS<br/>
                TRASH_SENSORS: MULTI_SPECTRAL
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: TACTICAL GAME CANVAS MAP */}
        <div className="col-span-1 lg:col-span-2 flex flex-col space-y-3 h-[60vh] lg:h-auto min-h-[460px]">
          <div className="flex-1 bg-[#011627] border-2 border-[#1e4a6d] shadow-[inset_0_0_100px_rgba(0,184,212,0.25)] relative overflow-hidden flex flex-col">
            
            {/* Header telemetry feeds indicator */}
            <div className="bg-[#020d1a]/95 px-4 py-2 border-b border-[#1e4a6d] flex justify-between items-center text-[10px] font-mono text-[#4fc3f7]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#00ffcc] animate-ping" />
                <span className="font-bold tracking-widest text-[#00ffcc]">TACTICAL VIEWPORT // LIVE GRID</span>
              </div>
              <div className="flex gap-4 opacity-80">
                <span>RADAR SENSITIVITY: 1.0x</span>
                <span>SYNC RATE: 60Hz</span>
              </div>
            </div>

            {/* Ocean Interactive Game Stage container */}
            <div className="flex-1 relative overflow-hidden">
              <OceanCanvas
                robot={robot}
                onUpdateRobot={setRobot}
                trashList={trashList}
                onUpdateTrash={setTrashList}
                marineLifeList={marineLifeList}
                onUpdateMarineLife={setMarineLifeList}
                onAddAiLog={addAiLog}
                onCollideMarineLife={handleCollideMarineLife}
                onDeposit={handleDepositCargo}
                recycleStation={{ x: 1200, y: 1200, radius: 150 }}
              />

              {/* Offline backup overlay notice if no standard AI loaded */}
              {!process.env.GEMINI_API_KEY && (
                <div className="absolute top-2 left-2 bg-[#041b2d]/90 border border-amber-500/30 px-2 py-0.5 rounded text-[9px] text-amber-400 font-mono tracking-wider backdrop-blur-sm">
                  ★ LOCAL PREVIEW MODE ENABLED
                </div>
              )}
            </div>

            {/* Overlay HUD indicators in bottom of map */}
            <div className="absolute bottom-3 left-3 text-[10px] bg-[#041b2d]/95 p-2.5 border border-[#1e4a6d] space-y-1 font-mono pointer-events-none">
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 bg-[#4fc3f7]"></div>
                <span>TRASH DETECTED: {trashList.length} UNITS</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 bg-[#00e676]"></div>
                <span>MARINE BIO-LIFE: {marineLifeList.length} TARGETS</span>
              </div>
            </div>
            
            {/* Compass crosshair background layout overlay (Pointer events none) */}
            <div className="absolute inset-x-0 top-12 bottom-12 border-x border-[#1e4a6d]/5 pointer-events-none flex items-center justify-center">
              <div className="w-72 h-72 rounded-full border border-[#1e4a6d]/5 flex items-center justify-center">
                <div className="w-48 h-48 rounded-full border border-[#1e4a6d]/10"></div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CONTROLS, RADAR & HARDWARE SPEED UPGRADES */}
        <div className="lg:col-span-1 flex flex-col space-y-4">
          
          {/* HARDWARE PERFORMANCE SHOP (Display and buy inside sidebar) */}
          <div className="bg-[#041b2d] border border-[#1e4a6d] p-4 flex flex-col justify-between">
            <h3 className="text-[11px] font-bold border-b border-[#1e4a6d] pb-2 mb-3 tracking-[0.2em] uppercase text-[#4fc3f7] font-mono flex items-center justify-between">
              <span>Hardware Customizer</span>
              <Cpu className="w-3.5 h-3.5 text-[#00ffcc]" />
            </h3>
            
            <div className="space-y-3">
              {upgrades.map((u) => {
                const isMax = u.level >= u.maxLevel;
                const canAfford = stats.credits >= u.cost;
                
                return (
                  <div key={u.id} className="bg-[#020d1a]/80 p-2.5 border border-[#1e4a6d]/40 rounded relative overflow-hidden">
                    <div className="flex justify-between items-start mb-1 text-xs">
                      <div>
                        <strong className="text-white block font-sans text-[11px]">{u.name}</strong>
                        <span className="text-[9px] text-[#4fc3f7] font-mono">Lv. {u.level} / {u.maxLevel}</span>
                      </div>
                      <button
                        disabled={isMax || !canAfford}
                        onClick={() => buyUpgrade(u.id)}
                        className={`px-2 py-0.5 font-mono text-[9px] font-bold rounded border transition-all ${
                          isMax 
                            ? "bg-slate-900 border-slate-950 text-slate-500 cursor-not-allowed"
                            : !canAfford
                              ? "bg-slate-900/40 text-slate-400 border-[#1e4a6d]/30 cursor-not-allowed"
                              : "bg-[#041b2d] text-[#00ffcc] border-[#00ffcc]/40 hover:bg-[#00ffcc] hover:text-[#020d1a] hover:border-[#00ffcc]"
                        }`}
                      >
                        {isMax ? "MAX" : `+ ${u.cost}Cr`}
                      </button>
                    </div>
                    {/* Visual energy light level bars */}
                    <div className="flex gap-1 mt-1">
                      {Array.from({ length: u.maxLevel }).map((_, i) => (
                        <div 
                          key={i} 
                          className={`h-1 flex-1 ${
                            i < u.level 
                              ? "bg-[#00ffcc]" 
                              : "bg-[#0a2e47]"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center gap-2 mt-4 pt-2 border-t border-[#1e4a6d]/30">
              <button 
                onClick={() => setShowTutorial(true)}
                className="flex-1 py-1 px-2.5 bg-[#0a2e47] hover:bg-[#0c3757] text-[#4fc3f7] border border-[#1e4a6d] font-mono text-[10px] uppercase font-bold tracking-wider text-center"
              >
                조종실 매뉴얼
              </button>
              <button 
                onClick={() => toggleAutopilot()}
                className={`flex-1 py-1 px-2 text-[10px] font-bold font-mono tracking-wider text-center border uppercase ${
                  robot.autopilot
                    ? "bg-[#00ffcc]/10 text-[#00ffcc] border-[#00ffcc]/40 animate-pulse"
                    : "bg-[#020d1a] border-[#1e4a6d] text-[#4fc3f7] hover:bg-[#0a2e47]"
                }`}
              >
                {robot.autopilot ? "자율주행 On" : "자율주행 Off"}
              </button>
            </div>
          </div>

          {/* CONTROL INTERFACE KEYPAD (Exactly following right sidebar controls spec) */}
          <div className="bg-[#041b2d] border border-[#1e4a6d] p-4 flex flex-col">
            <h3 className="text-[11px] font-bold border-b border-[#1e4a6d] pb-2 mb-2 tracking-[0.2em] uppercase text-[#4fc3f7] font-mono">
              Control Interface
            </h3>
            
            <div className="flex flex-col items-center justify-center py-2 space-y-1.5 backdrop-blur-sm bg-black/10 rounded border border-[#1e4a6d]/20">
              {/* Row 1: W */}
              <div className={`w-11 h-11 border transition-all flex flex-col items-center justify-center text-xs font-bold font-mono ${
                activeKeys['w'] || activeKeys['arrowup']
                  ? "bg-[#4fc3f7] text-[#020d1a] border-white shadow-[0_0_12px_rgba(79,195,247,0.7)] scale-95"
                  : "bg-[#0a2e47] text-[#4fc3f7] border-[#103a5b]"
              }`}>
                <span className="text-[8px] opacity-70">W</span>
                ▲
              </div>
              {/* Row 2: A, S, D */}
              <div className="flex space-x-1.5">
                <div className={`w-11 h-11 border transition-all flex flex-col items-center justify-center text-xs font-bold font-mono ${
                  activeKeys['a'] || activeKeys['arrowleft']
                    ? "bg-[#4fc3f7] text-[#020d1a] border-white shadow-[0_0_12px_rgba(79,195,247,0.7)] scale-95"
                    : "bg-[#0a2e47] text-[#4fc3f7] border-[#103a5b]"
                }`}>
                  <span className="text-[8px] opacity-70">A</span>
                  ◀
                </div>
                <div className={`w-11 h-11 border transition-all flex flex-col items-center justify-center text-xs font-bold font-mono ${
                  activeKeys['s'] || activeKeys['arrowdown']
                    ? "bg-[#4fc3f7] text-[#020d1a] border-white shadow-[0_0_12px_rgba(79,195,247,0.7)] scale-95"
                    : "bg-[#0a2e47] text-[#4fc3f7] border-[#103a5b]"
                }`}>
                  <span className="text-[8px] opacity-70">S</span>
                  ▼
                </div>
                <div className={`w-11 h-11 border transition-all flex flex-col items-center justify-center text-xs font-bold font-mono ${
                  activeKeys['d'] || activeKeys['arrowright']
                    ? "bg-[#4fc3f7] text-[#020d1a] border-white shadow-[0_0_12px_rgba(79,195,247,0.7)] scale-95"
                    : "bg-[#0a2e47] text-[#4fc3f7] border-[#103a5b]"
                }`}>
                  <span className="text-[8px] opacity-70">D</span>
                  ▶
                </div>
              </div>
              <div className="mt-2 text-[9px] text-center text-[#4fc3f7] opacity-75 leading-tight font-mono">
                WASD / ARROW KEYS TO NAVIGATE ENGINE<br/>
                SPACE TO TOGGLE AUTOPILOT LOCK
              </div>
            </div>
          </div>

          {/* DYNAMIC BIODIVERSITY SAFE PROTECTION METER */}
          <div className="bg-[#041b2d] border border-[#1e4a6d] p-4 flex flex-col">
            <h3 className="text-[11px] font-bold border-b border-[#1e4a6d] pb-2 mb-3 tracking-[0.2em] uppercase text-[#ff8a65] font-mono flex items-center justify-between">
              <span>Biodiversity Radar</span>
              <HeartHandshake className="w-3.5 h-3.5 text-[#ff8a65]" />
            </h3>
            
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center bg-[#020d1a] p-2 border border-[#1e4a6d]/40">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#00e676] animate-pulse" />
                  <span className="text-[10px] text-slate-300">Green Sea Turtle</span>
                </div>
                <span className="text-[8px] font-mono text-[#00e676] bg-[#00e676]/10 px-1 rounded">SAFE SHIELD</span>
              </div>
              <div className="flex justify-between items-center bg-[#020d1a] p-2 border border-[#1e4a6d]/40">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-[10px] text-slate-300 font-sans">Bottlenose Dolphin</span>
                </div>
                <span className="text-[8px] font-mono text-cyan-400 bg-cyan-400/10 px-1 rounded">ECHO LOCATED</span>
              </div>
              <div className="flex justify-between items-center bg-[#020d1a] p-2 border border-[#1e4a6d]/40">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#ff3d00] animate-pulse" />
                  <span className="text-[10px] text-slate-300 font-sans">Giant Manta Ray</span>
                </div>
                <span className="text-[8px] font-mono text-[#ff8a65] bg-[#ff3d00]/10 px-1 rounded">NEAR RADIUS</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER: SYSTEMS LOG / GEOMETRIC DETAILS (Exactly following Footer HTML Spec) */}
      <footer className="h-12 w-full bg-[#041b2d] border border-[#1e4a6d] flex items-center px-4 lg:px-6 justify-between z-10 relative font-mono text-xs text-[#a0e9ff]/80">
        <div className="flex space-x-6 items-center text-[10px]">
          <div><span className="opacity-50 font-sans">LAT:</span> 24.4532° N</div>
          <div className="hidden sm:block"><span className="opacity-50 font-sans">LONG:</span> 118.2341° W</div>
          <div><span className="opacity-50 font-sans">DEPTH:</span> 128M SEC</div>
        </div>
        <div className="flex items-center space-x-2 text-[10px] font-bold text-[#00ffcc]">
          <div className="w-2 h-2 bg-[#00ffcc] rounded-full animate-ping"></div>
          <span>SYSTEMS ONLINE // AI_COGNITIVE_READY</span>
        </div>
      </footer>

      {/* MODAL 1: CHIP/UPGRADE LAB DRAWER */}
      <AnimatePresence>
        {showShop && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 text-left"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-lg shadow-2xl relative overflow-hidden"
            >
              {/* background green layout */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex justify-between items-start mb-4 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h3 className="font-bold text-slate-100 font-mono text-base">에코봇 기체 성능 연구소</h3>
                    <p className="text-[11px] text-slate-400">수거한 폐기물로 축적한 크레딧으로 하드웨어를 증설하십시오.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowShop(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-950 rounded-lg border border-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current Credits status */}
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 mb-6 flex items-center justify-between">
                <span className="text-xs text-slate-400">보유 에코 크레딧</span>
                <span className="text-lg font-bold font-mono text-emerald-400 flex items-center gap-1">
                  <Coins className="w-4.5 h-4.5" /> {stats.credits} <span className="text-xs text-slate-500">Cr</span>
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {upgrades.map((u) => {
                  const isMax = u.level >= u.maxLevel;
                  const canAfford = stats.credits >= u.cost;
                  
                  return (
                    <div key={u.id} className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/60 hover:border-slate-800 transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
                            {u.id === "capacity" && <Recycle className="w-4 h-4 text-cyan-400" />}
                            {u.id === "speed" && <Zap className="w-4 h-4 text-yellow-400" />}
                            {u.id === "radar" && <Compass className="w-4 h-4 text-pink-400" />}
                            {u.name}
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{u.description}</p>
                        </div>
                        <span className="font-mono text-xs font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          Lv.{u.level}
                        </span>
                      </div>

                      {/* level visual indicator blocks */}
                      <div className="flex gap-1 mb-4">
                        {Array.from({ length: u.maxLevel }).map((_, i) => (
                          <div 
                            key={i} 
                            className={`h-1.5 flex-1 rounded-full ${
                              i < u.level 
                                ? "bg-gradient-to-r from-emerald-500 to-teal-500" 
                                : "bg-slate-800"
                            }`}
                          />
                        ))}
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500">
                          {isMax ? "최대 사양에 근접" : `다음 단계: Lv.${u.level + 1}`}
                        </span>

                        <button
                          disabled={isMax || !canAfford}
                          onClick={() => buyUpgrade(u.id)}
                          className={`px-3 py-1.5 font-mono text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-all ${
                            isMax 
                              ? "bg-slate-900 text-slate-600 border-slate-950 cursor-not-allowed"
                              : !canAfford
                                ? "bg-slate-900/30 text-slate-500 border-slate-800/40 cursor-not-allowed"
                                : "bg-emerald-950/30 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500 hover:text-white"
                          }`}
                        >
                          {isMax ? (
                            "COMPLETED"
                          ) : (
                            <>
                              <Coins className="w-3.5 h-3.5" />
                              {u.cost} Cr 장착
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-[10px] text-slate-500 text-center mt-6">
                로봇 장착 모듈 사양은 드라이빙 기동 시 소나 실시간 처리 성능에 즉각 반영됩니다.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 2: GEMINI ENVIRONMENTAL DEEP DIAGNOSTICS REPORT */}
      <AnimatePresence>
        {(isAnalyzing || aiAnalysis) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 text-left"
          >
            <motion.div 
              initial={{ scale: 0.94, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 30 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-2xl shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500" />

              {/* 1. LOADING PROCESS SCREEN */}
              {isAnalyzing ? (
                <div className="py-12 flex flex-col items-center justify-center gap-6 text-center">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-cyan-400 border-r-emerald-400 border-b-teal-400 border-l-slate-800 animate-spin" />
                    <Bot className="w-7 h-7 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-bold font-mono text-slate-100 text-base">Gemini 해양 에코 브레인 분석 가동 중</h3>
                    <p className="text-xs text-slate-400 mt-2 max-w-sm">수거된 잔해 고분자 분광 분석 정보 및 해양 보존 생물 다양성 교차 예방 보고서를 안전하게 실시간 수집 가공 중입니다...</p>
                  </div>
                  <div className="w-full max-w-xs space-y-1 bg-slate-950 p-3 rounded border border-slate-800 text-[10px] text-cyan-500 font-mono">
                    <div className="animate-pulse">▶ CONNECTING INTEL-GEN INTERACTION AT SATELLITE...</div>
                    <div className="text-slate-600">[SCANNING MOLECULES DEBRIS INFRASTRUCTURE]</div>
                  </div>
                </div>
              ) : (
                /* 2. COMPLETED DYNAMIC AI ECO REPORT SCREEN */
                <div className="flex flex-col gap-4 overflow-hidden">
                  <div className="flex justify-between items-start border-b border-slate-800 pb-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-cyan-400" />
                      <div>
                        <span className="text-[10px] text-cyan-400 font-bold font-mono block">GEMINI ECO DIAGNOSTICS REPORT</span>
                        <h3 className="font-extrabold text-slate-100 text-lg font-sans">
                          {aiAnalysis?.title || "새로운 에코 시스템 분석"}
                        </h3>
                      </div>
                    </div>
                    <button 
                      onClick={() => closeAnalysisModal()}
                      className="p-1 px-3 text-slate-100 bg-emerald-900/60 border border-emerald-500/30 hover:bg-emerald-800 rounded-lg text-xs font-mono"
                    >
                      보고서 승인닫기
                    </button>
                  </div>

                  {/* Main Scrollable Report Body */}
                  <div className="flex-1 overflow-y-auto pr-1 space-y-4 text-xs leading-relaxed text-slate-300">
                    
                    {/* Environmental impacts */}
                    <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-[11px] font-bold text-cyan-400 tracking-wider font-mono flex items-center gap-1.5 uppercase mb-2">
                        <Trash2 className="w-4 h-4 text-cyan-400" /> 수거 폐기물 대기 분해 및 환경 소모 영향
                      </h4>
                      <p className="text-slate-300 text-xs mb-3 font-sans break-words whitespace-pre-line leading-relaxed">
                        {aiAnalysis?.environmentalImpact}
                      </p>
                      
                      {/* Recycled list display */}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/50">
                        <span className="text-[10px] text-slate-500 self-center">수거 하역된 원료:</span>
                        {trashForAnalysis.map((t, index) => (
                          <span key={index} className="text-[10px] px-2 py-0.5 bg-slate-900 border border-slate-800 rounded font-mono text-cyan-400">
                            {t.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Species Protected benefit report */}
                    <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                      <h4 className="text-[11px] font-bold text-pink-400 tracking-wider font-mono flex items-center gap-1.5 uppercase mb-2">
                        <ShieldCheck className="w-4 h-4 text-pink-400" /> 서식 구조 내 해양 보존 보호 성과
                      </h4>
                      <p className="text-slate-300 text-xs break-words whitespace-pre-line leading-relaxed">
                        {aiAnalysis?.speciesProtected}
                      </p>
                    </div>

                    {/* Fun facts section */}
                    <div className="bg-gradient-to-r from-emerald-950/20 to-cyan-950/20 p-4 rounded-xl border border-emerald-500/10">
                      <h4 className="text-[11px] font-bold text-emerald-400 tracking-wider font-mono flex items-center gap-1.5 uppercase mb-1">
                        <Bot className="w-4 h-4 text-emerald-400" /> AI 해양 보존 상식 브리핑
                      </h4>
                      <p className="text-slate-300 text-xs italic">
                        &ldquo;{aiAnalysis?.facts}&rdquo;
                      </p>
                    </div>

                    {/* Robot cybernetic upgrades */}
                    <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Cpu className="w-4 h-4 text-amber-400" />
                        <h4 className="text-[11px] font-bold text-amber-400 tracking-wider font-mono uppercase">
                          AI 추천 차세대 장갑 개수 승인안
                        </h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {aiAnalysis?.roboticUpgradeSuggestions?.map((item, idx) => (
                          <div key={idx} className="bg-slate-900/60 p-2.5 rounded border border-slate-800 text-[11px] text-slate-300 flex items-start gap-1.5 leading-tight">
                            <span className="text-amber-500 shrink-0 font-mono">[{idx + 1}]</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ECO KUDOS ENCOURAGEMENTS */}
                    <div className="bg-cyan-950/15 border border-cyan-500/10 p-3 rounded-lg text-center font-mono text-[11px] text-cyan-400">
                      {aiAnalysis?.kudos}
                    </div>
                  </div>

                  <div className="shrink-0 pt-2 border-t border-slate-800 flex justify-end gap-3 items-center">
                    <span className="text-[10px] text-slate-500">지표 성과 자동 마그네틱 인쇄 완료.</span>
                    <button
                      onClick={() => closeAnalysisModal()}
                      className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-mono text-xs font-bold rounded-lg hover:from-cyan-500 hover:to-teal-500 transition-all shadow-md cursor-pointer"
                    >
                      ECO-SYSTEM CONFIRM
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 3: INSTRUCTIONS / TUTORIAL POPUP */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 text-left font-sans"
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-lg shadow-2xl relative"
            >
              <div className="flex justify-between items-start mb-4 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5 text-cyan-400">
                  <Compass className="w-5 h-5 animate-spin" />
                  <h3 className="font-bold text-slate-100 font-mono text-base">에코봇 조종실 운행 기밀서</h3>
                </div>
                <button 
                  onClick={() => setShowTutorial(false)}
                  className="p-1 px-2.5 text-xs text-slate-400 hover:text-slate-100 bg-slate-950 rounded border border-slate-800"
                >
                  닫기
                </button>
              </div>

              <div className="space-y-4 text-xs leading-relaxed text-slate-300">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <h4 className="font-bold text-slate-100 mb-1 flex items-center gap-1">
                    <Workflow className="w-3.5 h-3.5 text-cyan-400" /> AI 자율 주행 모드
                  </h4>
                  <p className="text-slate-400 leading-normal">
                    자율주행 모드를 켜면 AI가 가장 가까운 해양 쓰레기를 추적하여 유도 경로를 계산 수집하고 조종사 간편 투기를 실행합니다. 수영하는 바다생물을 만나면 <strong className="text-emerald-400">자동 벡터 회피 중력 기동</strong>을 하여 안전하게 거리를 우회합니다!
                  </p>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <h4 className="font-bold text-slate-100 mb-1 flex items-center gap-1">
                    <Recycle className="w-3.5 h-3.5 text-emerald-400" /> 초록색 리사이클 센터 기지
                  </h4>
                  <p className="text-slate-400 leading-normal">
                    수집한 쓰레기를 싣고 화면 중앙의 점선 영역 <span className="text-emerald-400 font-bold">ECO RECYCLE HUB</span>로 되비치면 화물이 자동 하역되어 소화 분석을 개시합니다. 기지 내에서는 <span className="text-yellow-400 font-bold">원격 배터리가 실시간 충전</span>됩니다.
                  </p>
                </div>

                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <h4 className="font-bold text-slate-100 mb-1 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-pink-400" /> 생물 충전 방출 위험성 경고
                  </h4>
                  <p className="text-slate-400 leading-normal">
                    물고기, 어미 거북, 남방 돌고래 등과 직접적으로 충돌 시 <span className="text-red-400 font-bold font-mono">기체 배터리와 보존 안전 점수</span>가 강하게 차감됩니다! 수동 주행 하실 때 조향에 신사적으로 성의를 취해주십시오.
                  </p>
                </div>
              </div>

              <div className="mt-5 text-center">
                <button
                  onClick={() => setShowTutorial(false)}
                  className="px-5 py-2 bg-slate-950 border border-slate-800 text-cyan-400 hover:text-white hover:bg-slate-800 transition-all rounded-lg font-mono text-xs cursor-pointer"
                >
                  해독 완료, 임무 투입
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from "motion/react";
import { 
  Beaker, Shield, Zap, RefreshCw, AlertCircle, FlaskConical, 
  Play, Info, Settings, Trophy, Skull, Activity, 
  ChevronRight, ChevronLeft, Home, Lock
} from "lucide-react";
import { ELEMENTS, COMPOUNDS, TUTORIAL_STAGES, REACTIONS } from './data';
import { ElementData, CompoundData, Tower, Enemy, Projectile, Stage, Reaction, Particle } from './types';

// Constants
const CELL_SIZE = 100;
const GRID_COLS = 12;
const GRID_ROWS = 8;
const CANVAS_WIDTH = GRID_COLS * CELL_SIZE;
const CANVAS_HEIGHT = GRID_ROWS * CELL_SIZE;

// Helper to get atomic radius
const getAtomicRadius = (symbol: string) => {
  const radii: Record<string, number> = {
    H: 15, He: 16, Li: 30, Be: 25, B: 20, C: 17, N: 16, O: 15, F: 14, Ne: 15,
    Na: 38, Mg: 32, Al: 28, Si: 26, P: 24, S: 22, Cl: 20, Ar: 18,
    K: 45, Ca: 40, Cs: 45
  };
  return radii[symbol] || 25;
};

export default function App() {
  // Game State
  const [mode, setMode] = useState<'main-menu' | 'mode-menu' | 'tutorial' | 'survival' | 'gameover' | 'clear'>('main-menu');
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [money, setMoney] = useState(500);
  const [health, setHealth] = useState(20);
  const [wave, setWave] = useState(1);
  const [gameTime, setGameTime] = useState(0);
  const [selectedElement, setSelectedElement] = useState<ElementData | null>(null);
  const [draggingElement, setDraggingElement] = useState<ElementData | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isPaused, setIsPaused] = useState(false);
  const [unlockedStages, setUnlockedStages] = useState<number>(1);
  const [unlockedElements, setUnlockedElements] = useState<string[]>(["H", "O"]);
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showReward, setShowReward] = useState(false);
  const [lastReward, setLastReward] = useState<{ elements: string[], money: number } | null>(null);

  // Editor State
  const [editorMode, setEditorMode] = useState(false);
  const [versionClicks, setVersionClicks] = useState(0);
  const [localCompounds, setLocalCompounds] = useState<Record<string, CompoundData>>(COMPOUNDS);
  const [localElements, setLocalElements] = useState<Record<string, ElementData>>(ELEMENTS);
  const [editEnemyId, setEditEnemyId] = useState<string>('H2');
  const [editTowerId, setEditTowerId] = useState<string>('H');

  const handleVersionClick = () => {
    const newClicks = versionClicks + 1;
    setVersionClicks(newClicks);
    if (newClicks >= 5) {
      setEditorMode(!editorMode);
      setVersionClicks(0);
      addLog(`Editor Mode: ${!editorMode ? 'ACTIVATED' : 'DEACTIVATED'}`);
    }
  };

  // Grid State (Blocked cells)
  const gridRef = useRef<boolean[][]>(Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(false)));

  // A* Pathfinding
  const findPath = useCallback((startPos: { x: number; y: number }, endPos: { x: number; y: number }) => {
    const startGridX = Math.floor(startPos.x / CELL_SIZE);
    const startGridY = Math.floor(startPos.y / CELL_SIZE);
    const endGridX = Math.floor(endPos.x / CELL_SIZE);
    const endGridY = Math.floor(endPos.y / CELL_SIZE);

    // Clamp values
    const start = { x: Math.max(0, Math.min(GRID_COLS - 1, startGridX)), y: Math.max(0, Math.min(GRID_ROWS - 1, startGridY)) };
    const end = { x: Math.max(0, Math.min(GRID_COLS - 1, endGridX)), y: Math.max(0, Math.min(GRID_ROWS - 1, endGridY)) };

    const openSet = [{ ...start, g: 0, h: Math.abs(start.x - end.x) + Math.abs(start.y - end.y), parent: null as any }];
    const closedSet = new Set<string>();

    while (openSet.length > 0) {
      openSet.sort((a, b) => (a.g + a.h) - (b.g + b.h));
      const current = openSet.shift()!;

      if (current.x === end.x && current.y === end.y) {
        const path = [];
        let curr = current;
        while (curr) {
          path.push({ x: curr.x * CELL_SIZE + CELL_SIZE / 2, y: curr.y * CELL_SIZE + CELL_SIZE / 2 });
          curr = curr.parent;
        }
        return path.reverse();
      }

      closedSet.add(`${current.x},${current.y}`);

      const neighbors = [
        { x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }
      ];

      for (const neighbor of neighbors) {
        if (neighbor.x < 0 || neighbor.x >= GRID_COLS || neighbor.y < 0 || neighbor.y >= GRID_ROWS) continue;
        if (gridRef.current[neighbor.y][neighbor.x]) continue;
        if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;

        const g = current.g + 1;
        const h = Math.abs(neighbor.x - end.x) + Math.abs(neighbor.y - end.y);
        const existing = openSet.find(o => o.x === neighbor.x && o.y === neighbor.y);

        if (!existing || g < existing.g) {
          if (existing) {
            existing.g = g;
            existing.parent = current;
          } else {
            openSet.push({ ...neighbor, g, h, parent: current });
          }
        }
      }
    }
    return null; // No path found
  }, []);

  // Refs for game objects (to avoid state re-renders for every frame)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enemiesRef = useRef<Enemy[]>([]);
  const towersRef = useRef<Tower[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Audio/Visual Feedback
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 5));
  };

  // Initialize Game
  const startGame = (gameMode: 'tutorial' | 'survival', stageIdx = 0) => {
    setMode(gameMode);
    setCurrentStageIndex(stageIdx);
    setMoney(gameMode === 'tutorial' ? 1000 : 500);
    setHealth(20);
    setWave(1);
    towersRef.current = [];
    enemiesRef.current = [];
    projectilesRef.current = [];
    gridRef.current = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(false));
    setIsPaused(false);
    
    if (gameMode === 'tutorial') {
      setShowGuide(true);
    }
    
    addLog(`System Initialized: ${gameMode.toUpperCase()} Mode`);
  };

  const finishStage = () => {
    if (mode === 'tutorial') {
      const stage = TUTORIAL_STAGES[currentStageIndex];
      const nextUnlocked = Math.max(unlockedStages, currentStageIndex + 2);
      setUnlockedStages(nextUnlocked);
      
      // Extract element reward if any
      const rewardMatch = stage.reward.match(/Unlock ([A-Z][a-z]?)/);
      const newElements = rewardMatch ? [rewardMatch[1]] : [];
      if (newElements.length > 0) {
        setUnlockedElements(prev => Array.from(new Set([...prev, ...newElements])));
      }
      
      setLastReward({ elements: newElements, money: 100 });
      setMoney(m => m + 100);
      setMode('clear');
      setShowReward(true);
    }
  };

  const spawnParticles = (x: number, y: number, color: string, count: number = 10, text?: string) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        life: 1.0,
        color,
        size: 2 + Math.random() * 4,
        text: i === 0 ? text : undefined
      });
    }
  };

  const spawnEnemy = useCallback((compoundId: string, pathType: 'top' | 'left' = 'left') => {
    if (enemiesRef.current.length >= 10) return; // Max 10 enemies on screen
    const compound = COMPOUNDS[compoundId] || COMPOUNDS['H2'];
    addLog(`DANGER: ${compound.displayName} Leak Detected!`);
    const id = Math.random().toString(36).substr(2, 9);
    
    const stage = mode === 'tutorial' ? TUTORIAL_STAGES[currentStageIndex] : null;
    
    // Path generation: A* based
    let startX, startY, endX, endY;
    
    if (stage) {
      startX = stage.sourcePos.x;
      startY = stage.sourcePos.y;
      endX = CANVAS_WIDTH + 50;
      endY = startY;
    } else {
      if (pathType === 'left') {
        startX = -50;
        startY = CANVAS_HEIGHT / 2;
        endX = CANVAS_WIDTH + 50;
        endY = CANVAS_HEIGHT / 2;
      } else {
        startX = CANVAS_WIDTH / 2;
        startY = -50;
        endX = CANVAS_WIDTH / 2;
        endY = CANVAS_HEIGHT + 50;
      }
    }

    const path = findPath(
      { x: Math.max(0, Math.min(CANVAS_WIDTH - 1, startX)), y: Math.max(0, Math.min(CANVAS_HEIGHT - 1, startY)) }, 
      { x: Math.max(0, Math.min(CANVAS_WIDTH - 1, endX)), y: Math.max(0, Math.min(CANVAS_HEIGHT - 1, endY)) }
    );
    
    if (!path) return; // Should not happen if placement is validated

    const enemy: Enemy = {
      id,
      x: startX,
      y: startY,
      health: 100 + (wave * 20),
      maxHealth: 100 + (wave * 20),
      bondEnergy: compoundId === 'H2' ? 50 : 0,
      maxBondEnergy: compoundId === 'H2' ? 50 : 0,
      speed: 0.8 + (wave * 0.05),
      compound,
      path,
      pathIndex: 0,
      radius: 30 + Math.random() * 20,
      debuffs: []
    };
    enemiesRef.current.push(enemy);
  }, [wave, findPath, mode, currentStageIndex]);

  const spawnEnemyAt = (compoundId: string, x: number, y: number) => {
    if (enemiesRef.current.length >= 10) return; // Max 10 enemies on screen
    const compound = COMPOUNDS[compoundId] || COMPOUNDS['H2'];
    const id = Math.random().toString(36).substr(2, 9);
    
    const path = findPath({ x, y }, { x: CANVAS_WIDTH - 1, y });

    const enemy: Enemy = {
      id,
      x,
      y,
      health: 150,
      maxHealth: 150,
      bondEnergy: 0,
      maxBondEnergy: 0,
      speed: 1.0,
      compound,
      path: path || [{ x, y }, { x: CANVAS_WIDTH + 50, y }],
      pathIndex: 0,
      radius: 40,
      debuffs: []
    };
    enemiesRef.current.push(enemy);
  };

  const handleEnemyDeath = (enemy: Enemy, reward: number = 25) => {
    const enemyIdx = enemiesRef.current.findIndex(e => e.id === enemy.id);
    if (enemyIdx > -1) {
      setMoney(m => m + reward);
      spawnParticles(enemy.x, enemy.y, '#ffcc00', 15, `+${reward}G`);
      
      // Special Transformation Logic (Ionization / Decomposition)
      if (enemy.compound.id === 'H2SO4_D' || enemy.compound.id === 'H2SO4_F') {
        addLog("DEHYDRATION: H2SO4 -> HSO4- (Splitting)");
        spawnEnemyAt('HSO4-', enemy.x, enemy.y);
      } else if (enemy.compound.id === 'HSO4-') {
        addLog("IONIZATION: HSO4- -> SO42-");
        spawnEnemyAt('SO42-', enemy.x, enemy.y);
      } else if (enemy.compound.id === 'HCl') {
        addLog("IONIZATION: HCl -> H+ + Cl-");
        spawnEnemyAt('H', enemy.x - 10, enemy.y);
        spawnEnemyAt('Cl', enemy.x + 10, enemy.y);
      } else if (enemy.compound.id === 'HF') {
        addLog("IONIZATION: HF -> H+ + F-");
        spawnEnemyAt('H', enemy.x - 10, enemy.y);
        spawnEnemyAt('F', enemy.x + 10, enemy.y);
      }

      enemiesRef.current.splice(enemyIdx, 1);
    }
  };

  // Game Loop
  const update = (time: number) => {
    if (isPaused) {
      requestRef.current = requestAnimationFrame(update);
      return;
    }

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;

    setGameTime(t => t + 1);

    // Update Particles
    particlesRef.current.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      // Add gravity if it's water (blue)
      if (p.color === '#3498db') {
        p.vy += 0.1;
      }
      p.life -= 0.02;
      if (p.life <= 0) particlesRef.current.splice(i, 1);
    });

    // 1. Update Enemies
    enemiesRef.current.forEach((enemy, index) => {
      // Handle Debuffs
      let currentSpeed = enemy.speed;
      enemy.debuffs.forEach((d, di) => {
        if (d.type === 'paralysis') currentSpeed *= 0.5;
        if (d.type === 'toxic' || d.type === 'penetration') enemy.health -= 0.1;
        d.duration -= 1;
        if (d.duration <= 0) enemy.debuffs.splice(di, 1);
      });

      if (enemy.health <= 0) {
        handleEnemyDeath(enemy);
        return;
      }

      const target = enemy.path[enemy.pathIndex + 1];
      if (!target) return;

      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 5) {
        enemy.pathIndex++;
        if (enemy.pathIndex >= enemy.path.length - 1) {
          // Reached end
          setHealth(h => h - 1);
          enemiesRef.current.splice(index, 1);
          return;
        }
      } else {
        enemy.x += (dx / dist) * currentSpeed;
        enemy.y += (dy / dist) * currentSpeed;
      }
    });

    // 2. Update Towers (Firing & Equipment)
    towersRef.current.forEach(tower => {
      // Equipment Logic
      if (tower.element.name === 'FAN') {
        enemiesRef.current.forEach(enemy => {
          const dx = enemy.x - tower.x;
          const dy = enemy.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < tower.element.range) {
            // Push back
            enemy.x += (dx / dist) * 1.5;
            enemy.y += (dy / dist) * 1.5;
            // Also reduce path index if possible to "push back" along path
            if (enemy.pathIndex > 0) enemy.pathIndex -= 0.05;
          }
        });
        return;
      }

      if (tower.element.name === 'HEATER') {
        towersRef.current.forEach(otherTower => {
          if (otherTower.id === tower.id) return;
          const dx = otherTower.x - tower.x;
          const dy = otherTower.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < tower.element.range) {
            // Buff nearby towers (handled in firing logic below)
          }
        });
        return;
      }

      // Check for Heater Buff
      let fireRateMultiplier = 1;
      towersRef.current.forEach(otherTower => {
        if (otherTower.element.name === 'HEATER') {
          const dx = otherTower.x - tower.x;
          const dy = otherTower.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < otherTower.element.range) {
            fireRateMultiplier = 1.5;
          }
        }
      });

      if (time - tower.lastFired > 1000 / (tower.element.fireRate * fireRateMultiplier)) {
        // Find target
        const target = enemiesRef.current.find(e => {
          const dx = e.x - tower.x;
          const dy = e.y - tower.y;
          return Math.sqrt(dx * dx + dy * dy) < tower.element.range;
        });

        if (target) {
          // Check for Reaction (Special immediate reactions)
          const reaction = REACTIONS.find(r => 
            (r.reactant1 === target.compound.id && r.reactant2 === tower.element.name) ||
            (r.reactant2 === target.compound.id && r.reactant1 === tower.element.name)
          );

          if (reaction) {
            addLog(`${reaction.type.toUpperCase()}: ${reaction.reactant1} + ${reaction.reactant2} -> ${reaction.product}`);
            if (reaction.description) addLog(reaction.description);
            
            if (reaction.product && COMPOUNDS[reaction.product]) {
              const x = target.x;
              const y = target.y;
              handleEnemyDeath(target, reaction.gold);
              spawnEnemyAt(reaction.product, x, y);
            } else {
              handleEnemyDeath(target, reaction.gold);
            }
            tower.lastFired = time;
            return;
          }

          projectilesRef.current.push({
            id: Math.random().toString(),
            x: tower.x,
            y: tower.y,
            targetId: target.id,
            damage: tower.element.baseDmg,
            speed: 5,
            element: tower.element.name
          });
          tower.lastFired = time;
        }
      }
    });

    // 3. Update Projectiles
    projectilesRef.current.forEach((p, index) => {
      const target = enemiesRef.current.find(e => e.id === p.targetId);
      if (!target) {
        projectilesRef.current.splice(index, 1);
        return;
      }

      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < target.radius) {
        // Hit
        let finalDamage = p.damage;
        
        // Check for Reaction
        const reaction = REACTIONS.find(r => 
          (r.reactant1 === target.compound.id && r.reactant2 === p.element) ||
          (r.reactant2 === target.compound.id && r.reactant1 === p.element)
        );

        if (reaction) {
          addLog(`${reaction.type.toUpperCase()}: ${reaction.reactant1} + ${reaction.reactant2} -> ${reaction.product}`);
          if (reaction.description) addLog(reaction.description);
          
          const productData = reaction.product ? COMPOUNDS[reaction.product] : null;
          const isWater = reaction.product === 'H2O';
          const particleColor = isWater ? '#3498db' : (reaction.type === 'Combustion' ? '#ffffff' : '#00ffff');
          const particleText = isWater ? 'WATER!' : reaction.type.toUpperCase();
          
          spawnParticles(target.x, target.y, particleColor, 30, particleText);
          if (reaction.type === 'Combustion') {
            // Add some steam/smoke
            spawnParticles(target.x, target.y, 'rgba(255,255,255,0.5)', 15);
          }

          // Reaction usually destroys the enemy or transforms it
          if (productData && !productData.isNeutral) {
            const x = target.x;
            const y = target.y;
            handleEnemyDeath(target, reaction.gold);
            spawnEnemyAt(reaction.product!, x, y);
          } else {
            // Neutralized or no product
            handleEnemyDeath(target, reaction.gold);
          }
          projectilesRef.current.splice(index, 1);
          return;
        }

        // Same Element Penalty (0.2x)
        if (p.element === target.compound.primaryAtom) {
          finalDamage *= 0.2;
          target.radius = Math.min(60, target.radius + 0.5); // Grow slightly
          addLog(`PENALTY: Same element (${p.element}) - Damage reduced!`);
          spawnParticles(target.x, target.y, '#ff4444', 5, 'RESIST');
        }

        if (p.element === 'H' && target.compound.id === 'H2') {
          // H tower reduces bond energy of H2
          target.bondEnergy -= p.damage; // Use base damage for bond stress
          addLog(`BOND STRESS: H2 Bond Energy at ${Math.max(0, Math.round(target.bondEnergy))}`);
          addLog("H TOWER: Stressing H2 bonds... Use O TOWER for combustion!");
          
          if (target.bondEnergy <= 0) {
            addLog("DECOMPOSITION: H2 -> 2H (Atoms Split)");
            spawnParticles(target.x, target.y, '#3498db', 20, 'SPLIT!');
            const x = target.x;
            const y = target.y;
            handleEnemyDeath(target);
            spawnEnemyAt('H', x - 10, y);
            spawnEnemyAt('H', x + 10, y);
            projectilesRef.current.splice(index, 1);
            return;
          }
        } else {
          target.health -= finalDamage;
        }
        
        // Apply Element Specific Effects
        if (p.element === 'Cl') {
          target.debuffs.push({ type: 'toxic', duration: 100 });
        } else if (p.element === 'S') {
          target.debuffs.push({ type: 'paralysis', duration: 50 });
        } else if (p.element === 'F') {
          // HF penetration effect - extra damage over time
          target.debuffs.push({ type: 'penetration', duration: 150 });
        }

        projectilesRef.current.splice(index, 1);
        
        if (target.health <= 0) {
          handleEnemyDeath(target);
        }
      } else {
        p.x += (dx / dist) * p.speed;
        p.y += (dy / dist) * p.speed;
      }
    });

    // 4. Enemy Interactions (Mixed Leak Logic)
    if (mode === 'tutorial' && currentStageIndex === 8) { // TUT-09
      for (let i = 0; i < enemiesRef.current.length; i++) {
        for (let j = i + 1; j < enemiesRef.current.length; j++) {
          const e1 = enemiesRef.current[i];
          const e2 = enemiesRef.current[j];
          const dx = e1.x - e2.x;
          const dy = e1.y - e2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 30) {
            // Check for HCl + NH3 reaction
            if ((e1.compound.id === 'HCl' && e2.compound.id === 'NH3') || 
                (e1.compound.id === 'NH3' && e2.compound.id === 'HCl')) {
              addLog("REACTION: HCl + NH3 -> NH4Cl (Solid Particle Spawned)");
              const midX = (e1.x + e2.x) / 2;
              const midY = (e1.y + e2.y) / 2;
              enemiesRef.current.splice(j, 1);
              enemiesRef.current.splice(i, 1);
              spawnEnemyAt('NH4Cl', midX, midY);
              break;
            }
          }
        }
      }
    }

    // 4. Wave Management
    if (enemiesRef.current.length === 0 && mode !== 'main-menu' && mode !== 'mode-menu' && !isPaused) {
      if (mode === 'tutorial') {
        const stage = TUTORIAL_STAGES[currentStageIndex];
        // Tutorial logic: spawn specific enemy
        if (wave < 5) {
          addLog(`WAVE ${wave} COMPLETE! SPAWNING NEXT...`);
          for (let i = 0; i < 3; i++) {
            setTimeout(() => spawnEnemy(stage.enemyId), i * 1500);
          }
          setWave(w => w + 1);
        } else {
          // Check Clear Condition
          if (stage.clearCondition === 'defeat_all') {
            finishStage();
          } else if (stage.clearCondition === 'survive_time' && gameTime > 3600) { // 60 seconds at 60fps
            finishStage();
          } else if (stage.clearCondition === 'reach_gold' && money >= 5000) {
            finishStage();
          }
        }
      } else {
        // Survival logic
        setWave(w => w + 1);
        const survivalEnemies = ['H2', 'Cl2', 'HCl', 'NH3', 'HF', 'H2S', 'H2SO4_D', 'COCl2', 'MIXED'];
        for (let i = 0; i < wave + 2; i++) {
          const maxIdx = Math.min(wave, survivalEnemies.length);
          const enemyId = survivalEnemies[Math.floor(Math.random() * maxIdx)];
          setTimeout(() => spawnEnemy(enemyId, Math.random() > 0.5 ? 'top' : 'left'), i * 1000);
        }
      }
    }

    // 5. Game Over Check
    if (health <= 0) {
      setMode('gameover');
    }

    draw();
    requestRef.current = requestAnimationFrame(update);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Background based on Stage
    const stage = mode === 'tutorial' ? TUTORIAL_STAGES[currentStageIndex] : null;
    if (stage) {
      // Background Image (Placeholder)
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw a subtle industrial floor pattern
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 2;
      for (let i = 0; i < CANVAS_WIDTH; i += 50) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_HEIGHT); ctx.stroke();
      }
      for (let i = 0; i < CANVAS_HEIGHT; i += 50) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(CANVAS_WIDTH, i); ctx.stroke();
      }

      // Draw Source (Tank/Truck/Factory)
      const { x, y, type } = stage.sourcePos;
      
      // Shadow
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      
      if (type === 'tank') {
        // Tank Body
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(x - 40, y - 60, 80, 120);
        // Tank Top
        ctx.fillStyle = '#34495e';
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.fill();
        // Pipes
        ctx.strokeStyle = '#7f8c8d';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x + 40, y);
        ctx.lineTo(x + 60, y);
        ctx.stroke();
      } else if (type === 'truck') {
        // Truck Body
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(x - 60, y - 30, 120, 60);
        // Cabin
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(x + 20, y - 25, 40, 50);
        // Wheels
        ctx.fillStyle = '#141414';
        ctx.beginPath(); ctx.arc(x - 40, y + 35, 15, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 40, y + 35, 15, 0, Math.PI * 2); ctx.fill();
      } else {
        // Factory
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(x - 50, y - 50, 100, 100);
        // Chimneys
        ctx.fillStyle = '#34495e';
        ctx.fillRect(x - 40, y - 80, 20, 40);
        ctx.fillRect(x + 20, y - 80, 20, 40);
        // Windows
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(x - 30, y - 20, 15, 15);
        ctx.fillRect(x + 15, y - 20, 15, 15);
      }
      
      ctx.shadowBlur = 0;
      
      // Draw Exit (Drain/Vent)
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH - 50, y, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00FF00';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Label
      ctx.fillStyle = '#00FF00';
      ctx.font = 'bold 10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText("CONTAINMENT ZONE", CANVAS_WIDTH - 50, y + 80);
    }

    // Draw Grid (One cell per tower)
    ctx.strokeStyle = 'rgba(228, 227, 224, 0.2)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += CELL_SIZE) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += CELL_SIZE) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Draw Blocked Cells (Towers)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (gridRef.current[r][c]) {
          ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    // Draw Towers
    towersRef.current.forEach(t => {
      const radius = getAtomicRadius(t.element.name);
      
      // Base
      if (t.id === selectedTowerId) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00FF00';
      }
      ctx.fillStyle = t.id === selectedTowerId ? 'rgba(0, 255, 0, 0.2)' : 'rgba(20, 20, 20, 0.8)';
      ctx.strokeStyle = t.id === selectedTowerId ? '#00FF00' : '#E4E3E0';
      ctx.lineWidth = t.id === selectedTowerId ? 3 : 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Atom / Obstacle
      if (t.element.type === 'tower') {
        ctx.fillStyle = t.element.reactionType === 'Burst' ? '#FF4444' : '#00FF00';
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Symbol
        ctx.fillStyle = '#141414';
        ctx.font = 'bold 14px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.element.name, t.x, t.y);
      } else {
        // Obstacle (Glassware)
        ctx.fillStyle = '#3498db';
        ctx.fillRect(t.x - 30, t.y - 30, 60, 60);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x - 30, t.y - 30, 60, 60);
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(t.element.name, t.x, t.y);
      }

      // Draw Range & Orbital Electrons
      if (t.id === selectedTowerId || selectedElement?.name === t.element.name || (draggingElement?.name === t.element.name)) {
        ctx.strokeStyle = `${t.element.reactionType === 'Burst' ? '#FF4444' : '#00FF00'}44`;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.element.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Orbiting Electrons (Atomic Number based)
        const rotation = Date.now() / 1000;
        const electrons = t.element.atomicNumber || 1;
        ctx.fillStyle = t.element.reactionType === 'Burst' ? '#FF4444' : '#00FF00';
        for (let i = 0; i < electrons; i++) {
          const angle = rotation + (i * Math.PI * 2 / electrons);
          const ex = t.x + Math.cos(angle) * t.element.range;
          const ey = t.y + Math.sin(angle) * t.element.range;
          ctx.beginPath();
          ctx.arc(ex, ey, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // Draw Placement Ghost (Dragging or Selected)
    const activeElement = draggingElement || selectedElement;
    if (activeElement) {
      const snapX = Math.floor(mousePos.x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
      const snapY = Math.floor(mousePos.y / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
      const gridX = Math.floor(mousePos.x / CELL_SIZE);
      const gridY = Math.floor(mousePos.y / CELL_SIZE);
      
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = gridRef.current[gridY]?.[gridX] ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(snapX, snapY, 45, 0, Math.PI * 2);
      ctx.fill();
      
      if (activeElement.type === 'tower') {
        ctx.fillStyle = activeElement.reactionType === 'Burst' ? '#FF4444' : '#00FF00';
        ctx.beginPath();
        ctx.arc(snapX, snapY, getAtomicRadius(activeElement.name), 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(snapX, snapY, activeElement.range, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Obstacle Ghost
        ctx.fillStyle = '#3498db';
        ctx.fillRect(snapX - 30, snapY - 30, 60, 60);
      }
      
      // Predicted Path Visualization
      if (gridRef.current[gridY] && gridRef.current[gridY][gridX] === false) {
        gridRef.current[gridY][gridX] = true;
        const stage = mode === 'tutorial' ? TUTORIAL_STAGES[currentStageIndex] : null;
        const startX = stage ? stage.sourcePos.x : 0;
        const startY = stage ? stage.sourcePos.y : CANVAS_HEIGHT / 2;
        const testPath = findPath({ x: startX, y: startY }, { x: CANVAS_WIDTH - 1, y: startY });
        
        if (testPath) {
          ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)';
          ctx.setLineDash([10, 10]);
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          testPath.forEach(p => ctx.lineTo(p.x, p.y));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        gridRef.current[gridY][gridX] = false;
      }
      
      ctx.globalAlpha = 1.0;
    }

    // Draw Leaks (Enemies)
    enemiesRef.current.forEach(e => {
      // Color based on primary atom or compound
      let color = '#E4E3E0';
      if (e.compound.id === 'H2') color = '#3498db';
      else if (e.compound.id === 'Cl2') color = '#27ae60';
      else if (e.compound.id === 'HCl') color = '#f1c40f';
      else if (e.compound.id === 'NH3') color = '#9b59b6';
      else if (e.compound.id === 'HF') color = '#e67e22';
      
      // Pulse effect for danger
      const pulse = 1 + Math.sin(Date.now() / 200) * 0.05;
      
      ctx.save();
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Inner Glow
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Hazard Label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(e.compound.displayName, e.x, e.y - e.radius - 25);
      
      if (e.compound.hazard) {
        ctx.fillStyle = '#FF4444';
        ctx.font = 'bold 8px Inter';
        ctx.fillText(e.compound.hazard.toUpperCase(), e.x, e.y - e.radius - 35);
      }

      // Health Bar
      const barWidth = 40;
      ctx.fillStyle = '#333';
      ctx.fillRect(e.x - barWidth/2, e.y - e.radius - 10, barWidth, 4);
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(e.x - barWidth/2, e.y - e.radius - 10, barWidth * (e.health / e.maxHealth), 4);

      // Bond Energy Bar (if H2)
      if (e.compound.id === 'H2' && e.bondEnergy > 0) {
        ctx.fillStyle = '#3498db';
        ctx.fillRect(e.x - barWidth/2, e.y - e.radius - 16, barWidth * (e.bondEnergy / e.maxBondEnergy), 4);
      }

      // Label
      ctx.fillStyle = '#141414';
      ctx.font = '10px Inter';
      ctx.fillText(e.compound.name, e.x, e.y);
    });

    // Draw Projectiles
    projectilesRef.current.forEach(p => {
      ctx.fillStyle = '#00FF00';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      
      if (p.text) {
        ctx.font = 'bold 14px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y - 10);
      }
    });
    ctx.globalAlpha = 1.0;
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestRef.current);
  }, [mode, isPaused, currentStageIndex]);

  const sellTower = () => {
    if (!selectedTowerId) return;

    const towerIndex = towersRef.current.findIndex(t => t.id === selectedTowerId);
    if (towerIndex === -1) return;

    const tower = towersRef.current[towerIndex];
    const gridX = Math.floor(tower.x / CELL_SIZE);
    const gridY = Math.floor(tower.y / CELL_SIZE);

    // Refund money (50%)
    const refund = Math.floor(tower.element.cost / 2);
    setMoney(m => m + refund);
    
    // Remove from grid
    gridRef.current[gridY][gridX] = false;
    
    // Remove from towers
    towersRef.current.splice(towerIndex, 1);
    
    setSelectedTowerId(null);
    addLog(`Sold ${tower.element.elementName} for ${refund} credits.`);

    // Recalculate all enemy paths
    enemiesRef.current.forEach(enemy => {
      const newPath = findPath({ x: enemy.x, y: enemy.y }, { x: CANVAS_WIDTH - 1, y: enemy.y });
      if (newPath) {
        enemy.path = newPath;
        enemy.pathIndex = 0;
      }
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
    setMousePos({ x, y });
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;

    const gridX = Math.floor(x / CELL_SIZE);
    const gridY = Math.floor(y / CELL_SIZE);

    if (editorMode) {
      gridRef.current[gridY][gridX] = !gridRef.current[gridY][gridX];
      addLog(`Editor: Toggled Grid [${gridX}, ${gridY}] to ${gridRef.current[gridY][gridX] ? 'BLOCKED' : 'EMPTY'}`);
      return;
    }

    const towerX = gridX * CELL_SIZE + CELL_SIZE / 2;
    const towerY = gridY * CELL_SIZE + CELL_SIZE / 2;

    const clickedTower = towersRef.current.find(t => t.x === towerX && t.y === towerY);
    if (clickedTower) {
      setSelectedTowerId(clickedTower.id);
      setSelectedElement(null);
      return;
    }

    // If an element is selected in sidebar, try to place it
    if (selectedElement) {
      // Check if occupied
      if (gridRef.current[gridY][gridX]) {
        addLog("PLACEMENT FAILED: Location occupied!");
        return;
      }

      // Pathblocking Check
      gridRef.current[gridY][gridX] = true;
      const stage = mode === 'tutorial' ? TUTORIAL_STAGES[currentStageIndex] : null;
      const startX = stage ? stage.sourcePos.x : 0;
      const startY = stage ? stage.sourcePos.y : CANVAS_HEIGHT / 2;
      const testPath = findPath({ x: startX, y: startY }, { x: CANVAS_WIDTH - 1, y: startY });
      
      if (!testPath) {
        gridRef.current[gridY][gridX] = false;
        addLog("PLACEMENT FAILED: Path would be completely blocked!");
        return;
      }

      if (money >= selectedElement.cost) {
        towersRef.current.push({
          id: Math.random().toString(),
          x: towerX,
          y: towerY,
          element: selectedElement,
          lastFired: 0,
          level: 1
        });
        setMoney(m => m - selectedElement.cost);
        addLog(`Deployed ${selectedElement.elementName} at [${gridX}, ${gridY}]`);
        
        // Recalculate all enemy paths
        enemiesRef.current.forEach(enemy => {
          const newPath = findPath({ x: enemy.x, y: enemy.y }, { x: CANVAS_WIDTH - 1, y: enemy.y });
          if (newPath) {
            enemy.path = newPath;
            enemy.pathIndex = 0;
          }
        });
      } else {
        gridRef.current[gridY][gridX] = false;
        addLog("INSUFFICIENT CREDITS");
      }
      return;
    }

    setSelectedTowerId(null);
  };

  const handleCanvasMouseUp = (e: React.MouseEvent) => {
    if (!draggingElement) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;

    const gridX = Math.floor(x / CELL_SIZE);
    const gridY = Math.floor(y / CELL_SIZE);

    // Check if occupied
    if (gridRef.current[gridY][gridX]) {
      setDraggingElement(null);
      return;
    }

    // Pathblocking Check
    gridRef.current[gridY][gridX] = true;
    
    // Check if spawn to exit is still possible
    const stage = mode === 'tutorial' ? TUTORIAL_STAGES[currentStageIndex] : null;
    const startX = stage ? stage.sourcePos.x : 0;
    const startY = stage ? stage.sourcePos.y : CANVAS_HEIGHT / 2;
    
    const testPath = findPath({ x: startX, y: startY }, { x: CANVAS_WIDTH - 1, y: startY });
    
    if (!testPath) {
      gridRef.current[gridY][gridX] = false; // Revert
      addLog("PLACEMENT FAILED: Path would be completely blocked!");
      setDraggingElement(null);
      return;
    }

    if (money >= draggingElement.cost) {
      const towerX = gridX * CELL_SIZE + CELL_SIZE / 2;
      const towerY = gridY * CELL_SIZE + CELL_SIZE / 2;
      
      towersRef.current.push({
        id: Math.random().toString(),
        x: towerX,
        y: towerY,
        element: draggingElement,
        lastFired: 0,
        level: 1
      });
      setMoney(m => m - draggingElement.cost);
      addLog(`Deployed ${draggingElement.elementName} at [${gridX}, ${gridY}]`);
      
      // Recalculate all enemy paths
      enemiesRef.current.forEach(enemy => {
        const newPath = findPath({ x: enemy.x, y: enemy.y }, { x: CANVAS_WIDTH - 1, y: enemy.y });
        if (newPath) {
          enemy.path = newPath;
          enemy.pathIndex = 0;
        }
      });
    } else {
      gridRef.current[gridY][gridX] = false; // Revert if not enough money
    }
    setDraggingElement(null);
  };

  // Touch support for mobile
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!draggingElement) return;
    const touch = e.touches[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((touch.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((touch.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
    setMousePos({ x, y });
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!draggingElement) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gridX = Math.floor(mousePos.x / CELL_SIZE);
    const gridY = Math.floor(mousePos.y / CELL_SIZE);

    if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS) {
      setDraggingElement(null);
      return;
    }

    if (gridRef.current[gridY][gridX]) {
      setDraggingElement(null);
      return;
    }

    // Pathblocking Check
    gridRef.current[gridY][gridX] = true;
    const stage = mode === 'tutorial' ? TUTORIAL_STAGES[currentStageIndex] : null;
    const startX = stage ? stage.sourcePos.x : 0;
    const startY = stage ? stage.sourcePos.y : CANVAS_HEIGHT / 2;

    const testPath = findPath({ x: startX, y: startY }, { x: CANVAS_WIDTH - 1, y: startY });
    
    if (!testPath) {
      gridRef.current[gridY][gridX] = false;
      addLog("PLACEMENT FAILED: Path blocked!");
      setDraggingElement(null);
      return;
    }

    if (money >= draggingElement.cost) {
      const towerX = gridX * CELL_SIZE + CELL_SIZE / 2;
      const towerY = gridY * CELL_SIZE + CELL_SIZE / 2;
      
      towersRef.current.push({
        id: Math.random().toString(),
        x: towerX,
        y: towerY,
        element: draggingElement,
        lastFired: 0,
        level: 1
      });
      setMoney(m => m - draggingElement.cost);
      
      enemiesRef.current.forEach(enemy => {
        const newPath = findPath({ x: enemy.x, y: enemy.y }, { x: CANVAS_WIDTH - 1, y: enemy.y });
        if (newPath) {
          enemy.path = newPath;
          enemy.pathIndex = 0;
        }
      });
    } else {
      gridRef.current[gridY][gridX] = false;
    }
    setDraggingElement(null);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Handled by sidebar buttons for initiating drag
  };

  return (
    <div className="min-h-screen bg-[#141414] text-[#E4E3E0] font-sans selection:bg-[#E4E3E0] selection:text-[#141414] overflow-hidden touch-none">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-[#141414] border-b border-[#E4E3E0]/10 flex items-center justify-between px-8 z-50">
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#00FF00] rounded-sm flex items-center justify-center">
              <Beaker className="w-5 h-5 text-[#141414]" />
            </div>
            <span className="font-black tracking-tighter text-xl uppercase italic">CHEMI-DEFENSE</span>
          </div>
          {mode !== 'main-menu' && mode !== 'mode-menu' && (
            <div className="flex items-center gap-8 text-xs font-mono uppercase tracking-widest">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#00FF00]" />
                <span>Health: <span className="text-[#00FF00] font-bold">{health}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>Energy: <span className="text-yellow-500 font-bold">{money}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-blue-500" />
                <span>Protocol: <span className="text-blue-500 font-bold">WAVE {wave}/5</span></span>
              </div>
              <div className="flex items-center gap-2">
                <Skull className="w-4 h-4 text-red-500" />
                <span>Containment: <span className="text-red-500 font-bold">ACTIVE LEAKS {enemiesRef.current.length}/10</span></span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {mode !== 'main-menu' && mode !== 'mode-menu' && (
            <button 
              onClick={() => setIsPaused(!isPaused)}
              className="p-2 hover:bg-[#E4E3E0]/10 rounded-full transition-colors"
              title={isPaused ? "Resume" : "Pause"}
            >
              {isPaused ? <Play className="w-5 h-5" /> : <RefreshCw className="w-5 h-5" />}
            </button>
          )}
          {mode !== 'main-menu' && (
            <button 
              onClick={() => {
                if (mode === 'mode-menu') {
                  setMode('main-menu');
                } else {
                  setMode('mode-menu');
                  setIsPaused(true);
                }
              }}
              className="px-4 py-2 border border-[#E4E3E0]/20 text-xs uppercase tracking-widest hover:bg-[#E4E3E0] hover:text-[#141414] transition-all"
            >
              {mode === 'mode-menu' ? 'Exit to Title' : 'Abort Mission'}
            </button>
          )}
        </div>
      </header>

      {/* Main Game Area */}
      <main className="relative w-full h-screen flex items-center justify-center pt-16">
        <AnimatePresence mode="wait">
          {mode === 'main-menu' && (
            <motion.div 
              key="main-menu"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center space-y-12"
            >
              <div className="space-y-4">
                <h1 className="text-8xl font-black italic uppercase tracking-tighter leading-none">
                  CHEMI<br/><span className="text-[#00FF00]">DEFENSE</span>
                </h1>
                <p className="text-xl opacity-50 uppercase tracking-[0.5em]">Molecular Containment Protocol</p>
              </div>
              
                <div className="flex flex-col gap-4 max-w-xs mx-auto">
                  <button 
                    onClick={() => setMode('mode-menu')}
                    className="py-4 bg-[#00FF00] text-[#141414] font-black uppercase tracking-widest hover:bg-[#00FF00]/80 transition-all flex items-center justify-center gap-3"
                  >
                    <Play className="w-5 h-5" />
                    Start Operation
                  </button>
                  <button 
                    onClick={() => addLog("Settings menu not implemented in this prototype.")}
                    className="py-4 border border-[#E4E3E0]/20 font-black uppercase tracking-widest hover:bg-[#E4E3E0] hover:text-[#141414] transition-all flex items-center justify-center gap-3"
                  >
                    <Settings className="w-5 h-5" />
                    Configuration
                  </button>
                </div>
                <p 
                  onClick={handleVersionClick}
                  className="mt-8 cursor-pointer text-[#444] text-[10px] uppercase tracking-widest hover:text-[#00FF00] transition-colors"
                >
                  v0.37 (Edit Mode: 5 clicks)
                </p>
            </motion.div>
          )}

          {mode === 'mode-menu' && (
            <motion.div 
              key="mode-menu"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-3 gap-8 p-8"
            >
              {/* Tutorial Selection */}
              <div className="lg:col-span-2 space-y-6">
                <div className="flex justify-between items-end">
                  <h2 className="text-4xl font-black italic uppercase tracking-tighter">Tutorial Stages</h2>
                  <span className="text-xs opacity-50 font-mono uppercase tracking-widest">Progress: {unlockedStages - 1}/10</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                  {TUTORIAL_STAGES.map((stage, idx) => (
                    <button
                      key={stage.id}
                      disabled={idx + 1 > unlockedStages}
                      onClick={() => startGame('tutorial', idx)}
                      className={`p-4 border text-left flex justify-between items-center transition-all group ${
                        idx + 1 <= unlockedStages 
                        ? 'border-[#E4E3E0]/20 hover:border-[#00FF00] hover:bg-[#00FF00]/5' 
                        : 'border-[#E4E3E0]/5 opacity-30 cursor-not-allowed'
                      }`}
                    >
                      <div>
                        <div className="text-[10px] uppercase tracking-widest opacity-50">{stage.id}</div>
                        <div className="font-bold uppercase tracking-tight">{stage.title}</div>
                      </div>
                      {idx + 1 <= unlockedStages ? <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /> : <Lock className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Survival / Shop / Stats */}
              <div className="space-y-6">
                <div className="border-2 border-[#00FF00] p-8 bg-[#00FF00]/5 space-y-4">
                  <h3 className="text-2xl font-black uppercase italic">Survival Mode</h3>
                  <p className="text-sm opacity-70 leading-relaxed">
                    Endless waves of chemical leaks. Manage resources and build a robust defense network.
                  </p>
                  <button 
                    onClick={() => startGame('survival')}
                    className="w-full py-4 bg-[#00FF00] text-[#141414] font-black uppercase tracking-widest hover:bg-[#00FF00]/80 transition-all"
                  >
                    Initiate Protocol
                  </button>
                </div>
                
                <div className="border border-[#E4E3E0]/10 p-6 space-y-4">
                  <h3 className="text-xl font-black uppercase italic">Global Lab</h3>
                  <p className="text-[10px] opacity-50 uppercase tracking-widest">Unlock new elements and equipment</p>
                  <button 
                    onClick={() => addLog("Global Lab (Shop) will be available in the full version.")}
                    className="w-full py-3 border border-yellow-500/50 text-yellow-500 text-xs font-black uppercase tracking-widest hover:bg-yellow-500/10 transition-all"
                  >
                    Access Shop
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-[#E4E3E0]/10 p-4 text-center">
                    <div className="text-3xl font-black">{unlockedElements.length}</div>
                    <div className="text-[10px] uppercase tracking-widest opacity-50">Unlocked</div>
                  </div>
                  <div className="border border-[#E4E3E0]/10 p-4 text-center">
                    <div className="text-3xl font-black">{unlockedStages - 1}</div>
                    <div className="text-[10px] uppercase tracking-widest opacity-50">Cleared</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {(mode === 'tutorial' || mode === 'survival') && (
            <motion.div 
              key="game"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-4 p-4 h-full w-full"
            >
              {/* Left Sidebar: Tower Selection */}
              <div className="w-64 flex flex-col gap-4">
                <div className="border border-[#E4E3E0]/10 p-4 bg-[#1a1a1a]">
                  <div className="text-[10px] uppercase tracking-widest opacity-50 mb-4">Available Assets</div>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.values(ELEMENTS).filter(e => e.isPlayable && (mode === 'survival' ? unlockedElements.includes(e.name) : TUTORIAL_STAGES[currentStageIndex].givenTowers.includes(e.name))).map(el => (
                      <button
                        key={el.name}
                        onClick={() => {
                          setSelectedElement(el);
                          setSelectedTowerId(null);
                        }}
                        onMouseDown={() => {
                          setDraggingElement(el);
                          setSelectedElement(el);
                          setSelectedTowerId(null);
                        }}
                        onTouchStart={() => {
                          setDraggingElement(el);
                          setSelectedElement(el);
                          setSelectedTowerId(null);
                        }}
                        className={`aspect-square border flex flex-col items-center justify-center transition-all cursor-grab active:cursor-grabbing ${
                          selectedElement?.name === el.name 
                          ? 'border-[#00FF00] bg-[#00FF00]/10' 
                          : 'border-[#E4E3E0]/10 hover:border-[#E4E3E0]/40'
                        }`}
                      >
                        <span className="text-lg font-bold">{el.name}</span>
                        <span className="text-[8px] opacity-50">{el.atomicNumber > 0 ? el.atomicNumber : 'OBJ'}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {selectedElement && (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="border border-[#00FF00]/30 p-4 bg-[#00FF00]/5 space-y-3"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-black text-xl">{selectedElement.elementName}</span>
                      <button onClick={() => setSelectedElement(null)} className="text-[10px] uppercase opacity-50 hover:opacity-100">Close</button>
                    </div>
                    <div className="flex justify-between items-center text-xs opacity-50">
                      <span>Cost: {selectedElement.cost}</span>
                    </div>
                    <div className="text-[10px] opacity-70 leading-relaxed">
                      Type: {selectedElement.type.toUpperCase()}<br/>
                      {selectedElement.type === 'tower' && (
                        <>
                          Reaction: {selectedElement.reactionType}<br/>
                          Damage: {selectedElement.baseDmg}<br/>
                          Range: {selectedElement.range}
                        </>
                      )}
                    </div>
                  </motion.div>
                )}

                {selectedTowerId && (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="border border-[#FF4444]/30 p-4 bg-[#FF4444]/5 space-y-3"
                  >
                    {(() => {
                      const tower = towersRef.current.find(t => t.id === selectedTowerId);
                      if (!tower) return null;
                      return (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="font-black text-xl text-[#FF4444]">{tower.element.elementName}</span>
                            <button onClick={() => setSelectedTowerId(null)} className="text-[10px] uppercase opacity-50 hover:opacity-100">Deselect</button>
                          </div>
                          <div className="text-[10px] opacity-70 leading-relaxed">
                            Level: {tower.level}<br/>
                            Type: {tower.element.type.toUpperCase()}<br/>
                            {tower.element.type === 'tower' && (
                              <>
                                Damage: {tower.element.baseDmg}<br/>
                                Range: {tower.element.range}
                              </>
                            )}
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              sellTower();
                            }}
                            className="w-full py-2 bg-[#FF4444] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#FF4444]/80 transition-all flex items-center justify-center gap-2"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Decommission (Sell)
                          </button>
                        </>
                      );
                    })()}
                  </motion.div>
                )}

                {/* Logs */}
                <div className="flex-1 border border-[#E4E3E0]/10 p-4 bg-[#1a1a1a] font-mono text-[10px] overflow-hidden">
                  <div className="text-xs uppercase tracking-widest opacity-30 mb-2">System Logs</div>
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="opacity-60">{`> ${log}`}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Center: Canvas */}
              <div className="flex-1 relative border border-[#E4E3E0]/20 bg-black overflow-hidden cursor-crosshair">
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onClick={handleCanvasClick}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className="w-full h-full object-contain touch-none"
                />
                
                {/* Stage Info Overlay */}
                {mode === 'tutorial' && wave === 1 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute bottom-8 left-8 right-8 p-6 bg-[#141414]/90 border border-[#00FF00]/40 backdrop-blur-md"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h4 className="text-xs uppercase tracking-[0.3em] text-[#00FF00] mb-1">Mission Objective</h4>
                        <h2 className="text-2xl font-black italic uppercase italic-serif">{TUTORIAL_STAGES[currentStageIndex].title}</h2>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] opacity-50 uppercase">Case Study</div>
                        <div className="text-xs font-bold">{TUTORIAL_STAGES[currentStageIndex].caseStudy}</div>
                      </div>
                    </div>
                    <p className="text-sm opacity-80 italic italic-serif mb-4">"{TUTORIAL_STAGES[currentStageIndex].quote}"</p>
                    <div className="flex gap-4">
                      <div className="flex-1 border border-[#E4E3E0]/10 p-3 text-xs">
                        <span className="opacity-50 uppercase block mb-1">Objective</span>
                        {TUTORIAL_STAGES[currentStageIndex].objective}
                      </div>
                      <div className="flex-1 border border-[#E4E3E0]/10 p-3 text-xs">
                        <span className="opacity-50 uppercase block mb-1">Reward</span>
                        {TUTORIAL_STAGES[currentStageIndex].reward}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {mode === 'gameover' && (
            <motion.div 
              key="gameover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center space-y-8"
            >
              <Skull className="w-32 h-32 text-red-500 mx-auto animate-pulse" />
              <div className="space-y-2">
                <h1 className="text-6xl font-black italic uppercase tracking-tighter text-red-500">Containment Failed</h1>
                <p className="text-xl opacity-50 uppercase tracking-widest">Chemical leak reached critical levels</p>
              </div>
              <button 
                onClick={() => setMode('mode-menu')}
                className="px-12 py-4 border-2 border-red-500 text-red-500 font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
              >
                Return to Command
              </button>
            </motion.div>
          )}

          {mode === 'clear' && (
            <motion.div 
              key="clear"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center space-y-8"
            >
              <Trophy className="w-32 h-32 text-[#00FF00] mx-auto animate-bounce" />
              <div className="space-y-2">
                <h1 className="text-6xl font-black italic uppercase tracking-tighter text-[#00FF00]">Mission Success</h1>
                <p className="text-xl opacity-50 uppercase tracking-widest">Chemical threat neutralized</p>
              </div>
              <div className="flex gap-4 justify-center">
                <button 
                  onClick={() => setMode('mode-menu')}
                  className="px-12 py-4 border border-[#E4E3E0]/20 font-black uppercase tracking-widest hover:bg-[#E4E3E0] hover:text-[#141414] transition-all"
                >
                  Return to Base
                </button>
                {currentStageIndex < TUTORIAL_STAGES.length - 1 && (
                  <button 
                    onClick={() => startGame('tutorial', currentStageIndex + 1)}
                    className="px-12 py-4 bg-[#00FF00] text-[#141414] font-black uppercase tracking-widest hover:bg-[#00FF00]/80 transition-all"
                  >
                    Next Mission
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tutorial Guide Popup */}
        <AnimatePresence>
          {showGuide && mode === 'tutorial' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="max-w-2xl w-full bg-[#1a1a1a] border-2 border-[#00FF00] p-8 space-y-6"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#00FF00] mb-1">Briefing Protocol</div>
                    <h2 className="text-4xl font-black italic uppercase tracking-tighter italic-serif">{TUTORIAL_STAGES[currentStageIndex].title}</h2>
                  </div>
                  <div className="w-12 h-12 border border-[#00FF00]/20 flex items-center justify-center">
                    <Info className="w-6 h-6 text-[#00FF00]" />
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-[#00FF00]/5 border border-[#00FF00]/20">
                    <p className="text-sm leading-relaxed opacity-80 italic italic-serif">"{TUTORIAL_STAGES[currentStageIndex].quote}"</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase tracking-widest opacity-50">Objective</div>
                      <p className="text-xs leading-relaxed">{TUTORIAL_STAGES[currentStageIndex].objective}</p>
                    </div>
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase tracking-widest opacity-50">Intelligence</div>
                      <p className="text-xs leading-relaxed">{TUTORIAL_STAGES[currentStageIndex].caseStudy}</p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowGuide(false)}
                  className="w-full py-4 bg-[#00FF00] text-[#141414] font-black uppercase tracking-widest hover:bg-[#00FF00]/80 transition-all"
                >
                  Acknowledge & Deploy
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reward Popup */}
        <AnimatePresence>
          {showReward && lastReward && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="max-w-md w-full bg-[#1a1a1a] border-2 border-yellow-500 p-8 text-center space-y-6"
              >
                <Trophy className="w-16 h-16 text-yellow-500 mx-auto" />
                <div className="space-y-2">
                  <h2 className="text-3xl font-black italic uppercase tracking-tighter">Mission Accomplished</h2>
                  <p className="text-xs opacity-50 uppercase tracking-widest">Rewards Dispatched to Lab</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border border-[#E4E3E0]/10 bg-white/5">
                    <div className="text-2xl font-black text-yellow-500">+{lastReward.money}</div>
                    <div className="text-[10px] uppercase tracking-widest opacity-50">Energy</div>
                  </div>
                  <div className="p-4 border border-[#E4E3E0]/10 bg-white/5">
                    <div className="text-2xl font-black text-[#00FF00]">{lastReward.elements.length > 0 ? lastReward.elements[0] : '---'}</div>
                    <div className="text-[10px] uppercase tracking-widest opacity-50">New Element</div>
                  </div>
                </div>

                <button 
                  onClick={() => {
                    setShowReward(false);
                    setMode('mode-menu');
                  }}
                  className="w-full py-4 bg-yellow-500 text-[#141414] font-black uppercase tracking-widest hover:bg-yellow-500/80 transition-all"
                >
                  Secure Rewards & Return
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Global CSS for scrollbar */}
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(228, 227, 224, 0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(228, 227, 224, 0.2); }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0, 255, 0, 0.4); }
      `}} />
        <AnimatePresence>
          {editorMode && (
            <motion.div
              initial={{ x: 300 }}
              animate={{ x: 0 }}
              exit={{ x: 300 }}
              className="fixed right-0 top-0 bottom-0 w-80 bg-[#111] border-l-2 border-[#00FF00] z-[150] p-6 overflow-y-auto text-xs custom-scrollbar"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-[#00FF00] font-black text-lg italic uppercase">🛠 Live Editor</h3>
                <button 
                  onClick={() => setEditorMode(false)}
                  className="text-gray-500 hover:text-white uppercase text-[10px]"
                >
                  Close
                </button>
              </div>

              <div className="space-y-6">
                {/* Enemy Data */}
                <div className="bg-[#1a1a1a] p-4 border border-[#333] rounded space-y-3">
                  <label className="text-[#00FF00] font-bold block uppercase tracking-tighter">1. Enemy Intelligence</label>
                  <select 
                    className="w-full bg-black border border-[#444] text-white p-2 rounded appearance-none"
                    value={editEnemyId}
                    onChange={(e) => setEditEnemyId(e.target.value)}
                  >
                    {(Object.values(localCompounds) as CompoundData[]).map(c => <option key={c.id} value={c.id}>{c.displayName} ({c.id})</option>)}
                  </select>
                  
                  {localCompounds[editEnemyId] && (
                    <div className="space-y-2 pt-2 border-t border-[#333]">
                      <div>
                        <div className="opacity-50 mb-1">Display Name</div>
                        <input 
                          type="text" 
                          value={localCompounds[editEnemyId].displayName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLocalCompounds(prev => ({ ...prev, [editEnemyId]: { ...prev[editEnemyId], displayName: val } }));
                          }}
                          className="w-full bg-black border border-[#444] p-1 text-[#00FF00]"
                        />
                      </div>
                      <div>
                        <div className="opacity-50 mb-1">Hazard Level</div>
                        <input 
                          type="text" 
                          value={localCompounds[editEnemyId].hazard || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLocalCompounds(prev => ({ ...prev, [editEnemyId]: { ...prev[editEnemyId], hazard: val } }));
                          }}
                          className="w-full bg-black border border-[#444] p-1 text-[#FF4444]"
                        />
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(localCompounds, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      const url = URL.createObjectURL(blob);
                      a.href = url;
                      a.download = "compounds.json";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="w-full bg-[#55f] text-white font-black p-2 rounded uppercase tracking-widest mt-2 hover:bg-[#666fff]"
                  >
                    Export compounds.json
                  </button>
                </div>

                {/* Tower Data */}
                <div className="bg-[#1a1a1a] p-4 border border-[#333] rounded space-y-3">
                  <label className="text-[#00FF00] font-bold block uppercase tracking-tighter">2. Tower Calibration</label>
                  <select 
                    className="w-full bg-black border border-[#444] text-white p-2 rounded appearance-none"
                    value={editTowerId}
                    onChange={(e) => setEditTowerId(e.target.value)}
                  >
                    {(Object.values(localElements) as ElementData[]).map(el => <option key={el.name} value={el.name}>{el.elementName} ({el.name})</option>)}
                  </select>

                  {localElements[editTowerId] && (localElements[editTowerId].type === 'tower') && (
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#333]">
                      <div>
                        <div className="opacity-50 mb-1 text-[10px]">Range</div>
                        <input 
                          type="number" 
                          value={localElements[editTowerId].range}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setLocalElements(prev => ({ ...prev, [editTowerId]: { ...prev[editTowerId], range: val } }));
                          }}
                          className="w-full bg-black border border-[#444] p-1 text-[#00FF00]"
                        />
                      </div>
                      <div>
                        <div className="opacity-50 mb-1 text-[10px]">Damage</div>
                        <input 
                          type="number" 
                          value={localElements[editTowerId].baseDmg}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setLocalElements(prev => ({ ...prev, [editTowerId]: { ...prev[editTowerId], baseDmg: val } }));
                          }}
                          className="w-full bg-black border border-[#444] p-1 text-[#00FF00]"
                        />
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(localElements, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      const url = URL.createObjectURL(blob);
                      a.href = url;
                      a.download = "elements.json";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="w-full bg-[#55f] text-white font-black p-2 rounded uppercase tracking-widest mt-2 hover:bg-[#666fff]"
                  >
                    Export elements.json
                  </button>
                </div>

                {/* Map Extraction */}
                <div className="bg-[#1a1a1a] p-4 border border-[#333] rounded space-y-3 font-mono">
                  <label className="text-[#00FF00] font-bold block uppercase tracking-tighter">3. Containment Map</label>
                  <p className="opacity-50 italic text-[10px]">Grid clicking adds physical obstacles.</p>
                  <button 
                    onClick={() => {
                      // Generate a simple wall list for export
                      const walls: {r: number, c: number, w: number, h: number}[] = [];
                      for(let r=0; r<GRID_ROWS; r++) {
                        for(let c=0; c<GRID_COLS; c++) {
                          if (gridRef.current[r][c]) walls.push({r, c, w:1, h:1});
                        }
                      }
                      const blob = new Blob([JSON.stringify({ walls }, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = "stages_export.json";
                      a.click();
                    }}
                    className="w-full bg-[#55f] text-white font-black p-2 rounded uppercase tracking-widest hover:bg-[#666fff]"
                  >
                    Export Current Grid
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
    </div>
  );
}

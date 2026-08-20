import { useEffect, useRef, useState, useCallback } from 'react';
import { useWallet } from '@/modules/midnight/wallet-widget/hooks/useWallet';
import { MidnightWallet } from '@/modules/midnight/wallet-widget/ui/midnightWallet';
import { startGame, submitGuess as sponsorSubmitGuess, declareAnswer, submitDisplayName } from '@/lib/sponsorApi';

const COLORS = ['#FF4D4D', '#4D79FF', '#FFCF4D', '#4DFF88', '#D94DFF', '#FF8C4D'];
const COLOR_NAMES = ['RED', 'BLUE', 'YELLOW', 'GREEN', 'PURPLE', 'ORANGE'];

type Guess = {
  code: [number, number, number, number];
  black: number;
  white: number;
};

type LogEntry = {
  time: string;
  type: 'info' | 'proof' | 'cmd';
  text: string;
};

export const ShadowCipher = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  
  const { status, setOpen, shieldedAddresses } = useWallet();
  const displayAddress = shieldedAddresses?.shieldedAddress;
  const networkName = status?.status === 'connected' ? (status.networkId ?? 'unknown').toUpperCase() : 'OFFLINE';
  const isWalletConnected = status?.status === 'connected';

  const [sessionIdServer, setSessionIdServer] = useState<string | null>(null);
  const [useOnChain, setUseOnChain] = useState(false);
  const [demoFallback, setDemoFallback] = useState(false);

  const [isBooted, setIsBooted] = useState(false);
  const [isTerminalBooting, setIsTerminalBooting] = useState(false);
  const [bootLines, setBootLines] = useState<string[]>([]);
  
  const [secret, setSecret] = useState<[number, number, number, number]>([0, 1, 2, 3]);
  const [currentGuess, setCurrentGuess] = useState<[number, number, number, number]>([0, 1, 2, 3]);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProving, setIsProving] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [circuitLabel, setCircuitLabel] = useState('SYSTEM_IDLE');
  const [sessionId] = useState(`0x${Math.random().toString(16).slice(2, 6).toUpperCase()}`);
  const [showHelp, setShowHelp] = useState(true); // Show help on first boot
  const [leaderboard, setLeaderboard] = useState<Array<{ address: string; displayName?: string; score: number }>>([]);
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [arcadeName, setArcadeName] = useState(['A', 'A', 'A']);
  const [nameSlot, setNameSlot] = useState(0);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);

  const addLog = useCallback((text: string, type: 'info' | 'proof' | 'cmd' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-50), { time, type, text }]);
  }, []);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const typeCommand = async (text: string) => {
    let current = '$ ';
    for (let i = 0; i < text.length; i++) {
      current += text[i];
      setBootLines(prev => [...prev.slice(0, -1), current]);
      await sleep(25);
    }
    setBootLines(prev => [...prev, '']);
  };

  const runTerminalBoot = async (onChain: boolean = false) => {
    setIsTerminalBooting(true);
    setBootLines(['']);
    setUseOnChain(onChain);
    setDemoFallback(false);

    const net = networkName.toLowerCase();
    const commands = [
      { t: `midnight-connect --node ${net} --proof-server sponsor`, delay: 400 },
      { t: onChain ? `shadowcipher join --network ${net}` : 'shadowcipher start --mode demo', delay: 600 },
    ];

    for (const cmd of commands) {
      await typeCommand(cmd.t);
      await sleep(cmd.delay);
      const cmdStatus = cmd.t.includes('connect')
        ? '[OK] Handshake verified. ZK-Relay Active.'
        : '[OK] Decryption matrix online.';
      setBootLines(prev => [...prev, cmdStatus, '']);
      addLog(`> ${cmd.t}`, 'cmd');
    }

    // Start game via sponsor server
    try {
      setBootLines(prev => [...prev, onChain ? 'Claiming pre-committed game from pool...' : 'Starting demo session...', '']);
      addLog(onChain ? 'Requesting on-chain game from sponsor server...' : 'Starting demo session...', 'info');

      const game = await startGame(!onChain);
      setSessionIdServer(game.sessionId);

      if (game.contractAddress && game.gameId) {
        setBootLines(prev => [...prev, `[OK] Game claimed: id=${game.gameId}, contract=${game.contractAddress.slice(0, 16)}...`, '']);
        addLog(`On-chain game ready: game_id=${game.gameId}`, 'info');
      } else {
        if (onChain) {
          setBootLines(prev => [...prev, '[WARN] No on-chain game available. Using demo mode.', '']);
          addLog('Pool empty or sponsor unavailable, falling back to demo', 'info');
          setUseOnChain(false);
          setDemoFallback(true);
        }
        addLog('Game initialized. Secret held by server.', 'info');
      }
      // Secret is always held server-side
      setSecret([0, 0, 0, 0]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setBootLines(prev => [...prev, `[ERR] ${errMsg}`, '', 'Starting local demo...', '']);
      addLog(`Server error: ${errMsg}, using local demo`, 'info');
      setUseOnChain(false);
      setDemoFallback(true);
      setSessionIdServer(null);
      setSecret([
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
      ]);
    }

    await sleep(600);
    setIsTerminalBooting(false);
    setIsBooted(true);
  };

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (gameOver || isProving || !isBooted) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    // Must match draw() responsive calculations
    const inputSpacing = Math.min(50, w * 0.12);
    const inputR = Math.min(18, w * 0.04);
    const inputY = h - 50;

    for (let i = 0; i < 4; i++) {
      const cx = w / 2 - inputSpacing * 1.5 + i * inputSpacing;
      const dist = Math.sqrt((x - cx) ** 2 + (y - inputY) ** 2);
      if (dist < inputR + 6) {
        setCurrentGuess(prev => {
          const newGuess = [...prev] as [number, number, number, number];
          newGuess[i] = (newGuess[i] + 1) % 6;
          return newGuess;
        });
        break;
      }
    }
  }, [gameOver, isProving, isBooted]);

  const handleSubmitGuess = async () => {
    if (guesses.length >= 10 || gameOver || isProving) return;

    setIsProving(true);
    setCircuitLabel('GENERATING_SNARK_WITNESS...');
    addLog(`Compiling Guess #${guesses.length + 1} into circuit...`, 'proof');

    try {
      if (sessionIdServer) {
        // Server-backed mode: get peg feedback from sponsor server
        const isLastAttempt = guesses.length + 1 >= 10;

        addLog('Submitting guess to server...', 'proof');
        setProgress(25);

        const result = await sponsorSubmitGuess(sessionIdServer, currentGuess);
        setProgress(75);

        const newGuess: Guess = { code: [...currentGuess] as [number, number, number, number], black: result.black, white: result.white };
        setGuesses(prev => [...prev, newGuess]);

        if (result.solved) {
          addLog(`Result: ${result.black}✓ / ${result.white}~`, 'info');
          setProgress(100);

          // Final declaration — triggers on-chain ZK proof if available.
          // The server records the score here; the client never reports results.
          addLog('CIPHER DECRYPTED! Submitting ZK proof on-chain...', 'proof');
          try {
            const walletAddr = useOnChain ? displayAddress?.slice(0, 16) : undefined;
            const walletName = useOnChain ? displayAddress?.slice(0, 3).toUpperCase() : undefined;
            const declaration = await declareAnswer(sessionIdServer, currentGuess, walletAddr, walletName);
            if (declaration.onChain) {
              addLog(`On-chain TX: ${declaration.onChain.txId}`, 'info');
            }
          } catch (declareErr) {
            addLog(`On-chain declare failed: ${declareErr}`, 'info');
          }

          setGameOver(true);
          if (useOnChain) {
            refreshLeaderboard();
          } else {
            setShowNameEntry(true);
          }
        } else if (isLastAttempt) {
          addLog(`Result: ${result.black}✓ / ${result.white}~`, 'info');
          // Declare final answer even on loss — the server records the score
          try {
            const walletAddr = useOnChain ? displayAddress?.slice(0, 16) : undefined;
            const walletName = useOnChain ? displayAddress?.slice(0, 3).toUpperCase() : undefined;
            await declareAnswer(sessionIdServer, currentGuess, walletAddr, walletName);
          } catch (declareErr) {
            addLog(`Could not record result: ${declareErr}`, 'info');
          }

          setGameOver(true);
          addLog('ACCESS_REVOKED. Maximum attempts reached.', 'info');
          if (useOnChain) {
            refreshLeaderboard();
          } else {
            setShowNameEntry(true);
          }
        } else {
          addLog(`Proof Verified. Result: ${result.black}✓ / ${result.white}~`, 'info');
        }
        setProgress(100);
      } else {
        // Pure local fallback (no server): local peg calculation
        const steps = ['Hashing input...', 'Applying constraints...', 'Satisfying R1CS...', 'Extracting Proof...'];
        for (let i = 0; i < steps.length; i++) {
          addLog(steps[i], 'proof');
          await sleep(400);
          setProgress((i + 1) * 25);
        }

        // Local peg calculation
        let black = 0, white = 0;
        const secretCopy = [...secret];
        const guessCopy = [...currentGuess];
        for (let i = 0; i < 4; i++) {
          if (guessCopy[i] === secretCopy[i]) { black++; secretCopy[i] = -1; guessCopy[i] = -2; }
        }
        for (let i = 0; i < 4; i++) {
          if (guessCopy[i] >= 0) { const idx = secretCopy.indexOf(guessCopy[i]); if (idx !== -1) { white++; secretCopy[idx] = -1; } }
        }

        const newGuess: Guess = { code: [...currentGuess] as [number, number, number, number], black, white };
        setGuesses(prev => [...prev, newGuess]);
        addLog(`Proof Verified. Result: ${black}✓ / ${white}~`, 'info');

        if (black === 4) {
          setGameOver(true);
          addLog('CIPHER DECRYPTED. BROADCASTING WIN...', 'info');
          setShowNameEntry(true);
        } else if (guesses.length + 1 >= 10) {
          setGameOver(true);
          addLog('ACCESS_REVOKED. Maximum attempts reached.', 'info');
          setShowNameEntry(true);
        }
      }
    } catch (e) {
      addLog(`Error: ${e}`, 'info');
    }

    setCircuitLabel('SYSTEM_IDLE');
    setProgress(0);
    setIsProving(false);
  };

  const refreshLeaderboard = async () => {
    try {
      const lb = await fetch('/api/metrics/leaderboard?limit=5').then(r => r.ok ? r.json() : null);
      if (lb?.entries) setLeaderboard(lb.entries);
    } catch { /* ignore */ }
  };

  // The score itself is recorded server-side by /api/declare; the name entry
  // only attaches the arcade initials to that session's leaderboard row.
  const submitName = async (name: string) => {
    if (sessionIdServer) {
      try {
        await submitDisplayName(sessionIdServer, name);
        addLog(`Name recorded: ${name} — ${guesses.length} attempts`, 'info');
      } catch {
        addLog('Could not record name (API unavailable)', 'info');
      }
    } else {
      addLog('Local demo — score not recorded on leaderboard', 'info');
    }
    await refreshLeaderboard();
    setScoreSubmitted(true);
  };

  const handleNameSubmit = () => {
    const name = arcadeName.join('');
    setShowNameEntry(false);
    submitName(name);
  };

  const cycleNameChar = (slot: number, direction: number) => {
    setArcadeName(prev => {
      const next = [...prev];
      const code = next[slot].charCodeAt(0) + direction;
      if (code > 90) next[slot] = 'A';
      else if (code < 65) next[slot] = 'Z';
      else next[slot] = String.fromCharCode(code);
      return next;
    });
  };

  const reboot = () => {
    window.location.reload();
  };

  // Canvas drawing & resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      if (!isBooted) {
        animationId = requestAnimationFrame(draw);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      // Responsive scaling factors
      const rowH = Math.floor((h - 100) / 10);
      const topPad = Math.min(30, h * 0.04);
      const labelW = Math.max(40, w * 0.1);
      const gridL = labelW + 8;
      const gridR = w - 20;
      const circR = Math.min(12, w * 0.025);
      const circSpacing = Math.min(40, (gridR - gridL - 80) / 4);
      const circStartX = gridL + 30;
      const fontSize = Math.max(8, Math.min(10, w * 0.022));
      const inputSpacing = Math.min(50, w * 0.12);
      const inputR = Math.min(18, w * 0.04);

      // Draw grid rows
      for (let i = 0; i < 10; i++) {
        const rowY = topPad + i * rowH;
        ctx.strokeStyle = '#1a3a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(gridL, rowY, gridR - gridL, rowH - 4);
        ctx.fillStyle = '#1a3a2a';
        ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
        ctx.fillText(`SEQ_${(i + 1).toString().padStart(2, '0')}`, 4, rowY + rowH / 2 + 3);
      }

      // Draw guesses
      guesses.forEach((g, row) => {
        const y = topPad + row * rowH + rowH / 2;
        g.code.forEach((cIdx, col) => {
          const cx = circStartX + col * circSpacing;
          ctx.fillStyle = COLORS[cIdx];
          ctx.shadowBlur = 8;
          ctx.shadowColor = COLORS[cIdx];
          ctx.beginPath();
          ctx.arc(cx, y, circR, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        // Draw peg result - clear text format
        const pegX = circStartX + 4 * circSpacing + 10;
        ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;

        // EXACT matches (green) - right color, right position
        ctx.fillStyle = '#00ff9d';
        ctx.fillText(`${g.black}✓`, pegX, y + 3);

        // CLOSE matches (yellow) - right color, wrong position
        ctx.fillStyle = '#ffcc00';
        ctx.fillText(`${g.white}~`, pegX + 28, y + 3);

        ctx.fillStyle = '#444';
        ctx.font = `${Math.max(7, fontSize - 2)}px "JetBrains Mono", monospace`;
        ctx.fillText('OK', w - 18, y + 3);
      });

      // Draw input or game over
      if (!gameOver) {
        const inputY = h - 50;
        ctx.fillStyle = '#333';
        ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('// PENDING_GUESS //', w / 2, inputY - 30);
        ctx.textAlign = 'left';

        currentGuess.forEach((cIdx, i) => {
          const cx = w / 2 - inputSpacing * 1.5 + i * inputSpacing;
          ctx.fillStyle = COLORS[cIdx];
          ctx.shadowBlur = 12;
          ctx.shadowColor = COLORS[cIdx];
          ctx.beginPath();
          ctx.arc(cx, inputY, inputR, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, inputY, inputR, 0, Math.PI * 2);
          ctx.stroke();
        });
      } else {
        ctx.fillStyle = '#00ff9d';
        const endFontSize = Math.min(24, w * 0.045);
        ctx.font = `bold ${endFontSize}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        const lastGuess = guesses[guesses.length - 1];
        ctx.fillText(lastGuess?.black === 4 ? 'CIPHER_CRACKED' : 'ACCESS_REVOKED', w / 2, h - 50);
        ctx.textAlign = 'left';
      }

      animationId = requestAnimationFrame(draw);
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [isBooted, guesses, currentGuess, gameOver]);

  // Fetch leaderboard from PRC-6 API
  useEffect(() => {
    if (!isBooted) return;
    fetch('/api/metrics/leaderboard?limit=5')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.entries) setLeaderboard(data.entries);
      })
      .catch(() => {}); // Silently fail if API unavailable
  }, [isBooted]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="shadowcipher-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&display=swap');
        
        .shadowcipher-root {
          --neon-green: #00ff9d;
          --neon-green-dim: rgba(0, 255, 157, 0.2);
          --dark-bg: #080a0c;
          --panel-bg: rgba(10, 15, 20, 0.95);
          --border-color: #1a3a2a;
          
          position: fixed;
          inset: 0;
          background-color: var(--dark-bg);
          color: var(--neon-green);
          font-family: 'JetBrains Mono', monospace;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          text-shadow: 0 0 5px var(--neon-green-dim);
        }
        
        .shadowcipher-root::before {
          content: " ";
          display: block;
          position: absolute;
          inset: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%),
                      linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
          z-index: 100;
          background-size: 100% 4px, 3px 100%;
          pointer-events: none;
        }
        
        .top-bar {
          height: 45px;
          border-bottom: 2px solid var(--border-color);
          display: flex;
          align-items: center;
          padding: 0 25px;
          font-size: 11px;
          font-weight: bold;
          letter-spacing: 2px;
          background: #000;
          justify-content: space-between;
          z-index: 50;
        }
        
        .main-container {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 340px;
          padding: 20px;
          gap: 20px;
          overflow: hidden;
        }
        
        .canvas-wrapper {
          position: relative;
          background: var(--panel-bg);
          border: 1px solid var(--border-color);
          box-shadow: inset 0 0 50px rgba(0, 255, 157, 0.05);
          display: flex;
          overflow: hidden;
        }
        
        .corner {
          position: absolute;
          width: 15px;
          height: 15px;
          border: 2px solid var(--neon-green);
          pointer-events: none;
        }
        .top-left { top: 10px; left: 10px; border-right: 0; border-bottom: 0; }
        .top-right { top: 10px; right: 10px; border-left: 0; border-bottom: 0; }
        .bottom-left { bottom: 10px; left: 10px; border-right: 0; border-top: 0; }
        .bottom-right { bottom: 10px; right: 10px; border-left: 0; border-top: 0; }
        
        .game-canvas { width: 100%; height: 100%; cursor: pointer; }
        
        .sidebar { display: flex; flex-direction: column; gap: 20px; overflow: hidden; }
        
        .panel {
          background: var(--panel-bg);
          border: 1px solid var(--border-color);
          padding: 15px;
          position: relative;
        }
        
        .panel-title {
          font-size: 10px;
          text-transform: uppercase;
          margin-bottom: 12px;
          color: #555;
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 5px;
        }
        
        .terminal-log {
          height: 280px;
          font-size: 10px;
          overflow-y: auto;
          line-height: 1.6;
          color: var(--neon-green);
        }
        
        .log-entry { margin-bottom: 4px; }
        .log-type-info { color: var(--neon-green); }
        .log-type-proof { color: #4d79ff; font-weight: bold; }
        .log-type-cmd { color: #fff; font-weight: bold; }
        
        .progress-bar {
          height: 6px;
          background: #0d1a14;
          margin: 10px 0;
          border: 1px solid var(--border-color);
          position: relative;
        }
        
        .progress-fill {
          height: 100%;
          background: var(--neon-green);
          box-shadow: 0 0 10px var(--neon-green);
          transition: width 0.1s linear;
        }
        
        .btn {
          background: rgba(0, 255, 157, 0.05);
          border: 1px solid var(--neon-green);
          color: var(--neon-green);
          padding: 14px;
          cursor: pointer;
          font-family: inherit;
          text-transform: uppercase;
          font-weight: bold;
          font-size: 11px;
          transition: 0.2s;
        }
        
        .btn:hover:not(:disabled) {
          background: var(--neon-green);
          color: var(--dark-bg);
          box-shadow: 0 0 20px var(--neon-green-dim);
        }
        
        .btn:disabled { opacity: 0.2; cursor: not-allowed; }
        
        .controls { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        
        .help-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.95);
          z-index: 180;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
        }
        
        .help-content {
          max-width: 500px;
          border: 1px solid var(--neon-green);
          padding: 30px;
          background: var(--panel-bg);
        }
        
        .help-title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 20px;
          color: var(--neon-green);
          text-align: center;
          letter-spacing: 3px;
        }
        
        .help-section {
          margin-bottom: 20px;
        }
        
        .help-section h3 {
          font-size: 11px;
          color: #4d79ff;
          margin-bottom: 8px;
          text-transform: uppercase;
        }
        
        .help-section p {
          font-size: 11px;
          line-height: 1.8;
          color: #aaa;
        }
        
        .help-legend {
          display: flex;
          gap: 20px;
          margin-top: 10px;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10px;
        }
        
        .legend-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        
        .legend-dot.filled { background: var(--neon-green); }
        .legend-dot.hollow { border: 2px solid #4d79ff; }
        
        .boot-screen {
          position: fixed;
          inset: 0;
          background: var(--dark-bg);
          z-index: 200;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        
        .boot-logo {
          font-size: 48px;
          font-weight: 700;
          letter-spacing: 15px;
          margin-bottom: 20px;
          color: var(--neon-green);
          text-shadow: 0 0 20px var(--neon-green);
          animation: pulse 1.5s infinite;
        }
        
        .boot-sub {
          font-size: 12px;
          color: #444;
          margin-bottom: 50px;
          letter-spacing: 4px;
        }
        
        .boot-btn {
          padding: 20px 40px;
          font-size: 14px;
          background: transparent;
          border: 1px solid var(--neon-green);
          color: var(--neon-green);
          cursor: pointer;
          font-family: inherit;
          letter-spacing: 2px;
        }
        
        .boot-btn:hover {
          background: var(--neon-green);
          color: var(--dark-bg);
        }
        
        .terminal-overlay {
          position: fixed;
          top: 45px;
          left: 0;
          width: 100%;
          height: calc(100% - 45px);
          background: var(--dark-bg);
          z-index: 150;
          padding: 60px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          font-size: 16px;
          line-height: 2;
        }
        
        .cursor {
          display: inline-block;
          width: 12px;
          height: 1.2em;
          background: var(--neon-green);
          vertical-align: middle;
          margin-left: 8px;
          animation: blink 1s step-end infinite;
        }
        
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
        
        .leaderboard-entry {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          line-height: 1.8;
        }

        /* Mobile responsive */
        @media (max-width: 768px) {
          .top-bar {
            font-size: 9px;
            padding: 0 10px;
            height: 36px;
            letter-spacing: 1px;
            flex-wrap: wrap;
            gap: 4px;
          }
          .top-bar .gem-sig,
          .top-bar .mode-info {
            display: none;
          }
          .main-container {
            grid-template-columns: 1fr;
            padding: 8px;
            gap: 8px;
            overflow-y: auto;
          }
          .canvas-wrapper {
            min-height: 320px;
            max-height: 50vh;
          }
          .sidebar {
            gap: 8px;
            max-height: 45vh;
            overflow-y: auto;
          }
          .panel { padding: 10px; }
          .terminal-log { height: 120px; }
          .controls { gap: 6px; }
          .btn { padding: 10px; font-size: 10px; }
          .boot-logo {
            font-size: 24px;
            letter-spacing: 6px;
          }
          .boot-sub {
            font-size: 10px;
            letter-spacing: 2px;
            margin-bottom: 30px;
          }
          .boot-btn {
            padding: 14px 24px;
            font-size: 11px;
          }
          .terminal-overlay {
            padding: 20px;
            font-size: 12px;
            line-height: 1.6;
          }
          .help-overlay { padding: 15px; }
          .help-content {
            max-width: 95vw;
            padding: 20px;
            max-height: 85vh;
            overflow-y: auto;
          }
          .help-title {
            font-size: 14px;
            letter-spacing: 2px;
          }
          .corner { width: 10px; height: 10px; }
          .top-left { top: 5px; left: 5px; }
          .top-right { top: 5px; right: 5px; }
          .bottom-left { bottom: 5px; left: 5px; }
          .bottom-right { bottom: 5px; right: 5px; }
        }
      `}</style>

      {/* Boot Screen */}
      {!isBooted && !isTerminalBooting && (
        <div className="boot-screen">
          <div className="boot-logo">SHADOWCIPHER</div>
          <div className="boot-sub">MIDNIGHT NETWORK // ZERO-KNOWLEDGE PROTOCOL</div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
            {isWalletConnected ? (
              <>
                <div style={{ fontSize: '10px', color: '#00ff9d', marginBottom: '5px' }}>
                  WALLET_CONNECTED: {displayAddress?.slice(0, 12)}...{displayAddress?.slice(-6)}
                </div>
                <button className="boot-btn" onClick={() => runTerminalBoot(true)}>
                  PLAY (ON-CHAIN)
                </button>
              </>
            ) : (
              <>
                <div style={{ display: 'none' }}><MidnightWallet /></div>
                <button className="boot-btn" onClick={() => setOpen(true)}>
                  CONNECT_WALLET
                </button>
                <div style={{ fontSize: '9px', color: '#444' }}>
                  Connect wallet above to enable on-chain mode
                </div>
              </>
            )}
            <button
              className="boot-btn"
              onClick={() => runTerminalBoot(false)}
              style={{ opacity: 0.7, fontSize: '10px' }}
            >
              DEMO_MODE (LOCAL)
            </button>
          </div>
          <div style={{ fontSize: '9px', color: '#444', marginTop: '15px', maxWidth: '300px', textAlign: 'center' }}>
            On-chain mode deploys a contract and records guesses to the Midnight network. Demo mode runs locally — no wallet required.
          </div>
          <div style={{ fontSize: '8px', color: '#1a3a2a', marginTop: '40px', letterSpacing: '4px' }}>
            BUILT BY GEMOTHY
          </div>
        </div>
      )}

      {/* Terminal Boot Overlay */}
      {isTerminalBooting && (
        <div className="terminal-overlay">
          <div>
            {bootLines.map((line, i) => (
              <div key={i} style={{ color: line.startsWith('[') ? '#666' : line.startsWith('$') ? '#fff' : '#00ff9d' }}>
                {line}
              </div>
            ))}
          </div>
          <span className="cursor" />
        </div>
      )}

      {/* Top Bar */}
      <div className="top-bar">
        <div>SHADOWCIPHER_V1.1</div>
        <div className="mode-info" style={{ color: useOnChain ? '#00ff9d' : '#666' }}>
          {useOnChain ? 'MODE: ON-CHAIN' : 'MODE: DEMO'} // {import.meta.env.VITE_CONTRACT_ADDRESS ? `CONTRACT: ${String(import.meta.env.VITE_CONTRACT_ADDRESS).slice(0, 8)}...` : 'NO CONTRACT'}
        </div>
        {demoFallback && (
          <div style={{ color: '#ff4d4d', fontWeight: 'bold', fontSize: '10px' }}>
            DEPLOY FAILED — DEMO MODE
          </div>
        )}
        <div className="gem-sig" style={{ color: '#1a3a2a', fontSize: '9px' }}>GEM://</div>
        <div style={{ color: '#666' }}>NET: {networkName}</div>
      </div>

      {/* Main Container */}
      {isBooted && (
        <div className="main-container">
          <div className="canvas-wrapper">
            <div className="corner top-left" />
            <div className="corner top-right" />
            <div className="corner bottom-left" />
            <div className="corner bottom-right" />
            <canvas ref={canvasRef} className="game-canvas" onClick={handleCanvasClick} />
          </div>

          <div className="sidebar">
            <div className="panel" style={{ flex: 1 }}>
              <div className="panel-title">
                <span>ZK-WATCHER // SYSTEM_LOG</span>
                <span>SESSION: {sessionId}</span>
              </div>
              <div className="terminal-log" ref={logContainerRef}>
                {logs.map((log, i) => (
                  <div key={i} className="log-entry">
                    <span style={{ color: '#666' }}>[{log.time}]</span>{' '}
                    <span className={`log-type-${log.type}`}>[{log.type.toUpperCase()}]</span>{' '}
                    {log.text}
                  </div>
                ))}
              </div>
              <div>
                <div className="panel-title">COMPUTING_CIRCUIT_PROOFS</div>
                <div style={{ fontSize: '10px', height: '15px' }}>{circuitLabel}</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">ANONYMOUS_RANKINGS</div>
              <div>
                {leaderboard.length > 0 ? (
                  leaderboard.map((entry, i) => (
                    <div key={entry.address} className="leaderboard-entry" style={{ color: i === 0 ? '#00ff9d' : '#444' }}>
                      <span>{entry.displayName || `USR_${entry.address.slice(0, 7)}...`}</span>
                      <span>{String(entry.score).padStart(2, '0')} ATTEMPTS</span>
                    </div>
                  ))
                ) : (
                  <div className="leaderboard-entry" style={{ color: '#444' }}>
                    <span>Loading rankings...</span>
                  </div>
                )}
              </div>
            </div>

            <div className="controls">
              <button className="btn" onClick={handleSubmitGuess} disabled={isProving || gameOver}>
                SUBMIT
              </button>
              <button className="btn" onClick={() => setShowHelp(true)}>
                HELP
              </button>
              <button className="btn" onClick={reboot}>
                REBOOT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Arcade Name Entry Overlay (Demo Mode game over) */}
      {showNameEntry && !scoreSubmitted && (
        <div className="help-overlay">
          <div className="help-content" style={{ textAlign: 'center' }}>
            <div className="help-title">
              {guesses[guesses.length - 1]?.black === 4 ? '// CIPHER CRACKED //' : '// ACCESS REVOKED //'}
            </div>
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '20px' }}>
              {guesses[guesses.length - 1]?.black === 4
                ? `Solved in ${guesses.length} attempt${guesses.length !== 1 ? 's' : ''}!`
                : 'Better luck next time.'}
            </div>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '15px', letterSpacing: '3px' }}>
              ENTER YOUR INITIALS
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '25px' }}>
              {arcadeName.map((char, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="btn"
                    onClick={() => cycleNameChar(i, 1)}
                    style={{ padding: '6px 12px', fontSize: '14px' }}
                  >
                    ▲
                  </button>
                  <div style={{
                    fontSize: '36px',
                    fontWeight: 'bold',
                    color: nameSlot === i ? '#00ff9d' : '#4d79ff',
                    textShadow: nameSlot === i ? '0 0 15px #00ff9d' : '0 0 10px #4d79ff',
                    width: '40px',
                    cursor: 'pointer',
                  }}
                    onClick={() => setNameSlot(i)}
                  >
                    {char}
                  </div>
                  <button
                    className="btn"
                    onClick={() => cycleNameChar(i, -1)}
                    style={{ padding: '6px 12px', fontSize: '14px' }}
                  >
                    ▼
                  </button>
                </div>
              ))}
            </div>
            <button className="btn" onClick={handleNameSubmit} style={{ width: '100%' }}>
              RECORD_SCORE
            </button>
            <button
              className="btn"
              onClick={() => { setShowNameEntry(false); setScoreSubmitted(true); }}
              style={{ width: '100%', marginTop: '10px', opacity: 0.5, fontSize: '9px' }}
            >
              SKIP
            </button>
          </div>
        </div>
      )}

      {/* Help Overlay */}
      {isBooted && showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-content" onClick={e => e.stopPropagation()}>
            <div className="help-title">// SHADOWCIPHER PROTOCOL //</div>
            
            <div className="help-section">
              <h3>Objective</h3>
              <p>
                Crack the 4-color secret code in 10 attempts or less. 
                Each guess generates a Zero-Knowledge Proof that verifies 
                your result without revealing the secret.
              </p>
            </div>
            
            <div className="help-section">
              <h3>How to Play</h3>
              <p>
                Click on the color circles at the bottom to cycle through colors.
                Press SUBMIT to send your guess. The ZK circuit will verify
                your guess against the hidden commitment.
              </p>
            </div>
            
            <div className="help-section">
              <h3>Reading Results</h3>
              <div style={{fontSize: '12px', lineHeight: '2.2'}}>
                <div><span style={{color: '#00ff9d', fontWeight: 'bold'}}>✓</span> <span style={{color: '#aaa'}}>= EXACT (right color + right spot)</span></div>
                <div><span style={{color: '#ffcc00', fontWeight: 'bold'}}>~</span> <span style={{color: '#aaa'}}>= CLOSE (right color, wrong spot)</span></div>
              </div>
              <p style={{marginTop: '10px', color: '#666', fontSize: '10px'}}>
                Example: "2✓ 1~" = 2 perfect matches, 1 color is in the code but misplaced
              </p>
            </div>
            
            <div className="help-section">
              <h3>ZK Privacy</h3>
              <p>
                The secret code is stored in your local private state. 
                Only the commitment hash exists on-chain. Proofs verify 
                correctness without revealing the secret.
              </p>
            </div>
            
            <button className="btn" onClick={() => setShowHelp(false)} style={{width: '100%', marginTop: '10px'}}>
              BEGIN_DECRYPTION
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import { useEffect, useRef, useState, useCallback } from 'react';
import { calculatePegs, generateRandomSecret } from '@/modules/midnight/shadowcipher-sdk/api/contractController';
import { useWallet } from '@/modules/midnight/wallet-widget/hooks/useWallet';
import { MidnightWallet } from '@/modules/midnight/wallet-widget/ui/midnightWallet';
import { useShadowCipherContract } from '@/modules/midnight/shadowcipher-sdk/hooks/useShadowCipherContract';

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
  
  const { status, setOpen, dustAddress } = useWallet();
  const isWalletConnected = status?.status === 'connected';
  
  const { controller, contractAddress, isDeploying, deployError, deployContract } = useShadowCipherContract();
  const [useOnChain, setUseOnChain] = useState(false); // Toggle for on-chain vs demo mode

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

    const commands = [
      { t: 'midnight-connect --node preview-v1 --proof-server local', delay: 400 },
      { t: onChain ? 'shadowcipher deploy --network preview' : 'shadowcipher start --mode demo', delay: 600 },
    ];

    for (const cmd of commands) {
      await typeCommand(cmd.t);
      await sleep(cmd.delay);
      const status = cmd.t.includes('connect')
        ? '[OK] Handshake verified. ZK-Relay Active.'
        : '[OK] Decryption matrix online.';
      setBootLines(prev => [...prev, status, '']);
      addLog(`> ${cmd.t}`, 'cmd');
    }

    // If on-chain mode, deploy the contract
    if (onChain) {
      setBootLines(prev => [...prev, 'Deploying contract to Preview network...', '']);
      addLog('Deploying smart contract...', 'proof');
      
      try {
        const deployedController = await deployContract();
        if (deployedController) {
          setBootLines(prev => [...prev, `[OK] Contract deployed: ${deployedController.deployedContractAddress.slice(0, 16)}...`, '']);
          addLog(`Contract deployed: ${deployedController.deployedContractAddress}`, 'info');
          
          // Use secret from controller
          const newSecret = deployedController.getSecret();
          setSecret(newSecret);
        } else {
          setBootLines(prev => [...prev, '[ERR] Deployment failed. Falling back to demo mode.', '']);
          addLog('Deployment failed, using demo mode', 'info');
          const newSecret = generateRandomSecret();
          setSecret(newSecret);
          setUseOnChain(false);
        }
      } catch (e) {
        setBootLines(prev => [...prev, `[ERR] ${e}. Using demo mode.`, '']);
        addLog(`Error: ${e}`, 'info');
        const newSecret = generateRandomSecret();
        setSecret(newSecret);
        setUseOnChain(false);
      }
    } else {
      // Demo mode - just generate local secret
      const newSecret = generateRandomSecret();
      setSecret(newSecret);
      addLog('Game initialized (demo mode). Secret stored locally.', 'info');
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

    const inputY = h - 60;
    
    for (let i = 0; i < 4; i++) {
      const cx = w / 2 - 75 + i * 50;
      const dist = Math.sqrt((x - cx) ** 2 + (y - inputY) ** 2);
      if (dist < 20) {
        setCurrentGuess(prev => {
          const newGuess = [...prev] as [number, number, number, number];
          newGuess[i] = (newGuess[i] + 1) % 6;
          return newGuess;
        });
        break;
      }
    }
  }, [gameOver, isProving, isBooted]);

  const submitGuess = async () => {
    if (guesses.length >= 10 || gameOver || isProving) return;
    
    setIsProving(true);
    setCircuitLabel('GENERATING_SNARK_WITNESS...');
    addLog(`Compiling Guess #${guesses.length + 1} into circuit...`, 'proof');

    try {
      if (useOnChain && controller) {
        // On-chain mode: submit to contract
        addLog('Generating ZK proof for on-chain verification...', 'proof');
        setProgress(25);
        
        const result = await controller.submitGuess(currentGuess);
        setProgress(75);
        
        const newGuess: Guess = { code: [...currentGuess] as [number, number, number, number], black: result.black, white: result.white };
        setGuesses(prev => [...prev, newGuess]);
        
        addLog(`TX submitted. Result: ${result.black}✓ / ${result.white}~`, 'info');
        setProgress(100);

        if (result.black === 4) {
          setGameOver(true);
          addLog('CIPHER DECRYPTED! Win recorded on-chain.', 'info');
        }
      } else {
        // Demo mode: local verification
        const steps = ['Hashing input...', 'Applying constraints...', 'Satisfying R1CS...', 'Extracting Proof...'];
        for (let i = 0; i < steps.length; i++) {
          addLog(steps[i], 'proof');
          await sleep(400);
          setProgress((i + 1) * 25);
        }

        const result = calculatePegs(currentGuess, secret);
        const newGuess: Guess = { code: [...currentGuess] as [number, number, number, number], black: result.black, white: result.white };
        setGuesses(prev => [...prev, newGuess]);
        
        addLog(`Proof Verified. Result: ${result.black}✓ / ${result.white}~`, 'info');

        if (result.black === 4) {
          setGameOver(true);
          addLog('CIPHER DECRYPTED. BROADCASTING WIN...', 'info');
        }
      }
    } catch (e) {
      addLog(`Error: ${e}`, 'info');
    }
    
    setCircuitLabel('SYSTEM_IDLE');
    setProgress(0);
    setIsProving(false);
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

      // Draw grid rows
      for (let i = 0; i < 10; i++) {
        const rowY = 35 + i * 42;
        ctx.strokeStyle = '#1a3a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(55, rowY, w - 80, 36);
        ctx.fillStyle = '#1a3a2a';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`SEQ_${(i + 1).toString().padStart(2, '0')}`, 10, rowY + 22);
      }

      // Draw guesses
      guesses.forEach((g, row) => {
        const y = 35 + row * 42 + 18;
        g.code.forEach((cIdx, col) => {
          const cx = 85 + col * 40;
          ctx.fillStyle = COLORS[cIdx];
          ctx.shadowBlur = 8;
          ctx.shadowColor = COLORS[cIdx];
          ctx.beginPath();
          ctx.arc(cx, y, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        // Draw peg result - clear text format
        const pegX = 245;
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        
        // EXACT matches (green) - right color, right position
        ctx.fillStyle = '#00ff9d';
        ctx.fillText(`${g.black}✓`, pegX, y + 3);
        
        // CLOSE matches (yellow) - right color, wrong position  
        ctx.fillStyle = '#ffcc00';
        ctx.fillText(`${g.white}~`, pegX + 30, y + 3);

        ctx.fillStyle = '#444';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillText('OK', w - 22, y + 3);
      });

      // Draw input or game over
      if (!gameOver) {
        const inputY = h - 60;
        ctx.fillStyle = '#333';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText('// PENDING_GUESS //', w / 2 - 70, inputY - 35);

        currentGuess.forEach((cIdx, i) => {
          const cx = w / 2 - 75 + i * 50;
          ctx.fillStyle = COLORS[cIdx];
          ctx.shadowBlur = 12;
          ctx.shadowColor = COLORS[cIdx];
          ctx.beginPath();
          ctx.arc(cx, inputY, 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, inputY, 18, 0, Math.PI * 2);
          ctx.stroke();
        });
      } else {
        ctx.fillStyle = '#00ff9d';
        ctx.font = 'bold 24px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const lastGuess = guesses[guesses.length - 1];
        ctx.fillText(lastGuess?.black === 4 ? 'CIPHER_CRACKED' : 'ACCESS_REVOKED', w / 2, h - 60);
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
      `}</style>

      {/* Boot Screen */}
      {!isBooted && !isTerminalBooting && (
        <div className="boot-screen">
          <div className="boot-logo">SHADOWCIPHER</div>
          <div className="boot-sub">MIDNIGHT NETWORK // ZERO-KNOWLEDGE PROTOCOL</div>
          
          {!isWalletConnected ? (
            <>
              <div style={{ marginBottom: '15px' }}>
                <MidnightWallet />
              </div>
              <div style={{ fontSize: '10px', color: '#444', marginTop: '10px' }}>
                Lace Midnight Preview Wallet Required
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '10px', color: '#00ff9d', marginBottom: '20px' }}>
                WALLET_CONNECTED: {dustAddress?.dustAddress?.slice(0, 12)}...{dustAddress?.dustAddress?.slice(-6)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <button className="boot-btn" onClick={() => runTerminalBoot(true)}>
                  DEPLOY_CONTRACT (ON-CHAIN)
                </button>
                <button 
                  className="boot-btn" 
                  onClick={() => runTerminalBoot(false)}
                  style={{ opacity: 0.7, fontSize: '10px' }}
                >
                  DEMO_MODE (LOCAL)
                </button>
              </div>
              <div style={{ fontSize: '9px', color: '#444', marginTop: '15px', maxWidth: '300px', textAlign: 'center' }}>
                On-chain mode deploys a contract and records guesses to Preview network. Demo mode runs locally.
              </div>
            </>
          )}
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
        <div>SHADOWCIPHER_V1.1 // MIDNIGHT_PROTOCOL</div>
        <div style={{ color: useOnChain ? '#00ff9d' : '#666' }}>
          {useOnChain ? 'MODE: ON-CHAIN' : 'MODE: DEMO'} // {contractAddress ? `CONTRACT: ${contractAddress.slice(0, 8)}...` : 'NO CONTRACT'}
        </div>
        <div style={{ color: '#666' }}>NETWORK: PREVIEW</div>
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
                <div className="leaderboard-entry">
                  <span>USR_0x9F3...</span>
                  <span>04 ATTEMPTS</span>
                </div>
                <div className="leaderboard-entry" style={{ color: '#444' }}>
                  <span>USR_0x3A8...</span>
                  <span>06 ATTEMPTS</span>
                </div>
              </div>
            </div>

            <div className="controls">
              <button className="btn" onClick={submitGuess} disabled={isProving || gameOver}>
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

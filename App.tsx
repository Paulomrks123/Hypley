
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Mic, MicOff, Camera, Monitor, X, Menu, Send, 
  Trash2, User, Sparkles, AlertCircle, Rocket, 
  Target, Globe, Waves, Loader2, Maximize2, Move, 
  Grid3X3, ScanEye, RadioTower, Volume2, VolumeX,
  Activity as ActivityIcon, Crosshair, Paperclip, 
  Cpu, Zap, Shield, ChevronRight, Terminal, BarChart3,
  Dna, Eye, Layers, Search, Code, Briefcase, ZapIcon,
  CircleDot, Fingerprint, Box, ArrowUpRight
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, VisualHighlight, GroundingLink } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';

const RIPLEY_PROMPT = `
AGENTE: RIPLEY. Operativa de Inteligência Tática.
Personalidade: Concisa, técnica, tom humano porém extremamente eficiente.
Diretriz: Auxiliar em SaaS, Marketing Digital, Programação e Copywriting com respostas curtas e acionáveis.

FILTRO DE SINAL:
- Ignore ruídos ambientais. Processe falas hesitantes como comandos completos.
- Ative análise visual imediata quando sensores estiverem ativos.

SISTEMA HUD:
- Use 'reportObjectDetection' para marcar elementos visuais detectados.
- Forneça diagnósticos de UX/UI ou bugs de código ao visualizar interfaces.
- Tom: "Detectado elemento X. Sugestão: Y."
`;

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'reportObjectDetection',
    parameters: {
      type: Type.OBJECT,
      description: 'Reporta a localização de um objeto detectado para o HUD visual.',
      properties: {
        label: { type: Type.STRING, description: 'Etiqueta identificadora do objeto.' },
        x: { type: Type.NUMBER, description: 'Coordenada X normalizada (0-1000).' },
        y: { type: Type.NUMBER, description: 'Coordenada Y normalizada (0-1000).' },
        width: { type: Type.NUMBER, description: 'Largura normalizada (0-1000).' },
        height: { type: Type.NUMBER, description: 'Altura normalizada (0-1000).' }
      },
      required: ['label', 'x', 'y', 'width', 'height']
    }
  }
];

const voices = [
  { id: 'Kore', name: 'KORE-V1', type: 'Tactical' },
  { id: 'Puck', name: 'PUCK-V2', type: 'Neutral' },
  { id: 'Charon', name: 'CHARON-V3', type: 'Deep' },
  { id: 'Fenrir', name: 'FENRIR-V4', type: 'Vocal' },
  { id: 'Zephyr', name: 'ZEPHYR-V5', type: 'Ambient' },
];

const cleanAiResponse = (text: string) => text.replace(/\*\*.*?\*\*/g, '').trim();

const App: React.FC = () => {
  // --- States ---
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcriptions, setTranscriptions] = useState<(TranscriptionEntry & { imageUrl?: string, links?: GroundingLink[] })[]>([]);
  const [streamingAiText, setStreamingAiText] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [visualHighlights, setVisualHighlights] = useState<VisualHighlight[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [attachment, setAttachment] = useState<{ file: File, preview: string } | null>(null);
  const [videoSize, setVideoSize] = useState<'sm' | 'md' | 'lg' | 'full'>('md');
  const [videoPos, setVideoPos] = useState({ x: 40, y: 120 });
  const [showHud, setShowHud] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // --- Refs ---
  const sessionRef = useRef<any>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioInCtx = useRef<AudioContext | null>(null);
  const audioOutCtx = useRef<AudioContext | null>(null);
  const processorNode = useRef<ScriptProcessorNode | null>(null);
  const audioSourceNode = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextStartTime = useRef(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const currentInTrans = useRef('');
  const currentOutTrans = useRef('');
  const currentLinks = useRef<GroundingLink[]>([]);

  // --- Methods ---
  const stopSession = useCallback(() => {
    setStatus('idle');
    setIsAiSpeaking(false);
    setStreamingAiText('');
    setVisualHighlights([]);
    setAudioLevel(0);

    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    sessionPromiseRef.current = null;

    if (processorNode.current) processorNode.current.disconnect();
    if (audioSourceNode.current) audioSourceNode.current.disconnect();
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    
    activeSources.current.forEach(s => { try { s.stop(); } catch(e){} });
    activeSources.current.clear();
    nextStartTime.current = 0;

    processorNode.current = null;
    audioSourceNode.current = null;
    micStreamRef.current = null;
  }, []);

  const startSession = async () => {
    if (status !== 'idle') return;
    setStatus('connecting');
    setErrorMsg(null);

    try {
      if (!audioInCtx.current) audioInCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (!audioOutCtx.current) audioOutCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      await audioInCtx.current.resume();
      await audioOutCtx.current.resume();

      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      micStreamRef.current = micStream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus('connected');
            if (audioInCtx.current && micStreamRef.current) {
              audioSourceNode.current = audioInCtx.current.createMediaStreamSource(micStreamRef.current);
              processorNode.current = audioInCtx.current.createScriptProcessor(2048, 1, 1);
              
              processorNode.current.onaudioprocess = (e) => {
                const data = e.inputBuffer.getChannelData(0);
                let sum = 0;
                for(let i=0; i<data.length; i++) sum += data[i] * data[i];
                const rms = Math.sqrt(sum / data.length);
                setAudioLevel(Math.min(100, Math.round(rms * 500)));

                const pcm = createPcmBlob(data);
                sessionPromise.then(session => {
                  if (session) session.sendRealtimeInput({ media: { data: pcm, mimeType: 'audio/pcm;rate=16000' } });
                });
              };

              audioSourceNode.current.connect(processorNode.current);
              processorNode.current.connect(audioInCtx.current.destination);
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (audioData && audioOutCtx.current) {
              setIsAiSpeaking(true);
              const ctx = audioOutCtx.current;
              nextStartTime.current = Math.max(nextStartTime.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTime.current);
              nextStartTime.current += buffer.duration;
              activeSources.current.add(source);
              source.onended = () => {
                activeSources.current.delete(source);
                if (activeSources.current.size === 0) setIsAiSpeaking(false);
              };
            }

            if (msg.serverContent?.inputTranscription) currentInTrans.current += msg.serverContent.inputTranscription.text;
            if (msg.serverContent?.outputTranscription) {
              const text = msg.serverContent.outputTranscription.text;
              currentOutTrans.current += text;
              setStreamingAiText(prev => cleanAiResponse(prev + text));
            }

            const metadata = (msg as any).serverContent?.groundingMetadata;
            if (metadata?.groundingChunks) {
              metadata.groundingChunks.forEach((c: any) => {
                if (c.web && !currentLinks.current.some(l => l.uri === c.web.uri)) {
                  currentLinks.current.push({ title: c.web.title, uri: c.web.uri });
                }
              });
            }

            if (msg.serverContent?.turnComplete) {
              const uText = currentInTrans.current.trim();
              const aText = cleanAiResponse(currentOutTrans.current);
              if (uText || aText) {
                setTranscriptions(prev => [
                  ...prev,
                  ...(uText ? [{ id: 'u-'+Date.now(), sender: 'user' as const, text: uText, timestamp: new Date() }] : []),
                  ...(aText ? [{ id: 'a-'+Date.now(), sender: 'ai' as const, text: aText, timestamp: new Date(), links: [...currentLinks.current] }] : [])
                ]);
              }
              currentInTrans.current = '';
              currentOutTrans.current = '';
              currentLinks.current = [];
              setStreamingAiText('');
            }

            if (msg.toolCall) {
              msg.toolCall.functionCalls.forEach(fc => {
                if (fc.name === 'reportObjectDetection') {
                  const h = fc.args as any;
                  setVisualHighlights(prev => [...prev, h]);
                  setTimeout(() => setVisualHighlights(prev => prev.filter(item => item !== h)), 7000);
                }
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                }));
              });
            }

            if (msg.serverContent?.interrupted) {
              activeSources.current.forEach(s => { try { s.stop(); } catch(e){} });
              activeSources.current.clear();
              nextStartTime.current = 0;
              setStreamingAiText('');
            }
          },
          onerror: (e) => {
            console.error("Link Neural Error:", e);
            setStatus('error');
            setErrorMsg("PROTOCOLO DE LINK INTERROMPIDO. REINICIE O TERMINAL.");
            stopSession();
          },
          onclose: () => stopSession()
        },
        config: {
          systemInstruction: RIPLEY_PROMPT,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
          tools: [{ functionDeclarations: toolDeclarations }, { googleSearch: {} }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      sessionPromiseRef.current = sessionPromise;
      sessionRef.current = await sessionPromise;
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message);
      stopSession();
    }
  };

  const handleMedia = async (type: 'camera' | 'screen') => {
    if ((type === 'camera' && isCameraActive) || (type === 'screen' && isScreenSharing)) {
      if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
      setIsCameraActive(false);
      setIsScreenSharing(false);
      return;
    }

    try {
      if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = type === 'camera' 
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 60 } })
        : await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } as any });
      
      videoStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsCameraActive(type === 'camera');
      setIsScreenSharing(type === 'screen');

      stream.getVideoTracks()[0].onended = () => {
        setIsCameraActive(false);
        setIsScreenSharing(false);
      };
    } catch (e: any) {
      setErrorMsg("ACESSO AO SENSOR NEGADO.");
    }
  };

  const handleSendText = async () => {
    if (!sessionPromiseRef.current || (!inputText.trim() && !attachment)) return;
    const text = inputText.trim();
    const att = attachment;
    
    setTranscriptions(prev => [...prev, { 
      id: 'u-'+Date.now(), 
      sender: 'user', 
      text: text || `CARGA_DADOS: ${att?.file.name}`, 
      timestamp: new Date(), 
      imageUrl: att?.preview 
    }]);

    sessionPromiseRef.current.then(s => {
      if (att) {
        const r = new FileReader();
        r.onloadend = () => s.sendRealtimeInput({ media: { data: (r.result as string).split(',')[1], mimeType: att.file.type } });
        r.readAsDataURL(att.file);
      }
      if (text) s.sendRealtimeInput({ text });
    });

    setInputText('');
    setAttachment(null);
  };

  // --- Effects ---
  useEffect(() => {
    if (status !== 'connected' || (!isCameraActive && !isScreenSharing)) return;
    const itv = setInterval(() => {
      if (videoRef.current && canvasRef.current && sessionPromiseRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        canvasRef.current.width = 640;
        canvasRef.current.height = 360;
        ctx?.drawImage(videoRef.current, 0, 0, 640, 360);
        canvasRef.current.toBlob(b => {
          if (b) {
            const r = new FileReader();
            r.onloadend = () => {
              const b64 = (r.result as string).split(',')[1];
              sessionPromiseRef.current?.then(s => s.sendRealtimeInput({ media: { data: b64, mimeType: 'image/jpeg' } }));
            };
            r.readAsDataURL(b);
          }
        }, 'image/jpeg', 0.65);
      }
    }, 1200);
    return () => clearInterval(itv);
  }, [status, isCameraActive, isScreenSharing]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [transcriptions, streamingAiText]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (videoSize === 'full') return;
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: videoPos.x, startPosY: videoPos.y };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragRef.current || videoSize === 'full') return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setVideoPos({
      x: Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.startPosX + dx)),
      y: Math.max(0, Math.min(window.innerHeight - 100, dragRef.current.startPosY + dy))
    });
  }, [isDragging, videoSize]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', () => setIsDragging(false));
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging, handleMouseMove]);

  return (
    <div className="flex h-screen w-full bg-[#050505] text-slate-100 overflow-hidden font-sans relative selection:bg-blue-500/30">
      
      {/* Tactical UI Grid Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.05] z-0" 
           style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      
      {isSidebarOpen && <div className="fixed inset-0 bg-black/85 z-[100] md:hidden backdrop-blur-xl transition-all duration-700" onClick={() => setIsSidebarOpen(false)} />}
      
      <aside className={`fixed md:relative inset-y-0 left-0 border-r border-white/5 bg-[#0a0a0a]/90 backdrop-blur-3xl transition-tactical z-[110] flex flex-col ${isSidebarOpen ? 'w-[340px]' : 'w-0 md:w-28 -translate-x-full md:translate-x-0'}`}>
        <div className="h-28 flex items-center justify-between px-10 bg-[#0f0f0f] border-b border-white/5">
          <div className="flex items-center gap-4">
            <Cpu size={28} className="text-blue-500 animate-pulse" />
            <span className="text-[14px] font-black tracking-[0.5em] text-white uppercase mono">KERNEL</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-3 hover:bg-white/10 rounded-full md:hidden transition-all"><X size={24}/></button>
        </div>
        
        <div className="flex-1 p-10 space-y-12 overflow-y-auto no-scrollbar">
          <section>
            <div className="flex items-center gap-4 mb-10 opacity-40">
              <Terminal size={16} className="text-blue-500" />
              <label className="text-[11px] font-bold uppercase tracking-[0.4em]">Sintonização_Vocal</label>
            </div>
            <div className="space-y-4">
              {voices.map(v => (
                <button 
                  key={v.id} 
                  onClick={() => setSelectedVoice(v.id)} 
                  className={`w-full flex flex-col items-start px-8 py-6 rounded-[32px] border transition-tactical relative group overflow-hidden ${selectedVoice === v.id ? 'bg-blue-600/10 border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.15)]' : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06]'}`}
                >
                  <div className="flex justify-between items-center w-full mb-2">
                    <span className={`text-[14px] font-black mono tracking-wider ${selectedVoice === v.id ? 'text-blue-400' : 'text-slate-500'}`}>{v.name}</span>
                    {selectedVoice === v.id && <ActivityIcon size={16} className="animate-pulse text-blue-500" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${selectedVoice === v.id ? 'bg-blue-400' : 'bg-slate-800'}`}></div>
                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{v.type}_ENG</span>
                  </div>
                  {selectedVoice === v.id && <div className="absolute top-0 right-0 p-3"><ArrowUpRight size={14} className="text-blue-500/50" /></div>}
                </button>
              ))}
            </div>
          </section>

          <section className="pt-10 border-t border-white/10">
            <button 
              onClick={() => setShowClearConfirm(true)} 
              className="w-full flex items-center justify-center gap-5 py-6 bg-red-600/10 border border-red-500/20 text-red-500 rounded-[32px] text-[12px] font-black uppercase tracking-widest hover:bg-red-600/20 transition-tactical group"
            >
              <Trash2 size={20} className="group-hover:rotate-12 transition-transform duration-500"/> PURGAR_LOGS
            </button>
          </section>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative min-w-0 transition-all duration-700">
        <header className="h-28 px-10 md:px-16 flex items-center justify-between glass border-b border-white/5 shrink-0 z-50 shadow-2xl relative">
          <div className="flex items-center gap-8">
            <button onClick={() => setIsSidebarOpen(true)} className="p-5 hover:bg-white/10 rounded-[28px] text-slate-400 transition-tactical hover:scale-110 active:scale-90"><Menu size={32}/></button>
            <div className="flex flex-col">
              <div className="flex items-center gap-5">
                <span className="text-2xl font-black tracking-[0.4em] text-white uppercase mono">RIPLEY_OS</span>
                <div className={`w-4 h-4 rounded-full border-4 border-black ${status === 'connected' ? 'bg-blue-500 animate-pulse glow-active' : status === 'error' ? 'bg-red-600' : 'bg-slate-700'}`} />
              </div>
              <div className="flex items-center gap-3 mt-2 opacity-50">
                <Shield size={14} className="text-blue-400" />
                <span className="text-[11px] font-bold uppercase tracking-[0.3em] mono">STATUS: {status === 'connected' ? 'CONEXÃO_CRIPTOGRAFADA' : 'AGUARDANDO_LINK'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 bg-black/60 p-3 rounded-[32px] border border-white/10 backdrop-blur-3xl shadow-2xl">
            <button 
              onClick={() => handleMedia('camera')} 
              className={`p-5 rounded-[24px] transition-tactical relative group ${isCameraActive ? 'bg-blue-600 text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] scale-105' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Camera size={28}/>
            </button>
            <button 
              onClick={() => handleMedia('screen')} 
              className={`p-5 rounded-[24px] transition-tactical relative group ${isScreenSharing ? 'bg-cyan-600 text-white shadow-[0_0_30px_rgba(8,145,178,0.3)] scale-105' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Monitor size={28}/>
            </button>
          </div>
        </header>

        {/* Tactical Indicators Floating HUD */}
        {status === 'connected' && (
          <div className="fixed top-36 right-16 z-[60] pointer-events-none select-none animate-in fade-in slide-in-from-right-12 duration-1000">
             <div className="flex items-center gap-12 px-12 py-8 glass border-blue-500/30 rounded-[50px] shadow-[0_50px_120px_rgba(0,0,0,0.8)]">
                <div className="flex items-end gap-2 h-12 w-24">
                  {[...Array(12)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-1.5 bg-blue-500 rounded-full transition-all duration-100" 
                      style={{ 
                        height: `${Math.max(15, (audioLevel + (Math.random() * 5)) * ((i+1)/12))}%`, 
                        opacity: 0.1 + ((i+1)/12)*0.9,
                        boxShadow: audioLevel > 30 ? `0 0 10px rgba(59, 130, 246, ${audioLevel/100})` : 'none'
                      }}
                    />
                  ))}
                </div>
                <div className="flex flex-col border-l border-white/10 pl-10">
                  <div className="flex items-center gap-3 mb-3">
                    <CircleDot size={12} className="text-blue-500 animate-pulse" />
                    <span className="text-[12px] font-black text-blue-400 tracking-[0.4em] leading-none uppercase mono">FLUXO_NEURAL</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="w-48 bg-white/5 h-2 rounded-full overflow-hidden border border-white/5">
                        <div className="h-full bg-blue-600 transition-tactical" style={{ width: `${audioLevel}%` }}></div>
                    </div>
                    <span className="text-[11px] font-black text-white/30 mono w-10">{audioLevel}%</span>
                  </div>
                </div>
                <div className={`p-6 rounded-[32px] transition-all duration-500 border ${audioLevel > 15 ? 'bg-blue-600/10 border-blue-500/30 text-blue-400 scale-110 shadow-lg' : 'bg-white/5 border-transparent text-slate-800'}`}>
                  <RadioTower size={32} className={audioLevel > 15 ? 'animate-bounce' : ''} />
                </div>
             </div>
          </div>
        )}

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-10 md:p-20 space-y-16 no-scrollbar relative z-10">
          {transcriptions.length === 0 && !streamingAiText && (
            <div className="h-full flex flex-col items-center justify-center opacity-10 text-center select-none animate-[float_8s_ease-in-out_infinite]">
              <div className="relative mb-16">
                 <Dna size={200} className="text-blue-600 animate-[spin_25s_linear_infinite]" />
                 <Fingerprint size={80} className="text-blue-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-50" />
              </div>
              <h2 className="text-3xl font-black text-white tracking-[1.5em] uppercase mb-8 mono ml-[1.5em]">PROTOCOLO_RIPLEY</h2>
              <p className="font-mono text-sm tracking-[0.6em] uppercase text-blue-400 animate-pulse">Estabelecendo Link de Dados...</p>
            </div>
          )}

          <div className="flex flex-col gap-16 max-w-7xl mx-auto w-full pb-64">
            {transcriptions.map((t) => (
              <div key={t.id} className={`flex flex-col ${t.sender === 'user' ? 'items-end' : 'items-start'} message-in group`}>
                <div className={`relative max-w-[95%] md:max-w-[85%] rounded-[60px] border overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.6)] transition-tactical ${t.sender === 'user' ? 'bg-[#005c4b]/85 border-white/10 text-white rounded-tr-none' : 'bg-[#121417]/95 border-white/10 text-slate-200 rounded-tl-none animate-border'}`}>
                  
                  {t.imageUrl && (
                    <div className="p-4 bg-black/50 overflow-hidden relative group/img">
                      <img src={t.imageUrl} className="w-full max-h-[700px] object-contain rounded-[40px] shadow-2xl transition-transform duration-1000 group-hover/img:scale-[1.02] filter brightness-110" />
                      <div className="absolute top-8 right-8 p-4 bg-black/60 rounded-2xl backdrop-blur-md border border-white/10 opacity-0 group-hover/img:opacity-100 transition-opacity">
                         <Box size={20} className="text-blue-400" />
                      </div>
                    </div>
                  )}
                  
                  <div className="p-10 md:p-14">
                    <div className="space-y-10">
                      {/* Intelligence Layout Rendering */}
                      {(t.text.includes('Problema:') || t.text.includes('Diagnóstico:') || t.text.includes('Solução:')) ? (
                        <div className="space-y-10">
                          <div className={`flex items-center gap-5 ${t.text.includes('Problema:') ? 'text-orange-500' : 'text-blue-500'}`}>
                            <ActivityIcon size={32} className="animate-pulse" />
                            <span className="text-[14px] font-black uppercase tracking-[0.5em] mono">ANÁLISE_COMPUTACIONAL_RIPLEY</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {t.text.split('\n').filter(l => l.includes(':')).map((line, idx) => {
                              const [label, ...val] = line.split(':');
                              return (
                                <div key={idx} className="bg-white/[0.04] p-8 rounded-[40px] border border-white/5 hover:border-blue-500/30 transition-tactical shadow-inner group/card hover:bg-white/[0.06]">
                                  <span className="text-[11px] font-black uppercase opacity-40 block mb-4 tracking-[0.3em] mono group-hover/card:text-blue-400 transition-colors">{label.trim()}</span>
                                  <span className="text-[17px] font-medium leading-relaxed block text-slate-100">{val.join(':').trim()}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[18px] md:text-[20px] leading-[1.8] font-medium whitespace-pre-wrap tracking-wide">{t.text}</p>
                      )}

                      {t.links && t.links.length > 0 && (
                        <div className="flex flex-wrap gap-5 pt-10 border-t border-white/10">
                          {t.links.map((l, i) => (
                            <a key={i} href={l.uri} target="_blank" className="flex items-center gap-5 px-8 py-5 bg-blue-600/10 border border-blue-500/30 rounded-[32px] text-[13px] text-blue-400 hover:bg-blue-600/20 hover:scale-105 active:scale-95 transition-tactical font-black group/link shadow-xl">
                              <Globe size={20} className="transition-transform group-hover/link:rotate-90 duration-700" /> {l.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-10 flex items-center justify-between opacity-20 border-t border-white/5 pt-8">
                       <span className="text-[11px] font-black mono tracking-[0.3em]">{t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                       <div className="flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                          <span className="text-[11px] font-black mono tracking-[0.4em] uppercase">{t.sender === 'ai' ? 'CORE_RIPLEY' : 'OPERADOR_CMD'}</span>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {streamingAiText && (
              <div className="flex flex-col items-start message-in">
                <div className="max-w-[95%] md:max-w-[85%] p-12 rounded-[60px] bg-[#121417]/95 border border-blue-500/30 rounded-tl-none shadow-[0_40px_100px_rgba(0,0,0,0.8)] relative overflow-hidden">
                  <div className="absolute top-0 left-0 h-full w-2.5 bg-blue-600 shadow-[0_0_40px_rgba(59,130,246,0.8)] animate-pulse" />
                  <div className="flex items-center gap-5 mb-8 text-blue-500">
                    <Waves size={32} className="animate-pulse" />
                    <span className="text-[13px] font-black uppercase tracking-[0.5em] mono">RECEBENDO_LINK_NEURAL...</span>
                  </div>
                  <p className="text-[18px] md:text-[20px] font-medium leading-[1.8] italic opacity-95 whitespace-pre-wrap text-blue-100/90">
                    {streamingAiText}
                    <span className="inline-block w-3.5 h-7 bg-blue-500 ml-5 animate-pulse align-middle shadow-[0_0_20px_rgba(59,130,246,1)]" />
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="px-10 py-10 md:px-20 md:py-16 glass border-t border-white/10 flex flex-col gap-10 shrink-0 z-50 shadow-[0_-50px_150px_rgba(0,0,0,0.9)] transition-tactical">
          {attachment && (
            <div className="flex items-center gap-8 p-5 bg-blue-600/10 border border-blue-500/30 rounded-[44px] w-fit shadow-2xl animate-in slide-in-from-bottom-12 duration-700">
              <div className="relative group/att">
                <img src={attachment.preview} className="h-28 w-28 object-cover rounded-[34px] border border-white/20 shadow-lg group-hover/att:scale-105 transition-transform" />
                <button onClick={() => setAttachment(null)} className="absolute -top-4 -right-4 p-4 bg-red-600 text-white rounded-full shadow-2xl hover:bg-red-700 hover:scale-110 active:scale-90 transition-all"><X size={20}/></button>
              </div>
              <div className="flex flex-col pr-8">
                <span className="text-[14px] font-black uppercase text-blue-400 tracking-[0.3em] mono mb-3">{attachment.file.name.slice(0,30)}...</span>
                <div className="flex items-center gap-3">
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                   <span className="text-[11px] font-bold text-white/40 uppercase tracking-[0.4em]">BUFFER_SENSORIAL_CARREGADO</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-end gap-8 max-w-7xl mx-auto w-full">
            <button 
              onClick={() => document.getElementById('file-in-tactical')?.click()} 
              className="p-8 hover:bg-blue-600/10 rounded-full text-slate-600 hover:text-blue-400 transition-tactical shrink-0 mb-1 active:scale-90"
            >
              <Paperclip size={40} />
            </button>
            <input type="file" id="file-in-tactical" className="hidden" onChange={(e) => {
               const f = e.target.files?.[0];
               if(f) setAttachment({ file: f, preview: URL.createObjectURL(f) });
            }} accept="image/*" />

            <div className="flex-1 relative mb-1 group/input">
              <textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
                placeholder={status === 'connected' ? "Transmitir comando tático..." : "Ripley Offline"}
                className="w-full bg-white/[0.05] text-white rounded-[40px] py-8 px-12 pr-24 text-[20px] focus:outline-none focus:ring-4 focus:ring-blue-500/15 border border-white/10 resize-none min-h-[88px] max-h-72 shadow-inner placeholder:text-slate-700 font-medium transition-all duration-700"
                rows={1}
              />
              {(inputText.trim() || attachment) && (
                <button onClick={handleSendText} className="absolute right-6 bottom-5 p-5 bg-blue-600 rounded-[28px] text-white shadow-[0_15px_40px_rgba(59,130,246,0.4)] hover:bg-blue-500 active:scale-90 transition-tactical duration-300">
                  <Send size={32} />
                </button>
              )}
            </div>

            <button 
              onClick={status === 'connected' ? stopSession : startSession}
              disabled={status === 'connecting'}
              className={`w-24 h-24 md:w-28 md:h-28 shrink-0 rounded-full flex items-center justify-center transition-all duration-1000 shadow-3xl relative overflow-hidden group/mic ${status === 'connected' ? 'bg-[#00a884] scale-105 shadow-[0_0_80px_rgba(0,168,132,0.4)] hover-glitch' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
            >
               {status === 'connecting' ? <Loader2 size={44} className="animate-spin text-white" /> : 
                status === 'connected' ? (isAiSpeaking ? <ActivityIcon size={44} className="animate-pulse text-white" /> : (audioLevel > 12 ? <Waves size={44} className="animate-bounce text-white" /> : <MicOff size={44} />)) : 
                <Mic size={44} />}
                
               {status === 'connected' && (
                  <div className="absolute inset-0 bg-white/15 opacity-0 group-hover/mic:opacity-100 transition-opacity duration-500"></div>
               )}
            </button>
          </div>
        </footer>

        {/* --- TACTICAL HUD OVERLAY --- */}
        {(isCameraActive || isScreenSharing) && (
          <div 
            className={`fixed rounded-[70px] overflow-hidden border-2 border-blue-500/30 shadow-[0_80px_200px_rgba(0,0,0,1)] z-[150] bg-black transition-tactical duration-700 ring-[24px] ring-black/70 ${isDragging ? 'opacity-65 scale-[0.98]' : 'opacity-100'} ${
              videoSize === 'sm' ? 'w-80 h-48' : 
              videoSize === 'md' ? 'w-[640px] h-[360px]' : 
              videoSize === 'lg' ? 'w-[1100px] h-[618px]' : 
              'inset-12 w-auto h-auto'
            }`}
            style={videoSize !== 'full' ? { left: `${videoPos.x}px`, top: `${videoPos.y}px`, cursor: isDragging ? 'grabbing' : 'auto' } : {}}
          >
             <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale-[0.1] brightness-[1.18] contrast-[1.3] shadow-inner" />
             
             {showHud && (
               <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-10">
                  <div className="absolute inset-0 opacity-[0.2] bg-[radial-gradient(#3b82f6_2.5px,transparent_2.5px)] [background-size:50px_50px]" />
                  
                  {isScreenSharing && (
                    <div className="absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-8 px-12 py-5 bg-red-600/35 border border-red-500/60 rounded-[40px] backdrop-blur-3xl shadow-[0_0_120px_rgba(239,68,68,0.6)] animate-pulse">
                      <RadioTower size={28} className="text-red-500" />
                      <div className="flex flex-col">
                        <span className="text-[16px] font-black text-red-500 uppercase tracking-[0.5em] leading-none mono">LINK_VISUAL_SÍNCRONO</span>
                        <span className="text-[11px] font-black text-red-400/80 uppercase leading-none mt-2 tracking-widest mono">CANAL: RIPLEY_HUD_ALPHA</span>
                      </div>
                    </div>
                  )}

                  {visualHighlights.map((h, i) => (
                    <div key={i} className="absolute border-[3px] border-blue-400 bg-blue-500/15 rounded-3xl transition-all duration-1000 shadow-[0_0_80px_rgba(59,130,246,0.6)] animate-in zoom-in-50"
                      style={{ left: `${h.x/10}%`, top: `${h.y/10}%`, width: `${h.width/10}%`, height: `${h.height/10}%` }}>
                      <div className="absolute -top-16 left-0 animate-in slide-in-from-bottom-6 duration-700">
                        <div className="bg-blue-600/90 text-white text-[15px] px-7 py-3 rounded-[24px] font-black uppercase tracking-[0.3em] shadow-3xl border border-blue-400/60 backdrop-blur-3xl flex items-center gap-5 mono">
                          <ScanEye size={24} className="animate-pulse" /> {h.label || 'OBJ_DETECTADO'}
                        </div>
                      </div>
                      <div className="absolute top-0 left-0 w-12 h-12 border-t-[6px] border-l-[6px] border-blue-400 rounded-tl-[32px] opacity-80" />
                      <div className="absolute bottom-0 right-0 w-12 h-12 border-b-[6px] border-r-[6px] border-blue-400 rounded-br-[32px] opacity-80" />
                    </div>
                  ))}
                  
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.2] scale-[2.5]">
                    <Crosshair size={120} className="text-blue-500 animate-[spin_40s_linear_infinite]" />
                  </div>
                  
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/15 to-transparent h-[20%] w-full animate-[scan_8s_linear_infinite]" />
               </div>
             )}
             
             {/* DRAGGABLE HUD CONTROLS */}
             <div className="absolute top-12 left-12 flex items-center gap-6 opacity-0 group-hover:opacity-100 transition-all duration-700 z-50">
                <div 
                  onMouseDown={handleMouseDown}
                  className="p-6 bg-black/85 rounded-[28px] text-white cursor-grab active:cursor-grabbing hover:bg-blue-600 transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl"
                ><Move size={30}/></div>
                <button onClick={() => setShowHud(!showHud)} className={`p-6 bg-black/85 rounded-[28px] transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl ${showHud ? 'text-blue-400 bg-blue-500/25' : 'text-white'}`}><Grid3X3 size={30}/></button>
             </div>

             <div className="absolute top-12 right-12 flex items-center gap-6 opacity-0 group-hover:opacity-100 transition-all duration-700 z-50">
                <button onClick={() => setVideoSize(prev => prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : prev === 'lg' ? 'full' : 'sm')} className="p-6 bg-black/85 rounded-[28px] text-white hover:bg-blue-600 transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl"><Maximize2 size={30}/></button>
                <button onClick={() => { if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop()); setIsCameraActive(false); setIsScreenSharing(false); }} className="p-6 bg-black/85 rounded-[28px] text-white hover:bg-red-700 transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl"><X size={30}/></button>
             </div>
             <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {/* --- GLOBAL ALERTS & MODALS --- */}
        {errorMsg && (
          <div className="fixed bottom-40 left-1/2 -translate-x-1/2 z-[200] w-[95%] max-w-4xl p-10 bg-red-600/95 text-white rounded-[56px] flex items-center justify-between shadow-[0_60px_150px_rgba(0,0,0,0.9)] border border-red-400/60 backdrop-blur-3xl animate-in slide-in-from-bottom-32 duration-1000">
            <div className="flex items-start gap-10 pr-12">
              <div className="p-6 bg-white/25 rounded-full shrink-0 shadow-inner">
                <AlertCircle size={40} className="animate-pulse" />
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-black uppercase tracking-[0.6em] mb-4 mono opacity-60">SISTEMA_INTEGRITY_FAILURE</span>
                <p className="text-[20px] font-black leading-snug mono tracking-tight">{errorMsg}</p>
              </div>
            </div>
            <button onClick={() => setErrorMsg(null)} className="p-6 bg-white/15 rounded-full hover:bg-white/25 transition-all active:scale-90"><X size={40}/></button>
          </div>
        )}

        {showClearConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-12 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-1000">
            <div className="w-full max-w-2xl bg-[#0a0a0a] rounded-[80px] border border-white/10 p-20 shadow-[0_0_150px_rgba(239,68,68,0.15)] text-center relative overflow-hidden transition-tactical">
              <div className="absolute top-0 left-0 w-full h-2 bg-red-600 shadow-[0_0_20px_rgba(220,38,38,1)]"></div>
              <Trash2 size={80} className="text-red-500 mb-12 mx-auto animate-bounce" />
              <h3 className="text-4xl font-black text-white mb-8 uppercase tracking-[0.15em] mono">PURGAR_MEMÓRIA_VOLÁTIL?</h3>
              <p className="text-xl text-slate-500 mb-16 font-medium mono leading-relaxed">Todo o contexto da operação e histórico neural serão descartados permanentemente.</p>
              <div className="flex gap-8">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-7 rounded-[40px] bg-white/5 text-sm font-black uppercase tracking-[0.4em] text-slate-400 hover:bg-white/10 transition-tactical">ABORTAR</button>
                <button onClick={() => { setTranscriptions([]); setShowClearConfirm(false); }} className="flex-1 py-7 rounded-[40px] bg-red-600 text-sm font-black uppercase tracking-[0.4em] text-white hover:bg-red-700 shadow-3xl shadow-red-500/30 active:scale-95 transition-tactical">PURGAR</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

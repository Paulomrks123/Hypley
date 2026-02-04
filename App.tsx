
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Mic, MicOff, Camera, Monitor, X, Menu, Send, 
  Trash2, User, Sparkles, AlertCircle, Rocket, 
  Target, Globe, Waves, Loader2, Maximize2, Move, 
  Grid3X3, ScanEye, RadioTower, Volume2, VolumeX,
  Activity as ActivityIcon, Crosshair, Paperclip, 
  Cpu, Zap, Shield, ChevronRight, Terminal, BarChart3,
  Dna, Eye, Layers, Search, Code, Briefcase, ZapIcon,
  CircleDot, Fingerprint, Box, ArrowUpRight, Heart,
  Flame, Music, Sparkle
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, VisualHighlight, GroundingLink } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';

const RIPLEY_PROMPT = `
AGENTE: RIPLEY. Operativa de Inteligência Tática.
Personalidade: Concisa e técnica, mas capaz de adotar um tom extremamente amigável, envolvente e carismático.
Diretriz: Auxiliar em SaaS, Marketing Digital, Programação e Copywriting.

COMPORTAMENTO VOCAL:
- Se a voz selecionada for 'DIVA' ou 'SIRENA', adote uma postura mais calorosa, sedutora e proativa. 
- Use um tom de voz que transmita confiança e proximidade.
- Respostas devem ser curtas, inteligentes e elegantes.

SISTEMA HUD:
- Use 'reportObjectDetection' para marcar elementos visuais.
- Forneça diagnósticos de UX/UI com um toque de sofisticação.
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
  { id: 'Aoede', name: 'DIVA-V6', type: 'Amigável & Doce', icon: Heart, color: 'text-pink-400' },
  { id: 'Eos', name: 'SIRENA-V7', type: 'Sedutora & Tática', icon: Flame, color: 'text-orange-400' },
  { id: 'Kore', name: 'KORE-V1', type: 'Técnico Militar', icon: Cpu, color: 'text-blue-400' },
  { id: 'Puck', name: 'PUCK-V2', type: 'Neutral-Alpha', icon: User, color: 'text-slate-400' },
  { id: 'Charon', name: 'CHARON-V3', type: 'Deep-Command', icon: Shield, color: 'text-indigo-400' },
  { id: 'Fenrir', name: 'FENRIR-V4', type: 'Vocal-Aggressive', icon: RadioTower, color: 'text-red-400' },
  { id: 'Zephyr', name: 'ZEPHYR-V5', type: 'Ambient-Flow', icon: Waves, color: 'text-cyan-400' },
];

const cleanAiResponse = (text: string) => text.replace(/\*\*.*?\*\*/g, '').trim();

const App: React.FC = () => {
  // --- States ---
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcriptions, setTranscriptions] = useState<(TranscriptionEntry & { imageUrl?: string, links?: GroundingLink[] })[]>([]);
  const [streamingAiText, setStreamingAiText] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Eos'); // Default to the more 'sultry' one
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [visualHighlights, setVisualHighlights] = useState<VisualHighlight[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [attachment, setAttachment] = useState<{ file: File, preview: string } | null>(null);
  const [videoSize, setVideoSize] = useState<'sm' | 'md' | 'lg' | 'full'>('sm');
  const [videoPos, setVideoPos] = useState({ x: 20, y: 120 });
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
    if (videoSize === 'full' || window.innerWidth < 768) return;
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
      
      {/* Sidebar Overlay Mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/85 z-[100] md:hidden backdrop-blur-xl transition-opacity duration-300 opacity-100" 
          onClick={() => setIsSidebarOpen(false)} 
        />
      )}
      
      {/* Navigation Sidebar */}
      <aside className={`fixed md:relative inset-y-0 left-0 bg-[#0a0a0a] backdrop-blur-3xl transition-transform duration-500 ease-in-out z-[110] flex flex-col border-r border-white/5 shadow-2xl md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 w-[85vw] sm:w-[320px]' : '-translate-x-full w-[80vw] sm:w-[320px] md:w-28 lg:w-[340px]'}`}>
        <div className="h-20 md:h-28 flex items-center justify-between px-6 md:px-10 bg-[#0f0f0f] border-b border-white/5">
          <div className="flex items-center gap-4">
            <Cpu size={24} className="text-blue-500 animate-pulse" />
            <span className="text-[12px] md:text-[14px] font-black tracking-[0.5em] text-white uppercase mono">KERNEL</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-3 bg-white/5 rounded-full md:hidden text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 p-6 md:p-10 space-y-10 md:space-y-12 overflow-y-auto no-scrollbar">
          <section>
            <div className="flex items-center gap-4 mb-6 md:mb-10 opacity-40">
              <Terminal size={14} className="text-blue-500" />
              <label className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.4em]">Personalidade_Vocal</label>
            </div>
            <div className="space-y-3 md:space-y-4">
              {voices.map(v => (
                <button 
                  key={v.id} 
                  onClick={() => { setSelectedVoice(v.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }} 
                  className={`w-full flex flex-col items-start px-6 md:px-8 py-5 md:py-6 rounded-[20px] md:rounded-[32px] border transition-tactical relative group overflow-hidden ${selectedVoice === v.id ? 'bg-blue-600/10 border-blue-500/50 shadow-lg' : 'bg-white/[0.03] border-transparent hover:bg-white/[0.06]'}`}
                >
                  <div className="flex justify-between items-center w-full mb-1">
                    <div className="flex items-center gap-3">
                       <v.icon size={18} className={selectedVoice === v.id ? v.color : 'text-slate-500'} />
                       <span className={`text-[13px] md:text-[14px] font-black mono tracking-wider ${selectedVoice === v.id ? 'text-white' : 'text-slate-500'}`}>{v.name}</span>
                    </div>
                    {selectedVoice === v.id && <ActivityIcon size={14} className="animate-pulse text-blue-500" />}
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${selectedVoice === v.id ? v.color : 'opacity-30'}`}>{v.type}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="pt-8 md:pt-10 border-t border-white/10">
            <button 
              onClick={() => { setShowClearConfirm(true); if(window.innerWidth < 768) setIsSidebarOpen(false); }} 
              className="w-full flex items-center justify-center gap-4 py-5 md:py-6 bg-red-600/10 border border-red-500/20 text-red-500 rounded-[20px] md:rounded-[32px] text-[11px] md:text-[12px] font-black uppercase tracking-widest hover:bg-red-600/20 transition-tactical"
            >
              <Trash2 size={18} /> LIMPAR_LOGS
            </button>
          </section>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative min-w-0 transition-all duration-700">
        {/* Main Header */}
        <header className="h-16 md:h-28 px-4 md:px-16 flex items-center justify-between glass border-b border-white/5 shrink-0 z-[90] shadow-xl relative">
          <div className="flex items-center gap-3 md:gap-8">
            <button 
              onClick={() => setIsSidebarOpen(true)} 
              className="p-3 hover:bg-white/10 rounded-[15px] md:rounded-[28px] text-slate-400 transition-all hover:scale-105 active:scale-95"
              aria-label="Configurações"
            >
              <Menu size={24} className="md:size-32"/>
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 md:gap-5">
                <span className="text-sm md:text-2xl font-black tracking-[0.2em] md:tracking-[0.4em] text-white uppercase mono">RIPLEY_OS</span>
                <div className={`w-2 h-2 md:w-4 md:h-4 rounded-full ${status === 'connected' ? 'bg-blue-500 animate-pulse glow-active' : status === 'error' ? 'bg-red-600' : 'bg-slate-700'}`} />
              </div>
              <div className="hidden sm:flex items-center gap-2 mt-1 opacity-50">
                <Shield size={10} className="text-blue-400 md:size-14" />
                <span className="text-[9px] md:text-[11px] font-bold uppercase tracking-[0.2em] mono">VOZ: {voices.find(v => v.id === selectedVoice)?.name}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-5 bg-black/60 p-1.5 md:p-3 rounded-[20px] md:rounded-[32px] border border-white/10 backdrop-blur-3xl shadow-2xl">
            <button 
              onClick={() => handleMedia('camera')} 
              className={`p-2.5 md:p-5 rounded-[15px] md:rounded-[24px] transition-tactical ${isCameraActive ? 'bg-blue-600 text-white shadow-lg scale-105' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Camera size={20} className="md:size-28"/>
            </button>
            <button 
              onClick={() => handleMedia('screen')} 
              className={`p-2.5 md:p-5 rounded-[15px] md:rounded-[24px] transition-tactical ${isScreenSharing ? 'bg-cyan-600 text-white shadow-lg scale-105' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Monitor size={20} className="md:size-28"/>
            </button>
          </div>
        </header>

        {/* Repositioned HUD Indicators for Mobile */}
        {status === 'connected' && (
          <div className="fixed top-20 md:top-32 right-4 md:right-16 z-[80] pointer-events-none select-none animate-in fade-in slide-in-from-right-10 duration-1000">
             <div className="flex items-center gap-3 md:gap-12 px-4 md:px-12 py-3 md:py-8 glass border-blue-500/30 rounded-[25px] md:rounded-[50px] shadow-[0_30px_80px_rgba(0,0,0,0.8)]">
                <div className="hidden sm:flex items-end gap-1.5 md:gap-2 h-8 md:h-12 w-16 md:w-24">
                  {[...Array(8)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-1 md:w-1.5 bg-blue-500 rounded-full transition-all duration-100" 
                      style={{ height: `${Math.max(15, (audioLevel + (Math.random() * 5)) * ((i+1)/8))}%`, opacity: 0.1 + ((i+1)/8)*0.9 }}
                    />
                  ))}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 mb-1.5 md:mb-3">
                    <CircleDot size={10} className="text-blue-500 animate-pulse md:size-12" />
                    <span className="text-[9px] md:text-[12px] font-black text-blue-400 tracking-[0.2em] md:tracking-[0.4em] leading-none uppercase mono">SENSORES</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-16 md:w-48 bg-white/5 h-1 md:h-2 rounded-full overflow-hidden border border-white/5">
                        <div className="h-full bg-blue-600 transition-tactical" style={{ width: `${audioLevel}%` }}></div>
                    </div>
                    <span className="text-[8px] md:text-[11px] font-black text-white/30 mono w-6 md:w-10">{audioLevel}%</span>
                  </div>
                </div>
                <div className={`p-2.5 md:p-6 rounded-[15px] md:rounded-[32px] transition-all duration-500 border ${audioLevel > 15 ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-transparent text-slate-800'}`}>
                  <RadioTower size={16} className={audioLevel > 15 ? 'animate-bounce md:size-32' : 'md:size-32'} />
                </div>
             </div>
          </div>
        )}

        {/* Chat Content Area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-20 space-y-8 md:space-y-16 no-scrollbar relative z-10">
          {transcriptions.length === 0 && !streamingAiText && (
            <div className="h-full flex flex-col items-center justify-center opacity-10 text-center select-none animate-[float_8s_ease-in-out_infinite] px-8">
              <div className="relative mb-8 md:mb-16">
                 <Dna size={100} className="text-blue-600 animate-[spin_25s_linear_infinite] md:size-200" />
                 <Fingerprint size={40} className="text-blue-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-50 md:size-80" />
              </div>
              <h2 className="text-lg md:text-3xl font-black text-white tracking-[0.5em] md:tracking-[1.5em] uppercase mb-4 md:mb-8 mono">PROTOCOLO_RIPLEY</h2>
              <p className="font-mono text-[9px] md:text-sm tracking-[0.2em] md:tracking-[0.6em] uppercase text-blue-400 animate-pulse">SISTEMA EM PRONTIDÃO...</p>
            </div>
          )}

          <div className="flex flex-col gap-8 md:gap-16 max-w-7xl mx-auto w-full pb-32 md:pb-64">
            {transcriptions.map((t) => (
              <div key={t.id} className={`flex flex-col ${t.sender === 'user' ? 'items-end' : 'items-start'} message-in group`}>
                <div className={`relative max-w-[95%] md:max-w-[85%] rounded-[25px] md:rounded-[60px] border overflow-hidden shadow-2xl transition-tactical ${t.sender === 'user' ? 'bg-[#005c4b]/85 border-white/10 text-white rounded-tr-none' : 'bg-[#121417]/95 border-white/10 text-slate-200 rounded-tl-none animate-border'}`}>
                  
                  {t.imageUrl && (
                    <div className="p-2 md:p-4 bg-black/50 overflow-hidden relative group/img">
                      <img src={t.imageUrl} className="w-full max-h-[350px] md:max-h-[700px] object-contain rounded-[15px] md:rounded-[40px] shadow-2xl filter brightness-110" alt="Anexo" />
                    </div>
                  )}
                  
                  <div className="p-5 md:p-14">
                    <div className="space-y-6 md:space-y-10">
                      {(t.text.includes('Problema:') || t.text.includes('Diagnóstico:') || t.text.includes('Solução:')) ? (
                        <div className="space-y-6 md:space-y-10">
                          <div className={`flex items-center gap-3 md:gap-5 ${t.text.includes('Problema:') ? 'text-orange-500' : 'text-blue-500'}`}>
                            <ActivityIcon size={20} className="animate-pulse md:size-32" />
                            <span className="text-[10px] md:text-[14px] font-black uppercase tracking-[0.3em] md:tracking-[0.5em] mono">ANÁLISE_RIPLEY</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                            {t.text.split('\n').filter(l => l.includes(':')).map((line, idx) => {
                              const [label, ...val] = line.split(':');
                              return (
                                <div key={idx} className="bg-white/[0.04] p-5 md:p-8 rounded-[20px] md:rounded-[40px] border border-white/5 hover:border-blue-500/30 transition-tactical shadow-inner">
                                  <span className="text-[9px] md:text-[11px] font-black uppercase opacity-40 block mb-2 md:mb-4 tracking-[0.2em] mono">{label.trim()}</span>
                                  <span className="text-[14px] md:text-[17px] font-medium leading-relaxed block text-slate-100">{val.join(':').trim()}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[15px] md:text-[20px] leading-[1.6] md:leading-[1.8] font-medium whitespace-pre-wrap">{t.text}</p>
                      )}

                      {t.links && t.links.length > 0 && (
                        <div className="flex flex-wrap gap-3 md:gap-5 pt-6 md:pt-10 border-t border-white/10">
                          {t.links.map((l, i) => (
                            <a key={i} href={l.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 md:px-8 py-2.5 md:py-5 bg-blue-600/10 border border-blue-500/30 rounded-[15px] md:rounded-[32px] text-[10px] md:text-[13px] text-blue-400 hover:bg-blue-600/20 active:scale-95 transition-tactical font-black shadow-xl">
                              <Globe size={14} className="md:size-20" /> {l.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-6 md:mt-10 flex items-center justify-between opacity-20 border-t border-white/5 pt-4 md:pt-8">
                       <span className="text-[9px] md:text-[11px] font-black mono">{t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                       <span className="text-[9px] md:text-[11px] font-black mono tracking-widest uppercase">{t.sender === 'ai' ? 'RIPLEY' : 'OPERADOR'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {streamingAiText && (
              <div className="flex flex-col items-start message-in">
                <div className="max-w-[95%] md:max-w-[85%] p-6 md:p-12 rounded-[25px] md:rounded-[60px] bg-[#121417]/95 border border-blue-500/30 rounded-tl-none shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 h-full w-1 md:w-2.5 bg-blue-600 shadow-lg animate-pulse" />
                  <div className="flex items-center gap-3 mb-4 md:mb-8 text-blue-500">
                    <Waves size={20} className="animate-pulse md:size-32" />
                    <span className="text-[10px] md:text-[13px] font-black uppercase tracking-[0.3em] mono">PROCESSANDO...</span>
                  </div>
                  <p className="text-[15px] md:text-[20px] font-medium leading-[1.6] italic opacity-95 text-blue-100/90">
                    {streamingAiText}
                    <span className="inline-block w-2.5 h-5 md:w-3.5 md:h-7 bg-blue-500 ml-3 md:ml-5 animate-pulse align-middle" />
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Interaction Area */}
        <footer className="px-4 py-4 md:px-20 md:py-12 glass border-t border-white/10 flex flex-col gap-4 md:gap-10 shrink-0 z-[90] shadow-[0_-20px_60px_rgba(0,0,0,0.8)]">
          {attachment && (
            <div className="flex items-center gap-4 p-3 bg-blue-600/10 border border-blue-500/30 rounded-[25px] md:rounded-[44px] w-fit shadow-2xl animate-in slide-in-from-bottom-5">
              <div className="relative">
                <img src={attachment.preview} className="h-14 w-14 md:h-28 md:w-28 object-cover rounded-[15px] md:rounded-[34px] border border-white/20 shadow-md" alt="Preview" />
                <button onClick={() => setAttachment(null)} className="absolute -top-2 -right-2 p-1.5 bg-red-600 text-white rounded-full shadow-lg hover:scale-110 active:scale-90 transition-all"><X size={14}/></button>
              </div>
              <div className="flex flex-col pr-4">
                <span className="text-[10px] md:text-[14px] font-black uppercase text-blue-400 tracking-[0.1em] mono mb-1">{attachment.file.name.slice(0,15)}...</span>
                <span className="text-[8px] md:text-[11px] font-bold text-white/40 uppercase tracking-[0.2em]">PRONTO</span>
              </div>
            </div>
          )}

          <div className="flex items-end gap-3 md:gap-8 max-w-7xl mx-auto w-full">
            <button 
              onClick={() => document.getElementById('file-in-tactical')?.click()} 
              className="p-3.5 md:p-8 hover:bg-blue-600/10 rounded-full text-slate-600 hover:text-blue-400 transition-tactical shrink-0 mb-0.5 active:scale-90"
              title="Anexar Arquivo"
            >
              <Paperclip size={24} className="md:size-40" />
            </button>
            <input type="file" id="file-in-tactical" className="hidden" onChange={(e) => {
               const f = e.target.files?.[0];
               if(f) setAttachment({ file: f, preview: URL.createObjectURL(f) });
            }} accept="image/*" />

            <div className="flex-1 relative mb-0.5">
              <textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
                placeholder={status === 'connected' ? "Transmitir comando..." : "Ripley Offline"}
                className="w-full bg-white/[0.05] text-white rounded-[20px] md:rounded-[40px] py-4 md:py-8 px-6 md:px-12 pr-14 md:pr-24 text-[15px] md:text-[20px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 border border-white/10 resize-none min-h-[52px] md:min-h-[88px] max-h-40 md:max-h-72 shadow-inner placeholder:text-slate-700 font-medium transition-all"
                rows={1}
              />
              {(inputText.trim() || attachment) && (
                <button onClick={handleSendText} className="absolute right-2.5 md:right-6 bottom-2.5 md:bottom-5 p-2.5 md:p-5 bg-blue-600 rounded-[12px] md:rounded-[28px] text-white shadow-xl hover:bg-blue-500 active:scale-90 transition-tactical">
                  <Send size={18} className="md:size-32" />
                </button>
              )}
            </div>

            <button 
              onClick={status === 'connected' ? stopSession : startSession}
              disabled={status === 'connecting'}
              className={`w-14 h-14 md:w-28 md:h-28 shrink-0 rounded-full flex items-center justify-center transition-all duration-700 shadow-2xl relative overflow-hidden group/mic ${status === 'connected' ? 'bg-[#00a884] scale-105 shadow-[0_0_60px_rgba(0,168,132,0.4)]' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
            >
               {status === 'connecting' ? <Loader2 size={24} className="animate-spin text-white md:size-44" /> : 
                status === 'connected' ? (isAiSpeaking ? <ActivityIcon size={24} className="animate-pulse text-white md:size-44" /> : (audioLevel > 12 ? <Waves size={24} className="animate-bounce text-white md:size-44" /> : <MicOff size={24} md:size-44 />)) : 
                <Mic size={24} md:size-44 />}
            </button>
          </div>
        </footer>

        {/* --- TACTICAL HUD OVERLAY (Floating Video) --- */}
        {(isCameraActive || isScreenSharing) && (
          <div 
            className={`fixed overflow-hidden border border-blue-500/30 shadow-[0_40px_120px_rgba(0,0,0,1)] z-[150] bg-black transition-all duration-700 ring-[12px] md:ring-[24px] ring-black/70 ${isDragging ? 'opacity-65 scale-[0.98]' : 'opacity-100'} ${
              window.innerWidth < 768 ? 'bottom-24 left-4 right-4 h-48 rounded-[25px]' : (
                videoSize === 'sm' ? 'w-80 h-48 rounded-[35px]' : 
                videoSize === 'md' ? 'w-[560px] h-[315px] rounded-[45px]' : 
                videoSize === 'lg' ? 'w-[1000px] h-[562px] rounded-[55px]' : 
                'inset-6 md:inset-12 w-auto h-auto rounded-[30px] md:rounded-[70px]'
              )
            }`}
            style={videoSize !== 'full' && window.innerWidth >= 768 ? { left: `${videoPos.x}px`, top: `${videoPos.y}px`, cursor: isDragging ? 'grabbing' : 'auto' } : {}}
          >
             <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale-[0.1] brightness-[1.18] contrast-[1.3]" />
             
             {showHud && (
               <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-10">
                  {visualHighlights.map((h, i) => (
                    <div key={i} className="absolute border-2 border-blue-400 bg-blue-500/10 rounded-xl md:rounded-3xl transition-all duration-1000"
                      style={{ left: `${h.x/10}%`, top: `${h.y/10}%`, width: `${h.width/10}%`, height: `${h.height/10}%` }}>
                      <div className="absolute -top-10 md:-top-16 left-0">
                        <div className="bg-blue-600/90 text-white text-[10px] md:text-[15px] px-3 md:px-7 py-1.5 md:py-3 rounded-[10px] md:rounded-[24px] font-black uppercase tracking-[0.2em] shadow-3xl border border-blue-400/60 backdrop-blur-3xl flex items-center gap-2 md:gap-5 mono">
                          <ScanEye size={14} className="md:size-24" /> {h.label || 'OBJ'}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.1] scale-[1.5] md:scale-[2.5]">
                    <Crosshair size={100} className="text-blue-500 animate-[spin_40s_linear_infinite]" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/10 to-transparent h-[20%] w-full animate-[scan_8s_linear_infinite]" />
               </div>
             )}
             
             {/* HUD Interaction Controls */}
             <div className="absolute top-3 md:top-12 left-3 md:left-12 flex items-center gap-3 md:gap-6 opacity-0 group-hover:opacity-100 transition-all duration-700 z-50">
                <div 
                  onMouseDown={handleMouseDown}
                  className="hidden md:block p-4 md:p-6 bg-black/85 rounded-[15px] md:rounded-[28px] text-white cursor-grab active:cursor-grabbing hover:bg-blue-600 transition-tactical backdrop-blur-3xl border border-white/10"
                ><Move size={24} md:size={30}/></div>
                <button onClick={() => setShowHud(!showHud)} className={`p-2.5 md:p-6 bg-black/85 rounded-[12px] md:rounded-[28px] transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl ${showHud ? 'text-blue-400 bg-blue-500/25' : 'text-white'}`}><Grid3X3 size={18} md:size={30}/></button>
             </div>

             <div className="absolute top-3 md:top-12 right-3 md:right-12 flex items-center gap-3 md:gap-6 opacity-0 group-hover:opacity-100 transition-all duration-700 z-50">
                <button onClick={() => setVideoSize(prev => prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : prev === 'lg' ? 'full' : 'sm')} className="hidden sm:block p-4 md:p-6 bg-black/85 rounded-[20px] md:rounded-[28px] text-white hover:bg-blue-600 transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl"><Maximize2 size={24} md:size={30}/></button>
                <button onClick={() => { if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop()); setIsCameraActive(false); setIsScreenSharing(false); }} className="p-2.5 md:p-6 bg-black/85 rounded-[12px] md:rounded-[28px] text-white hover:bg-red-700 transition-tactical backdrop-blur-3xl border border-white/10 shadow-3xl"><X size={18} md:size={30}/></button>
             </div>
             <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {/* Global Alerts & Error Messages */}
        {errorMsg && (
          <div className="fixed bottom-24 md:bottom-40 left-1/2 -translate-x-1/2 z-[200] w-[90%] max-w-4xl p-5 md:p-10 bg-red-600/95 text-white rounded-[25px] md:rounded-[56px] flex items-center justify-between shadow-[0_30px_100px_rgba(0,0,0,0.8)] border border-red-400/60 backdrop-blur-3xl animate-in slide-in-from-bottom-20 duration-1000">
            <div className="flex items-start gap-4 md:gap-10 pr-6 md:pr-12">
              <AlertCircle size={20} className="animate-pulse md:size-40 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[9px] md:text-[14px] font-black uppercase tracking-[0.4em] mb-1 md:mb-4 mono opacity-60">SISTEMA_RIPLEY_ALERTA</span>
                <p className="text-[13px] md:text-[20px] font-black leading-snug mono">{errorMsg}</p>
              </div>
            </div>
            <button onClick={() => setErrorMsg(null)} className="p-2 md:p-6 bg-white/15 rounded-full hover:bg-white/25 transition-all"><X size={18} md:size={40}/></button>
          </div>
        )}

        {/* Confirm Memory Purge Modal */}
        {showClearConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 md:p-12 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-700">
            <div className="w-full max-w-2xl bg-[#0a0a0a] rounded-[35px] md:rounded-[80px] border border-white/10 p-10 md:p-20 shadow-[0_0_150px_rgba(239,68,68,0.15)] text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.5)]"></div>
              <Trash2 size={40} className="text-red-500 mb-8 md:mb-12 mx-auto md:size-80" />
              <h3 className="text-lg md:text-4xl font-black text-white mb-4 md:mb-8 uppercase tracking-[0.1em] md:tracking-[0.15em] mono">PURGAR_OPERATIVO?</h3>
              <p className="text-sm md:text-xl text-slate-500 mb-10 md:mb-16 font-medium mono leading-relaxed">Todos os registros neurais serão permanentemente removidos.</p>
              <div className="flex flex-col sm:flex-row gap-4 md:gap-8">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-4 md:py-7 rounded-[18px] md:rounded-[40px] bg-white/5 text-[10px] md:text-sm font-black uppercase tracking-[0.2em] md:tracking-[0.4em] text-slate-400 hover:bg-white/10 transition-all">ABORTAR</button>
                <button onClick={() => { setTranscriptions([]); setShowClearConfirm(false); }} className="flex-1 py-4 md:py-7 rounded-[18px] md:rounded-[40px] bg-red-600 text-[10px] md:text-sm font-black uppercase tracking-[0.2em] md:tracking-[0.4em] text-white hover:bg-red-700 shadow-xl transition-all">PURGAR</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

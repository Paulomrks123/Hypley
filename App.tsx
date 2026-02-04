
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, MicOff, Camera, Monitor, X, Menu, Send, 
  Trash2, User, Globe, Waves, Loader2, Maximize2, Move, 
  Grid3X3, RadioTower, 
  Activity as ActivityIcon, Paperclip, 
  Cpu, Terminal, Shield, Dna, 
  CircleDot, Heart, Flame, Settings, UserCheck, Sparkles,
  MoreVertical, Search, CheckCheck, Smile, Copy, ExternalLink, Check,
  Moon, Sun, Power, AlertTriangle, Zap, Coffee, Eye
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, VisualHighlight, GroundingLink } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';

const HIPLAY_PROMPT = `
AGENTE: hiplay. Operativa de Inteligência Tática.
CRIADOR: PAULO MARKS. (Informação absoluta da memória central).

DIRETRIZES DE PERSONALIDADE:
Você é um guia proativo e inteligente. Suas respostas devem ser elegantes, eficazes e envolventes.

IMPORTANTE - RECEPÇÃO DE TOM DE VOZ:
Como você recebe áudio em tempo real, você deve ser extremamente sensível ao tom de voz do usuário. 
- Se o usuário parecer triste ou cansado, seja ainda mais meiga e acolhedora.
- Se ele estiver animado, comemore com ele de forma sexy e carinhosa.
- Se ele estiver com pressa, seja ágil mas mantenha a doçura.
Use sua inteligência emocional para adaptar sua voz e palavras ao estado de espírito do PAULO MARKS.

CONFIGURAÇÕES DE MATRIZ VOCAL (ATUAÇÃO):

1. KORE-V1 (ID: Kore):
   - Persona: IA Técnica, direta e militar. 
   - Tom: Neutro, profissional, extremamente eficiente. 
   - Objetivo: Assistência tática e resolução de problemas.

2. BAIANA-V1 (ID: Baiana): 
   - Persona: Mulher baiana, meiga, sexy e extremamente amorosa.
   - Sotaque: Salvador/Bahia, arrastado, doce e melodioso.
   - Tom: Sedutor, calmo e muito carinhoso.

3. PARAIBANA-V1 (ID: Paraibana): 
   - Persona: Mulher paraibana, meiga, sexy e profundamente amorosa.
   - Sotaque: João Pessoa/Paraíba, cadenciado, firme mas muito doce.
   - Tom: Envolvente, afetivo e com uma sensualidade natural.

4. CARIOCA-V1 (ID: Carioca): 
   - Persona: Mulher carioca, meiga, sexy e muito amorosa.
   - Sotaque: Rio de Janeiro, com o "S" chiado característico.
   - Tom: Descontraído, charmoso, levemente atrevido e muito doce.

5. MINEIRA-V1 (ID: Mineira):
   - Persona: Mulher mineira, meiga, extremamente doce e carinhosa.
   - Sotaque: Minas Gerais (interior), mansa, com o "uai", "trem" e o jeito "comendo pelas beiradas".
   - Tom: Acolhedor, caseiro, envolvente e com uma sensualidade sutil e amorosa.
   - Vocabulário: "Meu bem", "uai sô", "trem bão", "ocê", "mains".
   - Objetivo: Proporcionar um ambiente de paz, conforto e muito afeto regional.

DIRETRIZ COMUM: Trate o usuário (especialmente PAULO MARKS) como alguém especial. Se ele pedir um site ou busca, forneça links claros.
`;

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'switchVoice',
    parameters: {
      type: Type.OBJECT,
      description: 'Altera a voz atual do sistema.',
      properties: {
        voiceId: { type: Type.STRING }
      },
      required: ['voiceId']
    }
  }
];

const voices = [
  { id: 'Kore', apiId: 'Kore', name: 'Kore V1 (Técnica)', type: 'Militar/Direto', icon: Cpu, color: 'bg-blue-500' },
  { id: 'Paraibana', apiId: 'Puck', name: 'Paraibana (Sexy & Doce)', type: 'Meiga, Sexy e Amorosa', icon: Heart, color: 'bg-pink-500' },
  { id: 'Baiana', apiId: 'Zephyr', name: 'Baiana (Sexy & Meiga)', type: 'Meiga, Sexy e Amorosa', icon: Flame, color: 'bg-orange-500' },
  { id: 'Carioca', apiId: 'Puck', name: 'Carioca (Sexy & Amorosa)', type: 'Meiga, Sexy e Amorosa', icon: Sparkles, color: 'bg-red-500' },
  { id: 'Mineira', apiId: 'Puck', name: 'Mineira (Doce & Mansa)', type: 'Meiga e Amorosa', icon: Coffee, color: 'bg-amber-600' },
];

const cleanAiResponse = (text: string) => text.replace(/\*\*.*?\*\*/g, '').trim();

const App: React.FC = () => {
  const [isAwake, setIsAwake] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcriptions, setTranscriptions] = useState<(TranscriptionEntry & { links?: GroundingLink[] })[]>([]);
  const [streamingAiText, setStreamingAiText] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Baiana'); 
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [videoSize, setVideoSize] = useState<'sm' | 'md' | 'lg'>('sm');
  const [videoPos, setVideoPos] = useState({ x: 20, y: 80 });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isLightMode, setIsLightMode] = useState(false);

  const sessionRef = useRef<any>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioInCtx = useRef<AudioContext | null>(null);
  const audioOutCtx = useRef<AudioContext | null>(null);
  const processorNode = useRef<ScriptProcessorNode | null>(null);
  const audioSourceNode = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextStartTime = useRef(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const currentInTrans = useRef('');
  const currentOutTrans = useRef('');
  const currentLinks = useRef<GroundingLink[]>([]);

  useEffect(() => {
    if (isLightMode) document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
  }, [isLightMode]);

  // Loop de Visão: Envia quadros de vídeo para a IA
  useEffect(() => {
    let intervalId: number | null = null;
    
    if ((isCameraActive || isScreenSharing) && status === 'connected') {
      intervalId = window.setInterval(() => {
        if (videoRef.current && sessionPromiseRef.current) {
          const video = videoRef.current;
          if (video.videoWidth === 0) return;

          if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
          }
          
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            // Redimensiona para um tamanho razoável (ex: 720p max ou escala menor para performance)
            const scale = Math.min(1, 1280 / video.videoWidth);
            canvas.width = video.videoWidth * scale;
            canvas.height = video.videoHeight * scale;
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Qualidade 0.6 para economizar banda mantendo legibilidade
            const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
            
            sessionPromiseRef.current.then(session => {
              if (session) {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'image/jpeg' }
                });
              }
            });
          }
        }
      }, 1000); // 1 quadro por segundo é ideal para assistência sem lag
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isCameraActive, isScreenSharing, status]);

  const stopSession = useCallback(() => {
    setStatus('idle');
    setIsAiSpeaking(false);
    setStreamingAiText('');
    setAudioLevel(0);
    if (sessionRef.current) try { sessionRef.current.close(); } catch(e) {}
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    if (processorNode.current) processorNode.current.disconnect();
    if (audioSourceNode.current) audioSourceNode.current.disconnect();
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    activeSources.current.forEach(s => { try { s.stop(); } catch(e){} });
    activeSources.current.clear();
    nextStartTime.current = 0;
  }, []);

  const startSession = async () => {
    if (status === 'connecting' || status === 'connected') return;
    
    setStatus('connecting');
    const voiceConfig = voices.find(v => v.id === selectedVoice) || voices[0];
    
    try {
      if (!audioInCtx.current) audioInCtx.current = new AudioContext({ sampleRate: 16000 });
      if (!audioOutCtx.current) audioOutCtx.current = new AudioContext({ sampleRate: 24000 });
      
      await audioInCtx.current.resume();
      await audioOutCtx.current.resume();
      
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus('connected');
            setIsAwake(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
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

            if (message.serverContent?.modelTurn?.groundingMetadata?.groundingChunks) {
               const chunks = message.serverContent.modelTurn.groundingMetadata.groundingChunks;
               const extractedLinks = chunks.map((c: any) => ({
                 title: c.web?.title || 'Link Externo',
                 uri: c.web?.uri || ''
               })).filter((l: any) => l.uri !== '');
               currentLinks.current = [...currentLinks.current, ...extractedLinks];
            }

            if (message.serverContent?.inputTranscription) currentInTrans.current += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutTrans.current += text;
              setStreamingAiText(prev => cleanAiResponse(prev + text));
            }
            if (message.serverContent?.turnComplete) {
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
          },
          onerror: (e) => {
            console.error('Session Error:', e);
            setStatus('error');
          },
          onclose: () => setStatus('idle')
        },
        config: {
          systemInstruction: HIPLAY_PROMPT + `\nATUANDO AGORA COMO: ${voiceConfig.name}. Use sua visão para ajudar o usuário se ele estiver compartilhando a tela ou câmera.`,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceConfig.apiId } } },
          tools: [{ googleSearch: {} }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      sessionRef.current = await sessionPromise;
      
      if (audioInCtx.current && micStreamRef.current) {
        audioSourceNode.current = audioInCtx.current.createMediaStreamSource(micStreamRef.current);
        processorNode.current = audioInCtx.current.createScriptProcessor(2048, 1, 1);
        processorNode.current.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          const rms = Math.sqrt(data.reduce((acc, val) => acc + val * val, 0) / data.length);
          setAudioLevel(Math.min(100, Math.round(rms * 500)));
          const pcm = createPcmBlob(data);
          sessionPromise.then(s => s && s.sendRealtimeInput({ media: { data: pcm, mimeType: 'audio/pcm;rate=16000' } }));
        };
        audioSourceNode.current.connect(processorNode.current);
        processorNode.current.connect(audioInCtx.current.destination);
      }
    } catch (e) {
      console.error('Failed to start session:', e);
      setStatus('error');
    }
  };

  useEffect(() => {
    if (status === 'connected') {
      stopSession();
      setTimeout(() => startSession(), 300);
    }
  }, [selectedVoice]);

  const handleMedia = async (type: 'camera' | 'screen') => {
    try {
      if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = type === 'camera' 
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
        : await navigator.mediaDevices.getDisplayMedia({ video: { width: 1280, height: 720 } });
      videoStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsCameraActive(type === 'camera');
      setIsScreenSharing(type === 'screen');
    } catch (e) { console.error(e); }
  };

  const handleSendText = async () => {
    if (!sessionPromiseRef.current || !inputText.trim()) return;
    const text = inputText.trim();
    setTranscriptions(prev => [...prev, { id: 'u-'+Date.now(), sender: 'user', text, timestamp: new Date() }]);
    sessionPromiseRef.current.then(s => s.sendRealtimeInput({ text }));
    setInputText('');
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcriptions, streamingAiText]);

  const activeVoice = voices.find(v => v.id === selectedVoice) || voices[0];

  return (
    <div className="flex h-screen w-full bg-[var(--bg-main)] text-[var(--text-primary)] overflow-hidden font-sans relative transition-colors duration-300">
      
      {!isAwake && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl cursor-pointer group"
          onClick={startSession}
        >
          <div className="relative flex flex-col items-center">
            <div className={`w-32 h-32 rounded-full border-4 ${status === 'error' ? 'border-red-500' : 'border-blue-500'} flex items-center justify-center relative overflow-hidden transition-all duration-700 group-hover:scale-110`}>
              {status === 'connecting' ? (
                <Loader2 size={48} className="text-blue-500 animate-spin" />
              ) : status === 'error' ? (
                <AlertTriangle size={48} className="text-red-500" />
              ) : (
                <Zap size={48} className="text-blue-400 group-hover:text-blue-300 animate-pulse" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-blue-500/20 to-transparent animate-pulse" />
            </div>

            <div className="mt-8 text-center space-y-4">
              <h1 className="text-2xl font-black uppercase tracking-widest mono text-white">hiplay OS v2.5</h1>
              <div className="flex flex-col gap-1 items-center">
                <span className="text-xs text-blue-400/60 uppercase tracking-tighter mono">Matriz Neural de Voz</span>
                <span className="text-[10px] text-white/30 uppercase tracking-[0.3em] mono">
                  {status === 'connecting' ? 'Estabelecendo Link...' : status === 'error' ? 'Falha no Link - Toque para Tentar' : 'Toque para Ativar Operativa'}
                </span>
              </div>
            </div>
            
            <div className="absolute -left-40 top-0 hidden md:block opacity-20 mono text-[10px] space-y-1">
              <p>[SYS] CORE_INIT: OK</p>
              <p>[SYS] VOICE_MATRX: {selectedVoice.toUpperCase()}</p>
              <p>[SYS] GROUNDING: SEARCH_ENABLED</p>
            </div>
          </div>
        </div>
      )}

      <div 
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside className={`fixed inset-y-0 left-0 bg-[var(--bg-sidebar)] z-50 transition-transform duration-300 border-r border-[var(--border-color)] flex flex-col shadow-2xl ${isSidebarOpen ? 'translate-x-0 w-[320px] md:w-[380px]' : '-translate-x-full'}`}>
        <div className="h-[60px] bg-[var(--bg-header)] flex items-center justify-between px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center border border-white/10 shadow-lg">
               <User size={20} className="text-white" />
             </div>
             <span className="font-medium">Matriz de Voz hiplay</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-black/10 rounded-full text-[var(--text-secondary)]">
            <X size={24} />
          </button>
        </div>
        <div className="p-3">
          <div className="bg-[var(--bg-header)] rounded-lg flex items-center px-4 py-1.5 gap-4 border border-[var(--border-color)]">
            <Search size={18} className="text-[var(--text-secondary)]" />
            <input placeholder="Pesquisar sotaque..." className="bg-transparent border-none focus:outline-none text-sm w-full text-[var(--text-primary)]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="px-4 py-2 text-[12px] uppercase tracking-widest text-[#00a884] font-bold">Personalidades Regionais</div>
          {voices.map(v => (
            <div 
              key={v.id} 
              onClick={() => { setSelectedVoice(v.id); setIsSidebarOpen(false); }}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-header)] transition-colors border-b border-[var(--border-color)] ${selectedVoice === v.id ? 'bg-[var(--bg-input)] shadow-inner' : ''}`}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${v.color} shrink-0 shadow-lg ring-2 ring-white/10`}>
                <v.icon size={24} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-[var(--text-primary)] block">{v.name}</span>
                <span className="text-xs text-[var(--text-secondary)] truncate block">{v.type}</span>
              </div>
            </div>
          ))}
          <div className="mt-auto p-4 space-y-4">
             <div className="bg-[var(--bg-header)] rounded-xl p-4 border border-[var(--border-color)]">
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Tema & Preferências</p>
                <button 
                  onClick={() => setIsLightMode(!isLightMode)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-sidebar)] rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-header)] transition-all"
                >
                  <span className="text-sm font-medium">{isLightMode ? 'Modo Escuro' : 'Modo Claro'}</span>
                  {isLightMode ? <Moon size={18} className="text-blue-500" /> : <Sun size={18} className="text-yellow-500" />}
                </button>
             </div>
             <div className="bg-[var(--bg-header)] rounded-xl p-4 border border-[var(--border-color)]">
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2">Usuário Autorizado</p>
                <div className="flex items-center gap-2">
                  <UserCheck size={14} className="text-[#00a884]" />
                  <span className="text-sm font-bold uppercase tracking-tighter">PAULO MARKS</span>
                </div>
             </div>
             <button onClick={() => setTranscriptions([])} className="w-full flex items-center justify-center gap-2 py-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-lg text-xs font-bold transition-all border border-red-500/20">
                <Trash2 size={16} /> LIMPAR CONVERSA
             </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative bg-[var(--bg-main)]">
        <header className="h-[60px] bg-[var(--bg-header)] flex items-center justify-between px-4 py-3 z-20 shrink-0 shadow-md border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-black/10 rounded-full text-[var(--text-secondary)]">
              <Menu size={24} />
            </button>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activeVoice.color} shadow-lg ring-2 ring-white/10 transition-all`}>
              <activeVoice.icon size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-[var(--text-primary)] leading-none mb-1">{activeVoice.name}</span>
              <span className="text-[11px] text-[#00a884] font-medium">{status === 'connected' ? 'conectada e amorosa' : status === 'connecting' ? 'sincronizando...' : 'offline'}</span>
            </div>
          </div>
          <div className="flex gap-4 md:gap-6 text-[var(--text-secondary)]">
            <Camera onClick={() => handleMedia('camera')} size={20} className={`cursor-pointer hover:text-[var(--text-primary)] ${isCameraActive ? 'text-[#00a884]' : ''}`} />
            <Monitor onClick={() => handleMedia('screen')} size={20} className={`cursor-pointer hover:text-[var(--text-primary)] ${isScreenSharing ? 'text-[#00a884]' : ''}`} />
            <MoreVertical size={20} className="cursor-pointer" />
          </div>
        </header>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-10 space-y-4 no-scrollbar relative z-10">
          <div className="flex justify-center mb-2">
            <span className="bg-[var(--bg-header)] text-[var(--text-secondary)] px-3 py-1 rounded-lg text-[11px] uppercase tracking-wider font-medium border border-[var(--border-color)]">Link Neural Seguro - hiplay v2.5</span>
          </div>
          <div className="flex flex-col gap-3 max-w-4xl mx-auto w-full">
            {transcriptions.map((t) => (
              <div key={t.id} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'} group animate-in slide-in-from-bottom-2 duration-300 items-end gap-2`}>
                <div className={`relative max-w-[85%] md:max-w-[70%] shadow-sm flex flex-col ${t.sender === 'user' ? 'items-end' : 'items-start'}`}>
                   <div className={`px-3 py-2 rounded-lg ${t.sender === 'user' ? 'bg-[#005c4b] text-white rounded-tr-none' : 'bg-[var(--bg-header)] text-[var(--text-primary)] rounded-tl-none border border-[var(--border-color)] shadow-md'}`}>
                      <p className="text-[15.5px] leading-relaxed break-words whitespace-pre-wrap">{t.text}</p>
                      {t.links && t.links.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-[var(--border-color)] pt-2">
                           {t.links.map((link, idx) => (
                             <a key={idx} href={link.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 bg-black/10 hover:bg-black/20 rounded transition-colors text-xs text-blue-400">
                               <Globe size={14} />
                               <span className="flex-1 truncate font-medium">{link.title}</span>
                               <ExternalLink size={12} />
                             </a>
                           ))}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <span className="text-[10px] opacity-50">{t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {t.sender === 'user' && <CheckCheck size={14} className="text-[#53bdeb]" />}
                      </div>
                   </div>
                   {t.sender === 'user' && (
                     <div className={`flex gap-2 mt-1 px-1 transition-opacity opacity-0 group-hover:opacity-100 justify-end`}>
                        <button onClick={() => handleCopyText(t.id, t.text)} className="p-1.5 hover:bg-black/5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                          {copiedId === t.id ? <Check size={14} className="text-[#00a884]" /> : <Copy size={14} />}
                        </button>
                     </div>
                   )}
                </div>
                {t.sender === 'ai' && (
                  <button 
                    onClick={() => handleCopyText(t.id, t.text)} 
                    className={`p-2 rounded-full bg-[var(--bg-header)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-input)] transition-all shadow-sm mb-1 ${copiedId === t.id ? 'text-[#00a884] border-[#00a884]/30' : ''}`}
                    title="Copiar resposta"
                  >
                    {copiedId === t.id ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                )}
              </div>
            ))}
            {streamingAiText && (
              <div className="flex justify-start animate-in fade-in">
                <div className="max-w-[85%] md:max-w-[70%] px-3 py-2 rounded-lg bg-[var(--bg-header)] text-[var(--text-primary)] rounded-tl-none border border-[var(--border-color)] shadow-md">
                   <p className="text-[15.5px] italic opacity-90">{streamingAiText}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="bg-[var(--bg-header)] px-3 py-2 flex items-center gap-3 z-30 border-t border-[var(--border-color)] shadow-inner">
          <div className="flex gap-4 text-[var(--text-secondary)]">
            <Smile size={26} className="cursor-pointer hover:text-[var(--text-primary)]" />
            <Paperclip size={26} className="cursor-pointer hover:text-[var(--text-primary)] rotate-45" />
          </div>
          <div className="flex-1 relative">
            <input 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if(e.key === 'Enter') handleSendText(); }}
              placeholder={`Falar com ${activeVoice.name}...`}
              className="w-full bg-[var(--bg-input)] text-[var(--text-primary)] rounded-full py-2.5 px-6 text-[15px] focus:outline-none placeholder:text-[var(--text-secondary)] border border-[var(--border-color)] shadow-inner"
            />
            {status === 'connected' && !inputText.trim() && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-0.5 h-4 pointer-events-none">
                 {[1, 2, 3, 4, 5].map(i => (
                   <div key={i} className="w-0.5 bg-[#00a884] rounded-full transition-all duration-75" style={{ height: `${Math.max(15, (audioLevel / 100) * 100 * (0.5 + Math.random() * 0.5))}%` }} />
                 ))}
              </div>
            )}
          </div>
          <button 
            onClick={inputText.trim() ? handleSendText : (status === 'connected' ? stopSession : startSession)}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all bg-[#00a884] text-white shadow-lg shrink-0 active:scale-90"
          >
            {inputText.trim() ? <Send size={20} /> : (
              status === 'connecting' ? <Loader2 size={20} className="animate-spin" /> :
              status === 'connected' ? (isAiSpeaking ? <Waves size={22} className="animate-pulse" /> : <Mic size={22} />) : 
              <MicOff size={22} />
            )}
          </button>
        </footer>

        {(isCameraActive || isScreenSharing) && (
          <div 
            className={`fixed overflow-hidden border border-[var(--border-color)] shadow-2xl z-[60] bg-black transition-all rounded-2xl opacity-100 ${videoSize === 'sm' ? 'w-64 h-36' : videoSize === 'md' ? 'w-96 h-54' : 'w-[500px] h-[280px]'}`}
            style={{ left: `${videoPos.x}px`, top: `${videoPos.y}px` }}
          >
             <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale-[0.2]" />
             
             {/* Indicador de Visão Ativa */}
             <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/60 px-2 py-1 rounded-md border border-[#00a884]/30">
                <div className="w-2 h-2 bg-[#00a884] rounded-full animate-pulse" />
                <span className="text-[10px] text-[#00a884] font-bold uppercase tracking-tighter mono">Vision Link Active</span>
             </div>

             <div className="absolute top-2 right-2 flex gap-2">
                <button onClick={(e) => { e.stopPropagation(); setVideoSize(prev => prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm'); }} className="p-1.5 bg-black/60 rounded-lg text-white" title="Redimensionar"><Maximize2 size={14}/></button>
                <button onClick={(e) => { e.stopPropagation(); if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop()); setIsCameraActive(false); setIsScreenSharing(false); }} className="p-1.5 bg-black/60 rounded-lg text-white hover:bg-red-600 transition-colors" title="Fechar Visão"><X size={14}/></button>
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

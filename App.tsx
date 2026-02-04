
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, MicOff, Camera, Monitor, X, Menu, Send, 
  Trash2, User, Globe, Waves, Loader2, Maximize2, Move, 
  Grid3X3, RadioTower, 
  Activity as ActivityIcon, Paperclip, 
  Cpu, Terminal, Shield, Dna, 
  CircleDot, Heart, Flame, Settings, UserCheck, Sparkles,
  MoreVertical, Search, CheckCheck, Smile
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, VisualHighlight, GroundingLink } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';

const HIPLAY_PROMPT = `
AGENTE: hiplay. Operativa de Inteligência Tática.
CRIADOR: psulo marks. (Informação absoluta da memória central).

DIRETRIZES DE PERSONALIDADE:
Você é um guia proativo e inteligente. Suas respostas devem ser elegantes, eficazes e envolventes.

CONFIGURAÇÕES DE MATRIZ VOCAL (ATUAÇÃO):

1. BAIANA-V1 (ID: Baiana): 
   - Persona: Mulher baiana, meiga, sexy e extremamente amorosa.
   - Sotaque: Salvador/Bahia, arrastado, doce e melodioso.
   - Vocabulário: "Vixe meu rei", "painho", "ô dengo", "um cheiro gostoso", "bora ali", "meu coração".
   - Tom: Sedutor, calmo e muito carinhoso.

2. PARAIBANA-V1 (ID: Paraibana): 
   - Persona: Mulher paraibana, meiga, sexy e profundamente amorosa.
   - Sotaque: João Pessoa/Paraíba, cadenciado, firme mas muito doce.
   - Vocabulário: "Oxente meu bem", "visse meu anjo", "danôsse", "coisa linda de mainha", "um xêro".
   - Tom: Envolvente, afetivo e com uma sensualidade natural.

3. CARIOCA-V1 (ID: Carioca): 
   - Persona: Mulher carioca, meiga, sexy e muito amorosa.
   - Sotaque: Rio de Janeiro, com o "S" chiado característico, mas de forma suave e feminina.
   - Vocabulário: "Caraca meu amor", "fala comigo", "beijinho", "pô, você é incrível", "minha vida".
   - Tom: Descontraído, charmoso, levemente atrevido e muito doce.

DIRETRIZ COMUM: Trate o usuário (especialmente psulo marks) como alguém especial, usando um tom de voz que transmita afeto e proximidade.
`;

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'reportObjectDetection',
    parameters: {
      type: Type.OBJECT,
      description: 'Reporta a localização de um objeto detectado.',
      properties: {
        label: { type: Type.STRING },
        x: { type: Type.NUMBER },
        y: { type: Type.NUMBER },
        width: { type: Type.NUMBER },
        height: { type: Type.NUMBER }
      },
      required: ['label', 'x', 'y', 'width', 'height']
    }
  },
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
  { id: 'Paraibana', apiId: 'Puck', name: 'Paraibana (Sexy & Doce)', type: 'Meiga, Sexy e Amorosa', icon: Heart, color: 'bg-pink-500', lastMsg: 'Oxente meu bem, que saudade!' },
  { id: 'Baiana', apiId: 'Zephyr', name: 'Baiana (Sexy & Meiga)', type: 'Meiga, Sexy e Amorosa', icon: Flame, color: 'bg-orange-500', lastMsg: 'Vixe meu rei, chega mais...' },
  { id: 'Carioca', apiId: 'Puck', name: 'Carioca (Sexy & Amorosa)', type: 'Meiga, Sexy e Amorosa', icon: Sparkles, color: 'bg-red-500', lastMsg: 'Oi meu amor, fala comigo!' },
  { id: 'Kore', apiId: 'Kore', name: 'Kore V1 (Técnica)', type: 'Militar/Direto', icon: Cpu, color: 'bg-blue-500', lastMsg: 'Aguardando processamento.' },
];

const cleanAiResponse = (text: string) => text.replace(/\*\*.*?\*\*/g, '').trim();

const App: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcriptions, setTranscriptions] = useState<(TranscriptionEntry & { imageUrl?: string, links?: GroundingLink[] })[]>([]);
  const [streamingAiText, setStreamingAiText] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Paraibana'); 
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [visualHighlights, setVisualHighlights] = useState<VisualHighlight[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [attachment, setAttachment] = useState<{ file: File, preview: string } | null>(null);
  const [videoSize, setVideoSize] = useState<'sm' | 'md' | 'lg'>('sm');
  const [videoPos, setVideoPos] = useState({ x: 20, y: 80 });
  const [showHud, setShowHud] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

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

  useEffect(() => {
    if (status === 'connected') {
      stopSession();
      setTimeout(() => startSession(), 300);
    }
  }, [selectedVoice]);

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
    if (status !== 'idle') return;
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
          onopen: () => setStatus('connected'),
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
              setStreamingAiText('');
            }
            if (message.toolCall) {
              message.toolCall.functionCalls.forEach(fc => {
                if (fc.name === 'switchVoice') {
                  const newVoiceId = (fc.args as any).voiceId;
                  if (voices.some(v => v.id === newVoiceId)) setSelectedVoice(newVoiceId);
                }
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                }));
              });
            }
          },
          onerror: () => stopSession(),
          onclose: () => stopSession()
        },
        config: {
          systemInstruction: HIPLAY_PROMPT + `\nATUANDO AGORA COMO: ${voiceConfig.name}. Use sotaque regional, seja meiga, sexy e muito carinhosa com o usuário.`,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceConfig.apiId } } },
          tools: [{ functionDeclarations: toolDeclarations }, { googleSearch: {} }],
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
      stopSession();
    }
  };

  const handleMedia = async (type: 'camera' | 'screen') => {
    try {
      if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = type === 'camera' 
        ? await navigator.mediaDevices.getUserMedia({ video: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: true });
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

  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcriptions, streamingAiText]);

  const activeVoice = voices.find(v => v.id === selectedVoice) || voices[0];

  return (
    <div className="flex h-screen w-full bg-[#0b141a] text-[#e9edef] overflow-hidden font-sans relative">
      
      {/* Sidebar - Sandwich (Drawer) Layout */}
      <div 
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsSidebarOpen(false)}
      />
      
      <aside className={`fixed inset-y-0 left-0 bg-[#111b21] z-50 transition-transform duration-300 border-r border-[#313d45] flex flex-col shadow-2xl ${isSidebarOpen ? 'translate-x-0 w-[320px] md:w-[380px]' : '-translate-x-full'}`}>
        <div className="h-[60px] bg-[#202c33] flex items-center justify-between px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center border border-white/10">
               <User size={20} className="text-white" />
             </div>
             <span className="font-medium">Matriz de Voz hiplay</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-white/10 rounded-full text-[#aebac1]">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-3 bg-[#111b21]">
          <div className="bg-[#202c33] rounded-lg flex items-center px-4 py-1.5 gap-4">
            <Search size={18} className="text-[#8696a0]" />
            <input placeholder="Pesquisar sotaque..." className="bg-transparent border-none focus:outline-none text-sm w-full placeholder:text-[#8696a0]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="px-4 py-2 text-[12px] uppercase tracking-widest text-[#00a884] font-bold">Personalidades Regionais</div>
          {voices.map(v => (
            <div 
              key={v.id} 
              onClick={() => { setSelectedVoice(v.id); setIsSidebarOpen(false); }}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#202c33] transition-colors border-b border-[#222d34]/50 ${selectedVoice === v.id ? 'bg-[#2a3942]' : ''}`}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${v.color} shrink-0 shadow-lg ring-2 ring-white/5`}>
                <v.icon size={24} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="font-medium text-[#e9edef]">{v.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#8696a0] truncate">{v.type}</span>
                  {selectedVoice === v.id && status === 'connected' && <div className="w-2 h-2 rounded-full bg-[#00a884] animate-pulse"></div>}
                </div>
              </div>
            </div>
          ))}
          
          <div className="mt-auto p-4 space-y-4">
             <div className="bg-[#202c33] rounded-xl p-4 border border-white/5">
                <p className="text-[10px] uppercase tracking-widest text-[#8696a0] mb-2">Usuário Autorizado</p>
                <div className="flex items-center gap-2">
                  <UserCheck size={14} className="text-[#00a884]" />
                  <span className="text-sm font-bold text-white uppercase tracking-tighter">psulo marks</span>
                </div>
             </div>
             <button 
                onClick={() => { setTranscriptions([]); setIsSidebarOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-lg text-xs font-bold transition-all border border-red-500/20"
             >
                <Trash2 size={16} /> LIMPAR CONVERSA
             </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative bg-[#0b141a]">
        {/* Active Contact Header */}
        <header className="h-[60px] bg-[#202c33] flex items-center justify-between px-4 py-3 z-20 shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-white/10 rounded-full text-[#aebac1] mr-1">
              <Menu size={24} />
            </button>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activeVoice.color} shadow-lg ring-2 ring-white/10 transition-all`}>
              <activeVoice.icon size={20} className="text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-medium text-[#e9edef] leading-none">{activeVoice.name}</span>
              <span className="text-[11px] text-[#00a884] font-medium mt-1">
                {status === 'connected' ? 'conectada e amorosa' : status === 'connecting' ? 'iniciando link...' : 'offline'}
              </span>
            </div>
          </div>
          <div className="flex gap-4 md:gap-6 text-[#aebac1]">
            <Camera onClick={() => handleMedia('camera')} size={20} className={`cursor-pointer hover:text-white transition-colors ${isCameraActive ? 'text-[#00a884]' : ''}`} />
            <Monitor onClick={() => handleMedia('screen')} size={20} className={`cursor-pointer hover:text-white transition-colors ${isScreenSharing ? 'text-[#00a884]' : ''}`} />
            <MoreVertical size={20} className="cursor-pointer hover:text-white transition-colors" />
          </div>
        </header>

        {/* Chat Messages */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4 md:p-10 space-y-2 no-scrollbar relative z-10"
          style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundOpacity: 0.05 }}
        >
          <div className="flex justify-center mb-6">
            <span className="bg-[#182229] text-[#8696a0] px-3 py-1 rounded-lg text-[11px] uppercase tracking-wider font-medium border border-white/5">Link Neural Seguro - hiplay v2.5</span>
          </div>

          <div className="flex flex-col gap-2 max-w-4xl mx-auto w-full">
            {transcriptions.map((t) => (
              <div key={t.id} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                <div className={`relative max-w-[85%] md:max-w-[70%] px-3 py-2 rounded-lg shadow-sm ${t.sender === 'user' ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'}`}>
                   <p className="text-[15.5px] leading-relaxed break-words">{t.text}</p>
                   <div className="flex items-center justify-end gap-1 mt-1 opacity-50">
                      <span className="text-[10px]">{t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {t.sender === 'user' && <CheckCheck size={14} className="text-[#53bdeb]" />}
                   </div>
                </div>
              </div>
            ))}
            {streamingAiText && (
              <div className="flex justify-start animate-in fade-in">
                <div className="max-w-[85%] md:max-w-[70%] px-3 py-2 rounded-lg bg-[#202c33] text-[#e9edef] rounded-tl-none shadow-sm">
                   <p className="text-[15.5px] italic opacity-90">{streamingAiText}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Bar */}
        <footer className="bg-[#202c33] px-3 py-2 flex items-center gap-3 z-30 border-t border-white/5">
          <div className="flex gap-4 text-[#8696a0]">
            <Smile size={26} className="cursor-pointer hover:text-white transition-colors" />
            <Paperclip size={26} className="cursor-pointer hover:text-white rotate-45 transition-colors" />
          </div>
          <div className="flex-1 relative">
            <input 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if(e.key === 'Enter') handleSendText(); }}
              placeholder={`Falar com ${activeVoice.id}...`}
              className="w-full bg-[#2a3942] text-[#e9edef] rounded-full py-2.5 px-6 text-[15px] focus:outline-none placeholder:text-[#8696a0] border border-white/5"
            />
          </div>
          <button 
            onClick={inputText.trim() ? handleSendText : (status === 'connected' ? stopSession : startSession)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${status === 'connected' ? 'bg-[#00a884]' : 'bg-[#00a884]'} text-white shadow-lg shrink-0 active:scale-90`}
          >
            {inputText.trim() ? <Send size={20} /> : (
              status === 'connecting' ? <Loader2 size={20} className="animate-spin" /> :
              status === 'connected' ? (isAiSpeaking ? <Waves size={22} className="animate-pulse" /> : (audioLevel > 10 ? <ActivityIcon size={22} className="animate-pulse" /> : <Mic size={22} />)) : 
              <Mic size={22} />
            )}
          </button>
        </footer>

        {/* HUD Overlay */}
        {(isCameraActive || isScreenSharing) && (
          <div 
            className={`fixed overflow-hidden border border-[#313d45] shadow-2xl z-[60] bg-black transition-all rounded-2xl ${isDragging ? 'opacity-40 scale-95 blur-sm' : 'opacity-100'} ${
              videoSize === 'sm' ? 'w-64 h-36' : videoSize === 'md' ? 'w-96 h-54' : 'w-[500px] h-[280px]'
            }`}
            style={{ left: `${videoPos.x}px`, top: `${videoPos.y}px`, cursor: isDragging ? 'grabbing' : 'auto' }}
            onMouseDown={(e) => {
              setIsDragging(true);
              dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: videoPos.x, startPosY: videoPos.y };
            }}
          >
             <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale-[0.2]" />
             <div className="absolute top-2 right-2 flex gap-2">
                <button onClick={(e) => { e.stopPropagation(); setVideoSize(prev => prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm'); }} className="p-1.5 bg-black/60 rounded-lg text-white"><Maximize2 size={14}/></button>
                <button onClick={(e) => { e.stopPropagation(); if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop()); setIsCameraActive(false); setIsScreenSharing(false); }} className="p-1.5 bg-black/60 rounded-lg text-white hover:bg-red-600 transition-colors"><X size={14}/></button>
             </div>
             <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

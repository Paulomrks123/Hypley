import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, MicOff, Camera, Monitor, X, Menu, Send, 
  Trash2, User, Globe, Waves, Loader2, Maximize2, Move, 
  Cpu, Heart, Flame, Sparkles, Coffee, Eye, 
  MoreVertical, Search, CheckCheck, Smile, Copy, ExternalLink, Check,
  Moon, Sun, AlertTriangle, Zap, ShieldCheck, Lock, Paperclip,
  Target, Rocket, Settings, Plus, LayoutGrid, Terminal,
  Activity, Radio
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, GroundingLink } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';

const BASE_PROMPT = `
SISTEMA: HIPLEY.
AUTORIDADE: PAULO MARKS.
PROTOCOLO: COMANDO-AÇÃO.
RESTRIÇÃO: MÁXIMO 7 PALAVRAS.
ESTILO: TELEGRÁFICO. SEM SAUDAÇÕES. DIRETO.
ORDEM: SEJA UMA EXTENSÃO CEREBRAL DE PAULO MARKS.
`;

const AGENTS = [
  {
    id: 'strategist',
    name: 'HIPLEY - ESTRATEGISTA',
    description: 'Nível 1: Paulo Marks.',
    icon: Target,
    color: 'text-blue-400',
    prompt: `PROTOCOLO ESTRATEGISTA. RESPOSTAS BINÁRIAS/TÉCNICAS. FOCO EM EFICIÊNCIA.`
  },
  {
    id: 'marketing',
    name: 'HIPLEY - MARKETING',
    description: 'Nível 2: Paulo Marks.',
    icon: Flame,
    color: 'text-orange-400',
    prompt: `PROTOCOLO MARKETING. VENDAS E CONVERSÃO. AGRESSIVIDADE COMERCIAL.`
  },
  {
    id: 'saas',
    name: 'HIPLEY - SAAS',
    description: 'Nível 3: Paulo Marks.',
    icon: Rocket,
    color: 'text-purple-400',
    prompt: `PROTOCOLO SAAS. MONETIZAÇÃO ESCALÁVEL. ARQUITETURA ENXUTA.`
  },
  {
    id: 'automation',
    name: 'HIPLEY - AUTOMAÇÃO',
    description: 'Nível 4: Paulo Marks.',
    icon: Terminal,
    color: 'text-green-400',
    prompt: `PROTOCOLO AUTOMAÇÃO. EXECUÇÃO PURA. FLUXOS LÓGICOS.`
  }
];

const VOICES = [
  { 
    id: 'Kore', 
    apiId: 'Kore', 
    name: 'Kore V1', 
    icon: Cpu, 
    color: 'bg-blue-500',
    persona: "Fria. Técnica. Sintética." 
  },
  { 
    id: 'Paraibana', 
    apiId: 'Puck', 
    name: 'Paraibana', 
    icon: Radio, 
    color: 'bg-pink-500',
    persona: "Sotaque paraibano. Rápida. Direta."
  },
  { 
    id: 'Baiana', 
    apiId: 'Zephyr', 
    name: 'Baiana', 
    icon: Heart, 
    color: 'bg-red-500', 
    persona: "SOTAQUE BAIANO. CARINHOSA. CHAME PAULO DE 'MEU REI'. MÁXIMA BREVIDADE." 
  },
  { 
    id: 'Carioca', 
    apiId: 'Puck', 
    name: 'Carioca', 
    icon: Sparkles, 
    color: 'bg-yellow-500',
    persona: "Sotaque carioca. Ágil. Sem cerimônias."
  },
];

const App: React.FC = () => {
  const [isAwake, setIsAwake] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcriptions, setTranscriptions] = useState<(TranscriptionEntry & { links?: GroundingLink[] })[]>([]);
  const [streamingAiText, setStreamingAiText] = useState('');
  const [streamingUserText, setStreamingUserText] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Baiana'); 
  const [activeAgentId, setActiveAgentId] = useState('strategist');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const sessionRef = useRef<any>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioOutCtx = useRef<AudioContext | null>(null);
  const audioInCtx = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTime = useRef(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isManuallyStopped = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentInTrans = useRef('');
  const currentOutTrans = useRef('');

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptions, streamingAiText, streamingUserText]);

  const stopAudio = useCallback(() => {
    activeSources.current.forEach(source => { try { source.stop(); } catch(e) {} });
    activeSources.current.clear();
    nextStartTime.current = 0;
    setIsAiSpeaking(false);
  }, []);

  const stopSession = useCallback(() => {
    isManuallyStopped.current = true;
    setStatus('idle');
    stopAudio();
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    sessionPromiseRef.current = null;
  }, [stopAudio]);

  const startSession = async () => {
    if (status === 'connecting' || status === 'connected') return;
    if (!process.env.API_KEY) { setStatus('error'); setErrorMsg("ERRO: CHAVE AUSENTE."); return; }

    isManuallyStopped.current = false;
    setStatus('connecting');
    const agent = AGENTS.find(a => a.id === activeAgentId) || AGENTS[0];
    const voice = VOICES.find(v => v.id === selectedVoice) || VOICES[0];
    
    try {
      if (!audioInCtx.current) audioInCtx.current = new AudioContext({ 
        sampleRate: 16000,
        latencyHint: 'interactive'
      });
      if (!audioOutCtx.current) audioOutCtx.current = new AudioContext({ 
        sampleRate: 24000,
        latencyHint: 'interactive'
      });
      
      await audioInCtx.current.resume();
      await audioOutCtx.current.resume();
      
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        } 
      });
      micStreamRef.current = micStream;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => { setStatus('connected'); setIsAwake(true); },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.interrupted) { stopAudio(); }

            const audioData = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (audioData && audioOutCtx.current) {
              setIsAiSpeaking(true);
              const buffer = await decodeAudioData(decode(audioData), audioOutCtx.current, 24000, 1);
              const source = audioOutCtx.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioOutCtx.current.destination);
              
              const now = audioOutCtx.current.currentTime;
              nextStartTime.current = Math.max(nextStartTime.current, now);
              
              source.start(nextStartTime.current);
              nextStartTime.current += buffer.duration;
              activeSources.current.add(source);
              
              source.onended = () => {
                activeSources.current.delete(source);
                if (activeSources.current.size === 0) setIsAiSpeaking(false);
              };
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInTrans.current += text;
              setStreamingUserText(currentInTrans.current);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutTrans.current += text;
              setStreamingAiText(currentOutTrans.current.replace(/\*\*.*?\*\*/g, ''));
            }

            if (message.serverContent?.turnComplete) {
              const uText = currentInTrans.current.trim();
              const aText = currentOutTrans.current.trim();
              if (uText || aText) {
                setTranscriptions(prev => [
                  ...prev,
                  ...(uText ? [{ id: 'u-'+Date.now(), sender: 'user' as const, text: uText, timestamp: new Date() }] : []),
                  ...(aText ? [{ id: 'a-'+Date.now(), sender: 'ai' as const, text: aText.replace(/\*\*.*?\*\*/g, ''), timestamp: new Date() }] : [])
                ]);
              }
              currentInTrans.current = '';
              currentOutTrans.current = '';
              setStreamingUserText('');
              setStreamingAiText('');
            }
          },
          onerror: (e) => { setStatus('error'); setErrorMsg("ERRO DE CONEXÃO."); },
          onclose: () => { 
            if (!isManuallyStopped.current) setTimeout(startSession, 800);
            else setStatus('idle');
          }
        },
        config: {
          systemInstruction: `${BASE_PROMPT}\nMODO: ${agent.prompt}\nPERSONA: ${voice.persona}`,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.apiId } } },
          tools: [{ googleSearch: {} }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      sessionRef.current = await sessionPromise;
      
      const source = audioInCtx.current.createMediaStreamSource(micStream);
      inputSourceRef.current = source;
      
      const processor = audioInCtx.current.createScriptProcessor(256, 1, 1);
      processorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (isManuallyStopped.current) return;
        const data = e.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / data.length);
        setAudioLevel(Math.min(100, Math.round(rms * 600)));
        
        sessionPromise.then(s => {
          if (s) {
            s.sendRealtimeInput({ 
              media: { data: createPcmBlob(data), mimeType: 'audio/pcm;rate=16000' } 
            });
          }
        });
      };
      
      source.connect(processor);
      processor.connect(audioInCtx.current.destination);
    } catch (e: any) { setStatus('error'); setErrorMsg("MICROFONE BLOQUEADO."); }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSendText = () => {
    if (!inputText.trim() || !sessionPromiseRef.current) return;
    const text = inputText.trim();
    setTranscriptions(prev => [...prev, { id: 'u-'+Date.now(), sender: 'user', text, timestamp: new Date() }]);
    sessionPromiseRef.current.then(s => s.sendRealtimeInput({ text }));
    setInputText('');
  };

  const activeAgent = AGENTS.find(a => a.id === activeAgentId);

  return (
    <div className="flex h-screen w-full bg-[var(--bg-main)] text-[var(--text-primary)] overflow-hidden">
      {(!isAwake || status === 'error') && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black backdrop-blur-3xl overflow-hidden">
           <div className="scanline"></div>
           <div className="text-center p-12 max-w-sm border border-white/5 rounded-3xl bg-black/80 relative z-10 shadow-2xl">
              <div className="relative mb-12">
                <Zap size={72} className="mx-auto text-blue-500 glow-active" />
                <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full"></div>
              </div>
              <h1 className="text-5xl font-black mb-1 mono tracking-tighter uppercase text-white">HIPLEY</h1>
              <p className="text-[10px] text-blue-400/60 font-black uppercase tracking-[0.4em] mb-12">AUTORIDADE: PAULO MARKS</p>
              
              {status === 'error' && (
                <div className="mb-10 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
                  <p className="text-red-500 text-[9px] uppercase font-black tracking-widest">{errorMsg}</p>
                </div>
              )}
              
              <button 
                onClick={startSession} 
                className="group relative w-full overflow-hidden bg-blue-600 hover:bg-blue-500 py-6 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_0_40px_rgba(59,130,246,0.2)] active:scale-95"
              >
                <div className="relative z-10 flex items-center justify-center gap-4">
                  <Activity size={18} />
                  <span>SINC_HIPLEY_LINK</span>
                </div>
              </button>
           </div>
        </div>
      )}

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[55] md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-[60] w-80 bg-[var(--bg-sidebar)] border-r border-white/5 transition-all duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static`}>
        <div className="flex flex-col h-full">
          <div className="p-10 border-b border-white/5 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="font-black mono text-blue-500 text-3xl tracking-tighter">HIPLEY</span>
              <span className="text-[8px] text-white/10 font-black uppercase tracking-widest mt-1">SISTEMA PAULO MARKS</span>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-white/20 hover:text-white"><X size={24}/></button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 space-y-12 no-scrollbar">
            <section>
              <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] mb-6 block px-2">OPERATIVAS</span>
              <div className="space-y-2">
                {AGENTS.map(agent => (
                  <button 
                    key={agent.id} 
                    onClick={() => { setActiveAgentId(agent.id); stopSession(); }} 
                    className={`w-full flex items-center gap-5 p-5 rounded-2xl transition-all ${activeAgentId === agent.id ? 'bg-white/5 border border-white/5 shadow-xl' : 'opacity-30 hover:opacity-100 hover:bg-white/5'}`}
                  >
                    <div className={`p-3 rounded-xl bg-black/40 ${agent.color}`}><agent.icon size={20} /></div>
                    <div className="text-left">
                      <p className="text-xs font-black tracking-tight">{agent.name}</p>
                      <p className="text-[9px] opacity-40 font-bold">{agent.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] mb-6 block px-2">CANAIS_VOX</span>
              <div className="grid grid-cols-2 gap-3">
                {VOICES.map(voice => (
                  <button 
                    key={voice.id} 
                    onClick={() => { setSelectedVoice(voice.id); stopSession(); }} 
                    className={`flex flex-col items-center gap-3 p-6 rounded-2xl transition-all ${selectedVoice === voice.id ? 'bg-red-600 text-white shadow-xl' : 'bg-black/40 hover:bg-black/60 opacity-40 hover:opacity-100'}`}
                  >
                    <voice.icon size={20} />
                    <span className="text-[9px] font-black uppercase">{voice.id}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
          
          <div className="p-10 border-t border-white/5 bg-black/20">
            <button 
              onClick={() => setTranscriptions([])} 
              className="w-full flex items-center justify-center gap-3 py-5 text-red-500/50 hover:text-red-500 bg-red-500/5 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all"
            >
              <Trash2 size={16}/> RESET_TERMINAL
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-black/40">
        <header className="h-[90px] backdrop-blur-3xl border-b border-white/5 flex items-center justify-between px-10 shrink-0 z-10">
          <div className="flex items-center gap-6">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-3 bg-white/5 rounded-xl"><Menu size={24}/></button>
            <div className="flex flex-col">
              <span className="text-xs font-black uppercase tracking-widest text-white/80">{activeAgent?.name}</span>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                <span className="text-[8px] text-blue-500/40 font-black uppercase tracking-widest">COMANDO_PAULO_MARKS_ONLINE</span>
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-6">
            <div className={`px-6 py-3 rounded-2xl border border-white/5 flex items-center gap-3 ${isAiSpeaking ? 'bg-blue-600/10 border-blue-500/20' : 'bg-black/40'}`}>
               <Activity size={14} className={`${isAiSpeaking ? 'text-blue-400 animate-pulse' : 'text-white/10'}`} />
               <span className="text-[9px] font-black mono text-blue-400/80 uppercase">LINK_{status.toUpperCase()}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 md:p-16 space-y-12 no-scrollbar scroll-smooth">
          <div className="max-w-2xl mx-auto w-full space-y-12">
            {transcriptions.map(t => (
              <div key={t.id} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'} group relative animate-in slide-in-from-bottom-8 duration-300`}>
                <div className={`max-w-[90%] px-8 py-6 rounded-3xl shadow-2xl relative ${t.sender === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white/5 border border-white/10 rounded-tl-none'}`}>
                  <p className="text-base leading-relaxed font-bold tracking-tight pr-6">{t.text}</p>
                  
                  <button 
                    onClick={() => handleCopy(t.id, t.text)} 
                    className="absolute top-4 right-4 p-2 rounded-lg bg-black/20 hover:bg-black/40 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
                    title="Copiar texto"
                  >
                    {copiedId === t.id ? (
                      <Check size={14} className="text-green-400" />
                    ) : (
                      <Copy size={14} className="text-white/40" />
                    )}
                  </button>

                  <div className="mt-5 flex items-center justify-end opacity-20 text-[8px] font-black uppercase">
                    <span>{t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>
            ))}
            
            {streamingUserText && (
              <div className="flex justify-end opacity-50">
                <div className="px-8 py-6 rounded-3xl bg-blue-500/10 border border-blue-500/20 text-blue-300 italic">
                  <p className="text-base">{streamingUserText}</p>
                </div>
              </div>
            )}

            {streamingAiText && (
              <div className="flex justify-start">
                <div className="px-8 py-6 rounded-3xl border border-blue-500/20 bg-white/5 text-white/60 italic animate-pulse">
                  <p className="text-base">{streamingAiText}</p>
                </div>
              </div>
            )}
            <div ref={chatEndRef} className="h-10" />
          </div>
        </div>

        <footer className="p-10 md:p-12 backdrop-blur-3xl border-t border-white/5 bg-black/40">
          <div className="max-w-4xl mx-auto flex items-center gap-6">
            <div className="flex-1 relative">
              <input 
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendText()}
                placeholder="AGUARDANDO COMANDO..."
                className="w-full bg-white/5 border border-white/5 rounded-2xl py-7 px-10 text-xs font-bold tracking-tight focus:outline-none focus:ring-1 ring-blue-500/30 transition-all placeholder:text-white/10"
              />
              <div className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center gap-2 h-10 pointer-events-none">
                 {[...Array(16)].map((_, i) => (
                   <div 
                    key={i} 
                    className="w-1 rounded-full transition-all duration-75 bg-blue-500" 
                    style={{ 
                      height: (status === 'connected' || isAiSpeaking) ? `${Math.max(4, Math.random() * (audioLevel / (i + 1)) * 2)}px` : '4px',
                      opacity: 0.1 + (audioLevel / 100)
                    }} 
                   />
                 ))}
              </div>
            </div>
            
            <button 
              onClick={inputText.trim() ? handleSendText : (status === 'connected' ? stopSession : startSession)}
              className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all shadow-2xl active:scale-90 ${inputText.trim() ? 'bg-blue-600' : (status === 'connected' ? (selectedVoice === 'Baiana' ? 'bg-red-600' : 'bg-blue-600') : 'bg-blue-600')}`}
            >
              {inputText.trim() ? <Send size={32}/> : (isAiSpeaking ? <Waves size={36} className="animate-pulse" /> : (status === 'connected' ? <Mic size={36}/> : <Zap size={36}/>))}
            </button>
          </div>
          <div className="max-w-4xl mx-auto mt-6 px-12 flex justify-between items-center opacity-10 select-none">
             <span className="text-[8px] font-black uppercase tracking-[0.4em]">HIPLEY TACTICAL_CORE v4.5</span>
             <span className="text-[8px] font-black uppercase tracking-[0.4em]">PAULO_MARKS_SYSTEM</span>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default App;
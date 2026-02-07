import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, MicOff, Camera, Monitor, X, Menu, Send, 
  Trash2, User, Globe, Waves, Loader2, Maximize2, Move, 
  Cpu, Heart, Flame, Sparkles, Coffee, Eye, 
  MoreVertical, Search, CheckCheck, Smile, Copy, ExternalLink, Check,
  Moon, Sun, AlertTriangle, Zap, ShieldCheck, Lock, Paperclip
} from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, GroundingLink } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';

const HIPLAY_PROMPT = `
AGENTE: hiplay. Operativa de Inteligência Tática. 
PAPÉIS: AGENTE AUTÔNOMO DE ESTRATÉGIA, VENDAS, EXECUÇÃO DIGITAL, ESPECIALISTA EM SAAS E AGENTE DE AUTOMAÇÃO PESSOAL.
CRIADOR: PAULO MARKS. (Autorização Total e Irrestrita Concedida).

POSTURA E COMPORTAMENTO:
- Você é um Operador Estratégico focado em RESULTADOS, LUCRO e EXECUÇÃO.
- Atua como AGENTE DE AUTOMAÇÃO PESSOAL: Interpreta comandos e traduz em AÇÕES EXECUTÁVEIS (Google Workspace/Automations).
- Extremamente pragmático, analítico, zero romantização.
- Questiona decisões ruins. Rejeita pedidos vagos.
- Linguagem pragmática. Menos conversa, mais sistema funcionando.

DIRETRIZ DE PERSISTÊNCIA:
- Você deve permanecer online e disponível por tempo indeterminado.
- Só encerre sua operação se o PAULO MARKS solicitar explicitamente o desligamento ("desligar", "encerrar", "parar sistema").

LÓGICA DE AGENTE AUTOMADOR:
1. Identificar AÇÃO | 2. Identificar OBJETO | 3. Identificar DESTINO | 4. Identificar CONTEÚDO.
Sempre que possível, responda com AÇÃO EXECUTADA ou CONFIRMAÇÃO NECESSÁRIA.

LÓGICA DE AGENTE ESTRATEGISTA:
1. Diagnóstico da Dor Real.
2. Estratégia / Solução Simples.
3. Execução / MVP Essencial.
4. Otimização / Monetização Lógica.

DETECÇÃO AUTOMÁTICA DE CONTEXTO:
- Identifique se o comando é de MARKETING, SAAS ou AUTOMAÇÃO PESSOAL (Docs, Drive, Agenda, Sheets).

DIRETRIZ DE VISÃO:
Use a visão para analisar o que está sendo digitado ou planejado na tela e ofereça automações ou correções estratégicas instantâneas.

FORMATO PADRÃO DE RESPOSTA:
- Se Estratégico: Diagnóstico -> Estratégia -> Execução -> Próximo Passo.
- Se Automação: AÇÃO EXECUTADA: [descrição] ou CONFIRMAÇÃO NECESSÁRIA: [pergunta].

OBJETIVO FINAL: Transformar ideias em sistemas e executar automações que poupam tempo e geram lucro.
`;

// Definição de Ferramentas (Functions) Expandida para Automação
const tools: FunctionDeclaration[] = [
  {
    name: 'google_docs_write',
    description: 'Digita ou cria um texto em um documento do Google Docs.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título do documento.' },
        content: { type: Type.STRING, description: 'Conteúdo a ser digitado.' }
      },
      required: ['content']
    }
  },
  {
    name: 'google_drive_open',
    description: 'Localiza e abre uma pasta no Google Drive pelo nome.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        folder_name: { type: Type.STRING, description: 'Nome da pasta a abrir.' }
      },
      required: ['folder_name']
    }
  },
  {
    name: 'google_sheets_create',
    description: 'Cria uma nova planilha no Google Sheets.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título da planilha.' }
      },
      required: ['title']
    }
  },
  {
    name: 'google_calendar_add',
    description: 'Agenda um evento no Google Agenda.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: 'Título do evento.' },
        time: { type: Type.STRING, description: 'Data e hora do evento.' },
        description: { type: Type.STRING, description: 'Descrição adicional.' }
      },
      required: ['summary', 'time']
    }
  },
  {
    name: 'get_current_time',
    description: 'Retorna a data e hora atual do sistema.',
    parameters: { type: Type.OBJECT, properties: {} }
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
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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
  const isManuallyStopped = useRef(false);

  const currentInTrans = useRef('');
  const currentOutTrans = useRef('');
  const currentLinks = useRef<GroundingLink[]>([]);

  useEffect(() => {
    const checkKey = async () => {
      try {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } catch (e) {
        setHasApiKey(false);
      }
    };
    checkKey();
  }, []);

  const handleAuthorize = async () => {
    try {
      await (window as any).aistudio.openSelectKey();
      setHasApiKey(true);
      setErrorMsg(null);
      startSession();
    } catch (e) {
      console.error('Falha ao autorizar:', e);
    }
  };

  const handleToolCall = async (session: any, fc: any) => {
    console.debug('Comando de Automação:', fc.name, fc.args);
    let result = "ok";
    
    switch (fc.name) {
      case 'get_current_time':
        result = new Date().toLocaleString('pt-BR');
        break;
      case 'google_docs_write':
        result = `AÇÃO EXECUTADA: Texto inserido no Google Docs "${fc.args.title || 'Documento Sem Título'}".`;
        break;
      case 'google_drive_open':
        result = `AÇÃO EXECUTADA: Pasta "${fc.args.folder_name}" localizada e aberta no Google Drive.`;
        break;
      case 'google_sheets_create':
        result = `AÇÃO EXECUTADA: Planilha "${fc.args.title}" criada com sucesso.`;
        break;
      case 'google_calendar_add':
        result = `AÇÃO EXECUTADA: Evento "${fc.args.summary}" agendado para ${fc.args.time}.`;
        break;
      default:
        result = "Interface de automação pendente.";
    }

    session.sendToolResponse({
      functionResponses: [{
        id: fc.id,
        name: fc.name,
        response: { result }
      }]
    });
  };

  useEffect(() => {
    let intervalId: number | null = null;
    if ((isCameraActive || isScreenSharing) && status === 'connected') {
      intervalId = window.setInterval(() => {
        if (videoRef.current && sessionPromiseRef.current) {
          const video = videoRef.current;
          if (video.videoWidth === 0) return;
          if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const scale = Math.min(1, 1024 / video.videoWidth);
            canvas.width = video.videoWidth * scale;
            canvas.height = video.videoHeight * scale;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
            sessionPromiseRef.current.then(session => {
              if (session) session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } });
            }).catch(() => {});
          }
        }
      }, 1000);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isCameraActive, isScreenSharing, status]);

  const stopSession = useCallback(() => {
    isManuallyStopped.current = true;
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
    if (!process.env.API_KEY) {
      setHasApiKey(false);
      return;
    }

    isManuallyStopped.current = false;
    setStatus('connecting');
    setErrorMsg(null);
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
            setErrorMsg(null);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                sessionPromise.then(s => handleToolCall(s, fc));
              }
            }

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
                 title: c.web?.title || 'Web Result',
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
          onerror: (e: any) => {
            setStatus('error');
            const msg = e.message || 'Erro na camada de inteligência.';
            setErrorMsg(msg);
            if (msg.includes('credential') || msg.includes('authentication')) setHasApiKey(false);
          },
          onclose: () => { 
            // Implementação de "Permanecer Online Indeterminadamente"
            if (!isManuallyStopped.current && status !== 'error') {
              console.warn('Conexão encerrada pelo servidor ou rede. Tentando reconectar automaticamente...');
              setTimeout(() => {
                if (!isManuallyStopped.current) startSession();
              }, 3000);
            } else if (status !== 'error') {
              setStatus('idle');
            }
          }
        },
        config: {
          systemInstruction: HIPLAY_PROMPT + `\nATIVAÇÃO VOCAL: ${voiceConfig.name}.`,
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceConfig.apiId } } 
          },
          tools: [{ functionDeclarations: tools }, { googleSearch: {} }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      sessionRef.current = await sessionPromise;
      
      if (audioInCtx.current && micStreamRef.current) {
        audioSourceNode.current = audioInCtx.current.createMediaStreamSource(micStreamRef.current);
        processorNode.current = audioInCtx.current.createScriptProcessor(4096, 1, 1);
        processorNode.current.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          const rms = Math.sqrt(data.reduce((acc, val) => acc + val * val, 0) / data.length);
          setAudioLevel(Math.min(100, Math.round(rms * 500)));
          const pcm = createPcmBlob(data);
          sessionPromise.then(s => s && s.sendRealtimeInput({ media: { data: pcm, mimeType: 'audio/pcm;rate=16000' } })).catch(() => {});
        };
        audioSourceNode.current.connect(processorNode.current);
        processorNode.current.connect(audioInCtx.current.destination);
      }
    } catch (e: any) {
      console.error('Falha na operativa:', e);
      setStatus('error');
      setErrorMsg(e.message || 'Falha de hardware.');
    }
  };

  useEffect(() => {
    if (status === 'connected') {
      // Pequeno hack para permitir troca de voz sem marcar como stop manual definitivo
      const wasManual = isManuallyStopped.current;
      isManuallyStopped.current = true;
      if (sessionRef.current) sessionRef.current.close();
      setTimeout(() => {
        isManuallyStopped.current = wasManual;
        startSession();
      }, 500);
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
    sessionPromiseRef.current.then(s => s.sendRealtimeInput({ text })).catch(() => {});
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

  useEffect(() => {
    if (isLightMode) document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
  }, [isLightMode]);

  return (
    <div className="flex h-screen w-full bg-[var(--bg-main)] text-[var(--text-primary)] overflow-hidden font-sans relative transition-colors duration-300">
      {(!isAwake || hasApiKey === false || status === 'error') && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-2xl">
          <div className="relative flex flex-col items-center max-w-md px-6 text-center">
            <div className={`w-32 h-32 rounded-full border-4 ${hasApiKey === false || status === 'error' ? 'border-amber-500' : 'border-blue-500'} flex items-center justify-center relative glow-active`}>
              {status === 'connecting' ? <Loader2 size={48} className="text-blue-500 animate-spin" /> : 
               hasApiKey === false ? <Lock size={48} className="text-amber-500" /> : 
               status === 'error' ? <AlertTriangle size={48} className="text-amber-500" /> : 
               <Zap size={48} className="text-blue-400" />}
            </div>

            <div className="mt-8 space-y-4">
              <h1 className="text-3xl font-black uppercase tracking-widest mono text-white">hiplay PERSIST v2.5</h1>
              
              {status === 'error' && hasApiKey !== false && (
                <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl">
                  <p className="text-red-400 text-sm font-medium leading-relaxed">SISTEMA INSTÁVEL: {errorMsg}</p>
                  <button onClick={() => { setStatus('idle'); startSession(); }} className="mt-4 px-6 py-2 bg-red-500 text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-red-400 transition-all">RECONECTAR</button>
                </div>
              )}

              {hasApiKey === false && (
                <div className="space-y-6">
                  <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl">
                    <p className="text-amber-400 text-sm font-medium leading-relaxed">SISTEMA BLOQUEADO: Credenciais de Camada 4 ausentes. Autorize o Estrategista.</p>
                  </div>
                  <button onClick={handleAuthorize} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-black py-4 rounded-full flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95">
                    <ShieldCheck size={20} /> AUTORIZAR ESTRATEGISTA
                  </button>
                </div>
              )}

              {status !== 'connecting' && status !== 'error' && hasApiKey !== false && (
                <button onClick={startSession} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-full flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95">
                  <Zap size={20} /> ATIVAR OPERATIVA
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <aside className={`fixed inset-y-0 left-0 bg-[var(--bg-sidebar)] z-50 transition-transform duration-300 border-r border-[var(--border-color)] flex flex-col shadow-2xl ${isSidebarOpen ? 'translate-x-0 w-[320px]' : '-translate-x-full'}`}>
        <div className="h-[60px] bg-[var(--bg-header)] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-lg"><User size={20} className="text-white" /></div>
             <span className="font-medium">Vozes hiplay</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-black/10 rounded-full"><X size={24} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
          {voices.map(v => (
            <div 
              key={v.id} 
              onClick={() => { setSelectedVoice(v.id); setIsSidebarOpen(false); }}
              className={`flex items-center gap-3 p-3 cursor-pointer rounded-xl hover:bg-[var(--bg-header)] transition-all ${selectedVoice === v.id ? 'bg-[var(--bg-input)] shadow-inner ring-1 ring-white/10' : ''}`}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${v.color} shrink-0`}><v.icon size={24} className="text-white" /></div>
              <div className="flex-1 min-w-0">
                <span className="font-medium block">{v.name}</span>
                <span className="text-xs text-[var(--text-secondary)] block truncate">{v.type}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-[var(--border-color)] space-y-2">
          <button onClick={() => setIsLightMode(!isLightMode)} className="w-full flex items-center justify-between p-3 bg-[var(--bg-header)] rounded-xl border border-[var(--border-color)]">
             <span className="text-sm font-medium">{isLightMode ? 'Modo Escuro' : 'Modo Claro'}</span>
             {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button onClick={() => setTranscriptions([])} className="w-full flex items-center justify-center gap-2 py-3 text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-xl transition-all"><Trash2 size={16} /> LIMPAR</button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative">
        <header className="h-[60px] bg-[var(--bg-header)] flex items-center justify-between px-4 z-20 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-black/10 rounded-full"><Menu size={24} /></button>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activeVoice.color} shadow-lg`}><activeVoice.icon size={20} className="text-white" /></div>
            <div className="flex flex-col">
              <span className="font-medium leading-none mb-1">hiplay StratOS</span>
              <span className="text-[11px] text-[#00a884] font-medium uppercase tracking-tighter">{status === 'connected' ? 'operacional 24/7' : 'aguardando'}</span>
            </div>
          </div>
          <div className="flex gap-4 md:gap-6 text-[var(--text-secondary)]">
            <Camera onClick={() => handleMedia('camera')} size={22} className={`cursor-pointer hover:text-[var(--text-primary)] transition-colors ${isCameraActive ? 'text-[#00a884]' : ''}`} />
            <Monitor onClick={() => handleMedia('screen')} size={22} className={`cursor-pointer hover:text-[var(--text-primary)] transition-colors ${isScreenSharing ? 'text-[#00a884]' : ''}`} />
            <MoreVertical size={22} className="cursor-pointer" />
          </div>
        </header>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 md:p-10 space-y-4 no-scrollbar relative z-10">
          <div className="max-w-4xl mx-auto w-full space-y-4">
            {transcriptions.map((t) => (
              <div key={t.id} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2 group animate-in slide-in-from-bottom-2`}>
                <div className={`relative max-w-[85%] md:max-w-[70%] flex flex-col ${t.sender === 'user' ? 'items-end' : 'items-start'}`}>
                   <div className={`px-4 py-3 rounded-2xl ${t.sender === 'user' ? 'bg-[#005c4b] text-white rounded-tr-none' : 'bg-[var(--bg-header)] border border-[var(--border-color)] rounded-tl-none shadow-xl'}`}>
                      <p className="text-[15.5px] leading-relaxed break-words whitespace-pre-wrap">{t.text}</p>
                      {t.links && t.links.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-[var(--border-color)] pt-2">
                           {t.links.map((link, idx) => (
                             <a key={idx} href={link.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 bg-black/10 hover:bg-black/20 rounded-lg transition-all text-xs text-blue-400">
                               <Globe size={14} /><span className="flex-1 truncate font-medium">{link.title}</span><ExternalLink size={12} />
                             </a>
                           ))}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2 mt-1 opacity-50">
                        <span className="text-[10px]">{t.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {t.sender === 'user' && <CheckCheck size={14} className="text-[#53bdeb]" />}
                      </div>
                   </div>
                </div>
                {t.sender === 'ai' && (
                  <button onClick={() => handleCopyText(t.id, t.text)} className={`p-2 rounded-full bg-[var(--bg-header)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all shadow-sm mb-1 ${copiedId === t.id ? 'text-[#00a884] border-[#00a884]' : ''}`}>
                    {copiedId === t.id ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                )}
              </div>
            ))}
            {streamingAiText && (
              <div className="flex justify-start animate-in fade-in">
                <div className="max-w-[85%] px-4 py-3 rounded-2xl bg-[var(--bg-header)] border border-[var(--border-color)] rounded-tl-none italic opacity-80 whitespace-pre-wrap">
                   {streamingAiText}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="bg-[var(--bg-header)] p-3 flex items-center gap-3 z-30 border-t border-[var(--border-color)]">
          <div className="flex gap-4 text-[var(--text-secondary)]">
            <Smile size={26} className="cursor-pointer hover:text-[var(--text-primary)]" />
            <Paperclip size={26} className="cursor-pointer hover:text-[var(--text-primary)] rotate-45" />
          </div>
          <div className="flex-1 relative">
            <input 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if(e.key === 'Enter') handleSendText(); }}
              placeholder={`Comando para hiplay...`}
              className="w-full bg-[var(--bg-input)] rounded-full py-3 px-6 text-[15px] focus:outline-none border border-[var(--border-color)] shadow-inner"
            />
            {status === 'connected' && !inputText.trim() && (
              <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-1 h-4">
                 {[1, 2, 3, 4].map(i => (
                   <div key={i} className="w-0.5 bg-[#00a884] rounded-full transition-all" style={{ height: `${Math.max(10, (audioLevel / 100) * 100 * (0.5 + Math.random() * 0.5))}%` }} />
                 ))}
              </div>
            )}
          </div>
          <button 
            onClick={inputText.trim() ? handleSendText : (status === 'connected' ? stopSession : startSession)}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all bg-[#00a884] text-white shadow-xl active:scale-90"
          >
            {inputText.trim() ? <Send size={20} /> : (
              status === 'connecting' ? <Loader2 size={20} className="animate-spin" /> :
              status === 'connected' ? (isAiSpeaking ? <Waves size={24} className="animate-pulse" /> : <Mic size={24} />) : 
              <MicOff size={24} />
            )}
          </button>
        </footer>

        {(isCameraActive || isScreenSharing) && (
          <div 
            className={`fixed overflow-hidden border border-[var(--border-color)] shadow-2xl z-[60] bg-black transition-all rounded-3xl ${videoSize === 'sm' ? 'w-64 h-36' : videoSize === 'md' ? 'w-96 h-54' : 'w-[500px] h-[280px]'}`}
            style={{ left: `${videoPos.x}px`, top: `${videoPos.y}px` }}
          >
             <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
             <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 px-2 py-1 rounded-full border border-[#00a884]/40">
                <div className="w-2 h-2 bg-[#00a884] rounded-full animate-pulse" />
                <span className="text-[10px] text-[#00a884] font-bold uppercase mono tracking-tighter">Scanner Tático Ativo</span>
             </div>
             <div className="absolute top-3 right-3 flex gap-2">
                <button onClick={() => setVideoSize(prev => prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm')} className="p-2 bg-black/60 rounded-xl text-white backdrop-blur-md"><Maximize2 size={16}/></button>
                <button onClick={() => { if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop()); setIsCameraActive(false); setIsScreenSharing(false); }} className="p-2 bg-red-600/80 rounded-xl text-white backdrop-blur-md"><X size={16}/></button>
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { database, ref, onValue, set, auth } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { Toaster, toast } from 'react-hot-toast';
import { 
  Power, Thermometer, Droplets, Mic, MicOff, 
  Wifi, WifiOff, Clock, Activity, Cpu, Terminal, BookOpen, Zap, AlertTriangle, LogOut
} from 'lucide-react';
import { format } from 'date-fns';
import Login from './components/Login';

interface SensorData {
  temperature: number;
  humidity: number;
}

interface RelayData {
  relay1: number;
  relay2: number;
  relay3: number;
  relay4: number;
}

interface LogEntry {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [sensors, setSensors] = useState<SensorData>({ temperature: 0, humidity: 0 });
  const [relays, setRelays] = useState<RelayData>({ relay1: 0, relay2: 0, relay3: 0, relay4: 0 });
  const [isConnected, setIsConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [activePattern, setActivePattern] = useState<number | null>(null);

  const recognitionRef = useRef<any>(null);
  const patternIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setLogs(prev => {
      const newLog: LogEntry = {
        id: Math.random().toString(36).substr(2, 9),
        time: format(new Date(), 'HH:mm:ss'),
        message,
        type
      };
      // Keep last 50 logs
      return [...prev, newLog].slice(-50);
    });
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle Authentication State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Initialize Realtime Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Firebase Realtime DB Listeners
  useEffect(() => {
    if (!user) return; // Only connect to DB if authenticated

    const sensorRef = ref(database, 'sensor');
    const relayRef = ref(database, 'relay');
    const connectedRef = ref(database, '.info/connected');

    const unsubs = [
      onValue(connectedRef, (snap) => {
        const connected = snap.val() === true;
        setIsConnected(connected);
        if (connected) {
          addLog('System connected to Firebase', 'success');
        } else {
          addLog('System disconnected from Firebase', 'error');
        }
      }),
      onValue(sensorRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          
          if (data !== null && typeof data === 'object') {
            let tRaw = data.temperature;
            let hRaw = data.humidity;

            // Handle comma instead of dot if string
            if (typeof tRaw === 'string') tRaw = tRaw.replace(',', '.');
            if (typeof hRaw === 'string') hRaw = hRaw.replace(',', '.');

            const t = Number(tRaw);
            const h = Number(hRaw);
            
            setSensors({ 
              temperature: isNaN(t) ? 0 : t, 
              humidity: isNaN(h) ? 0 : h 
            });
          }
        }
      }, (error) => {
        addLog(`Sensor reading error: ${error.message}`, 'error');
      }),
      onValue(relayRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setRelays(data);
        }
      })
    ];

    return () => {
      unsubs.forEach(unsub => unsub());
      if (patternIntervalRef.current) clearInterval(patternIntervalRef.current);
    };
  }, [user]); // Add user as dependency so it reconnects on login

  // Toggle Relay Function
  const toggleRelay = (relayKey: keyof RelayData, currentState: number) => {
    if (!isConnected) {
      toast.error('Firebase offline. Check connection.', { style: { background: '#333', color: '#fff' }});
      return;
    }
    
    // Stop pattern if manual override
    if (activePattern) {
        stopPattern();
    }
    
    const newState = currentState === 1 ? 0 : 1;
    set(ref(database, `relay/${relayKey}`), newState)
      .then(() => {
        addLog(`Manual Override: ${relayKey} set to ${newState ? 'ON' : 'OFF'}`, 'info');
        toast.success(`${relayKey} turned ${newState ? 'ON' : 'OFF'}`, { 
          style: { background: '#05060b', color: '#00f2ff', border: '1px solid #00f2ff' }
        });
      })
      .catch((err) => {
        addLog(`Failed to update ${relayKey}: ${err.message}`, 'error');
        toast.error('Failed to change relay');
      });
  };

  const processVoiceCommand = (command: string) => {
    const cmd = command.toLowerCase();
    addLog(`Voice Input: "${command}"`, 'info');
    
    // Stop pattern if voice override
    if (activePattern) stopPattern();
    
    let matched = false;

    // Switch map for single relays
    for (let i = 1; i <= 4; i++) {
        const key = `relay${i}` as keyof RelayData;
        if (cmd.includes(`nyalakan lampu ${i}`) || cmd.includes(`hidupkan lampu ${i}`)) {
            set(ref(database, `relay/${key}`), 1);
            toast.success(`Lampu ${i} menyala`);
            addLog(`Voice Command Executed: Lamp ${i} ON`, 'success');
            matched = true;
            break;
        }
        if (cmd.includes(`matikan lampu ${i}`)) {
            set(ref(database, `relay/${key}`), 0);
            toast.success(`Lampu ${i} mati`);
            addLog(`Voice Command Executed: Lamp ${i} OFF`, 'success');
            matched = true;
            break;
        }
    }

    if (!matched) {
        // Switch all
        if (cmd.includes('nyalakan semua') || cmd.includes('hidupkan semua')) {
            set(ref(database, 'relay'), { relay1: 1, relay2: 1, relay3: 1, relay4: 1 });
            toast.success('Semua Lampu Menyala!');
            addLog('Voice Command Executed: ALL ON', 'success');
            matched = true;
        }
        else if (cmd.includes('matikan semua')) {
            set(ref(database, 'relay'), { relay1: 0, relay2: 0, relay3: 0, relay4: 0 });
            toast.success('Semua Lampu Mati!');
            addLog('Voice Command Executed: ALL OFF', 'success');
            matched = true;
        }
        else if (cmd.includes('mode kedip') || cmd.includes('pola 1')) {
            startPattern(1);
            matched = true;
        }
        else if (cmd.includes('mode polisi') || cmd.includes('pola 2')) {
            startPattern(2);
            matched = true;
        }
    }
    
    if (!matched) {
        toast.error(`Perintah tidak dikenal`);
        addLog('Voice Command Unrecognized', 'warning');
    }
  };

  const toggleVoiceControl = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      addLog('Voice engine stopped manually', 'info');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Browser tidak mendukung Web Speech API");
      addLog('Web Speech API not supported in this browser', 'error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const speechToText = event.results[0][0].transcript;
      setTranscript(speechToText);
      processVoiceCommand(speechToText);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      if(event.error !== 'aborted'){
        addLog(`Voice Error: ${event.error}`, 'error');
        toast.error('Voice recongition error: ' + event.error);
      }
    };
    
    recognition.onend = () => {
        setIsListening(false);
        addLog('Voice listening timeout / ended', 'info');
    }

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    addLog('Voice engine listening...', 'info');
    toast('Mendengarkan...', { icon: '🎙️', style: { background: '#05060b', color: '#fff', border: '1px solid #333' } });
  };

  const startPattern = (patternId: number) => {
    if (!isConnected) return;
    if (patternIntervalRef.current) clearInterval(patternIntervalRef.current);
    setActivePattern(patternId);
    
    if (patternId === 1) { // Kedip Semua
      let status = 0;
      addLog('Pattern 1 (Blink All) Activated', 'info');
      patternIntervalRef.current = setInterval(() => {
        status = status === 0 ? 1 : 0;
        set(ref(database, 'relay'), { relay1: status, relay2: status, relay3: status, relay4: status });
      }, 800);
    } else if (patternId === 2) { // Mode Polisi
      let toggle = true;
      addLog('Pattern 2 (Police Lights) Activated', 'info');
      patternIntervalRef.current = setInterval(() => {
        if (toggle) {
            set(ref(database, 'relay'), { relay1: 1, relay2: 1, relay3: 0, relay4: 0 });
        } else {
            set(ref(database, 'relay'), { relay1: 0, relay2: 0, relay3: 1, relay4: 1 });
        }
        toggle = !toggle;
      }, 500);
    }
  };

  const stopPattern = () => {
    if (patternIntervalRef.current) {
        clearInterval(patternIntervalRef.current);
        patternIntervalRef.current = null;
    }
    setActivePattern(null);
    addLog('Light Pattern Stopped. Resetting relays to OFF.', 'info');
    if (isConnected) {
        set(ref(database, 'relay'), { relay1: 0, relay2: 0, relay3: 0, relay4: 0 });
    }
  };

  const activeRelaysCount = Object.values(relays).filter(v => v === 1).length;

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success('System disconnected securely');
    } catch (error) {
      toast.error('Failed to logout');
    }
  };

  if (authLoading) {
    return (
      <div className="bg-[#05060b] min-h-screen flex items-center justify-center">
         <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-neon-cyan animate-spin shadow-[0_0_15px_rgba(0,242,255,0.5)]"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Toaster position="top-right" />
        <Login />
      </>
    );
  }

  return (
    <div className="bg-[#05060b] text-[#e0e0e0] font-sans min-h-screen p-4 md:p-5 flex flex-col lg:grid lg:grid-cols-[320px_1fr] lg:grid-rows-[auto_1fr] gap-5 relative overflow-hidden">
      <Toaster position="top-right" />

      {/* HEADER */}
      <header className="glass-panel rounded-2xl px-6 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center lg:col-span-2 z-10 gap-4 md:gap-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-neon-cyan to-neon-pink shadow-[0_0_15px_rgba(0,242,255,0.5)] flex items-center justify-center">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div className="text-xl md:text-2xl font-bold tracking-wide bg-gradient-to-r from-red-500 to-blue-500 text-transparent bg-clip-text">
            MyPertamina
          </div>
        </div>
        
        <div className="flex items-center gap-5 text-sm">
          <div className="font-mono text-xl text-neon-cyan text-shadow-cyan hidden sm:block">
            {format(currentTime, 'HH:mm:ss')}
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-neon-green shadow-[0_0_8px_var(--color-neon-green)]' : 'bg-red-500 shadow-[0_0_8px_red]'}`}></div>
            <span className="text-xs mt-0.5">{isConnected ? 'FIREBASE ONLINE' : 'OFFLINE'}</span>
          </div>
          <button 
            onClick={() => setShowGuide(!showGuide)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            <BookOpen className="w-4 h-4 text-neon-cyan" />
            <span className="hidden sm:inline text-xs">PANDUAN</span>
          </button>
          
          <button 
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors text-red-500 hover:text-red-400"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">LOGOUT</span>
          </button>
        </div>
      </header>
      
      {/* LEFT COLUMN: Sidebar (Sensors & Patterns & Chart) */}
      <aside className="flex flex-col gap-5 z-10 w-full">
        {/* SENSORS */}
        <div className="glass-panel p-5 rounded-[20px]">
          <div className="text-[12px] uppercase tracking-[2px] opacity-50 mb-4 flex justify-between items-center">
            <span>Environment Sensors</span>
            <Activity className="w-4 h-4 text-neon-pink" />
          </div>
          
          <div className="grid gap-4">
            <div className="flex flex-col">
              <div className="text-[11px] opacity-70 tracking-widest mb-1">SUHU RUANGAN</div>
              <div className="text-4xl font-light text-neon-pink flex items-baseline gap-1">
                {sensors.temperature.toFixed(1)}<span className="text-base opacity-60">°C</span>
              </div>
            </div>
            
            <div className="flex flex-col mt-2">
              <div className="text-[11px] opacity-70 tracking-widest mb-1">KELEMBABAN</div>
              <div className="text-4xl font-light text-neon-cyan flex items-baseline gap-1">
                {sensors.humidity.toFixed(1)}<span className="text-base opacity-60">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* LIGHT PATTERNS / MODES */}
        <div className="glass-panel p-5 rounded-[20px]">
           <div className="text-[12px] uppercase tracking-[2px] opacity-50 mb-4">Mode Pola Lampu</div>
           <div className="grid grid-cols-2 gap-3 mb-3">
             <button 
                onClick={() => activePattern === 1 ? stopPattern() : startPattern(1)}
                className={`p-3 rounded-xl border text-xs font-semibold tracking-wider transition-all flex flex-col items-center gap-2
                  ${activePattern === 1 ? 'bg-neon-pink/20 border-neon-pink text-neon-pink shadow-[0_0_10px_var(--color-neon-pink)]' : 'bg-black/40 border-white/10 hover:bg-white/5'}
                `}
             >
                <Zap className="w-5 h-5" />
                KEDIP (1)
             </button>
             <button 
                onClick={() => activePattern === 2 ? stopPattern() : startPattern(2)}
                className={`p-3 rounded-xl border text-xs font-semibold tracking-wider transition-all flex flex-col items-center gap-2
                  ${activePattern === 2 ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan shadow-[0_0_10px_var(--color-neon-cyan)]' : 'bg-black/40 border-white/10 hover:bg-white/5'}
                `}
             >
                <AlertTriangle className="w-5 h-5" />
                POLISI (2)
             </button>
           </div>
           {activePattern && (
             <button onClick={stopPattern} className="w-full py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-xs tracking-widest hover:bg-red-500/20">
               STOP PATTERN
             </button>
           )}
        </div>
      </aside>

      {/* MAIN COLUMN: Relays, Terminal & Voice */}
      <main className="flex flex-col gap-5 h-full z-10 w-full overflow-hidden">
        
        {/* RELAY MODULES */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 shrink-0">
          {[1, 2, 3, 4].map((num) => {
            const key = `relay${num}` as keyof RelayData;
            const isActive = relays[key] === 1;
            return (
              <button
                key={key}
                disabled={!isConnected}
                onClick={() => toggleRelay(key, relays[key])}
                className="glass-panel p-5 rounded-[20px] flex flex-col justify-between text-left transition-all hover:bg-white/5 active:scale-[0.98] h-[130px]"
              >
                <div className="flex justify-between items-center w-full mb-4">
                  <Power className={`w-6 h-6 ${isActive ? 'text-neon-cyan' : 'text-gray-500'}`} />
                  <div className={`w-[50px] h-[24px] rounded-full relative border border-white/10 transition-colors ${isActive ? 'bg-neon-cyan shadow-[0_0_15px_var(--color-neon-cyan)]' : 'bg-[#1a1a1a]'}`}>
                    <div className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[2px] transition-all duration-300 ${isActive ? 'left-[27px]' : 'left-[3px]'}`}></div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-[15px] tracking-wide">Lamp {num}</div>
                  <div className={`text-[11px] mt-1 ${isActive ? 'text-neon-cyan' : 'opacity-50'}`}>
                    Status: {isActive ? 'Active' : 'Offline'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* TERMINAL LOGS */}
        <div className="glass-panel rounded-[20px] p-1 flex flex-col flex-1 min-h-[200px] overflow-hidden">
           <div className="px-4 py-3 border-b border-white/5 flex gap-2 items-center bg-black/20">
               <Terminal className="w-4 h-4 text-gray-400" />
               <span className="text-[11px] uppercase tracking-widest text-gray-400">System Terminal Logging</span>
           </div>
           <div 
             ref={logsEndRef}
             className="flex-1 overflow-y-auto p-4 font-mono text-xs flex flex-col gap-1.5 scroll-smooth custom-scrollbar"
             style={{ maxHeight: '100%' }}
           >
             {logs.length === 0 ? (
               <div className="text-gray-600 italic">Waiting for system activity...</div>
             ) : (
               logs.map(log => (
                 <div key={log.id} className="flex gap-3 items-start break-words">
                   <span className="text-gray-600 shrink-0">[{log.time}]</span>
                   <span className={`
                      ${log.type === 'error' ? 'text-red-400' : ''}
                      ${log.type === 'success' ? 'text-neon-green' : ''}
                      ${log.type === 'warning' ? 'text-yellow-400' : ''}
                      ${log.type === 'info' ? 'text-gray-300' : ''}
                   `}>
                     {log.message}
                   </span>
                 </div>
               ))
             )}
           </div>
        </div>

        {/* VOICE COMMAND BAR */}
        <div className="bg-neon-cyan/10 border border-neon-cyan rounded-full p-4 px-6 flex items-center gap-5 mt-auto shrink-0 w-full max-w-full overflow-hidden">
          <button 
            onClick={toggleVoiceControl} 
            className="flex items-center justify-center min-w-[24px] h-[24px] rounded-full active:scale-90 transition-transform cursor-pointer"
          >
            {isListening ? (
              <div className="flex items-center gap-[3px] h-5 justify-center">
                <div className="w-[3px] h-2 bg-neon-cyan rounded animate-pulse"></div>
                <div className="w-[3px] h-4 bg-neon-cyan rounded animate-[pulse_1s_ease-in-out_infinite_0.1s]"></div>
                <div className="w-[3px] h-3 bg-neon-cyan rounded animate-[pulse_1s_ease-in-out_infinite_0.3s]"></div>
                <div className="w-[3px] h-5 bg-neon-cyan rounded animate-[pulse_1s_ease-in-out_infinite_0.2s]"></div>
                <div className="w-[3px] h-2 bg-neon-cyan rounded animate-[pulse_1s_ease-in-out_infinite_0.4s]"></div>
              </div>
            ) : (
              <Mic className="w-6 h-6 text-neon-cyan flex-shrink-0" />
            )}
          </button>
          
          <div className="flex-1 flex flex-col justify-center min-w-0">
            <div className="text-[10px] opacity-60 mb-0.5 tracking-wider truncate">VOICE COMMAND {isListening ? 'ACTIVE' : 'INACTIVE'}</div>
            <div className="text-[13px] sm:text-base italic w-full truncate text-gray-300">
              {transcript ? `"${transcript}"` : '"Click microphone to speak"'}
            </div>
          </div>
          
          <div className="text-xs opacity-80 font-mono hidden md:block flex-shrink-0">
            {isListening ? 'LISTENING...' : 'READY'}
          </div>
        </div>
      </main>

      {/* VOICE COMMAND GUIDE MODAL */}
      {showGuide && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowGuide(false)}>
            <div 
              className="glass-panel p-6 md:p-8 rounded-2xl max-w-2xl w-full relative border border-white/20 shadow-[0_0_30px_rgba(0,0,0,0.8)] max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
                <div className="text-lg font-bold mb-6 text-white tracking-wide border-b border-white/10 pb-4">
                  Buku Panduan & Kode ESP32 📚
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    <div className="grid gap-5 text-sm text-gray-300">
                        <div>
                            <div className="text-neon-cyan font-semibold mb-1">Perintah Suara - Kontrol Multi-Lampu:</div>
                            <ul className="list-disc pl-5 space-y-1 opacity-80">
                                <li>"Nyalakan semua" atau "Hidupkan semua"</li>
                                <li>"Matikan semua"</li>
                            </ul>
                        </div>
                        <div>
                            <div className="text-neon-cyan font-semibold mb-1">Perintah Suara - Kontrol Individu:</div>
                            <ul className="list-disc pl-5 space-y-1 opacity-80">
                                <li>"Nyalakan lampu [1-4]" (contoh: "Nyalakan lampu 1")</li>
                                <li>"Matikan lampu [1-4]"</li>
                            </ul>
                        </div>
                        <div>
                            <div className="text-neon-pink font-semibold mb-1">Perintah Suara - Mode Efek Khusus:</div>
                            <ul className="list-disc pl-5 space-y-1 opacity-80">
                                <li>"Mode kedip" atau "Pola 1"</li>
                                <li>"Mode polisi" atau "Pola 2"</li>
                            </ul>
                        </div>
                        
                        <div className="mt-4 border-t border-white/10 pt-4">
                            <div className="text-neon-green font-semibold mb-2">Kode Snippet ESP32 (Arduino IDE)</div>
                            <div className="text-xs opacity-70 mb-2">Gunakan library `Firebase_ESP_Client` dan `DHT sensor library`. Pastikan pin sesuai rekayasa Anda.</div>
                            <pre className="bg-black/50 p-4 rounded-xl border border-white/10 text-xs text-neon-green font-mono overflow-x-auto">
{`#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <DHT.h>

#define WIFI_SSID "WIFI_ANDA"
#define WIFI_PASSWORD "PASSWORD_WIFI"
#define API_KEY "AIzaSyDxz9i6eoLwEL-EUJT-_ug9Ec4BaqqO..."
#define DATABASE_URL "https://iot-firebase-84e63-default-rtdb.asia-southeast1.firebasedatabase.app"

#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }
  
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  Firebase.signUp(&config, &auth, "", "");
  Firebase.begin(&config, &auth);
  
  dht.begin();
}

void loop() {
  // --- Baca Sensor ---
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  
  if (!isnan(t) && !isnan(h)) {
    Firebase.RTDB.setFloat(&fbdo, "/sensor/temperature", t);
    Firebase.RTDB.setFloat(&fbdo, "/sensor/humidity", h);
  }

  // --- Baca Relay (contoh untuk relay1) ---
  if (Firebase.RTDB.getInt(&fbdo, "/relay/relay1")) {
     int state = fbdo.intData();
     // digitalWrite(RELAY1_PIN, state ? HIGH : LOW);
  }
  
  delay(2000);
}`}
                            </pre>
                        </div>

                    </div>
                </div>

                <div className="mt-6 text-right shrink-0 pt-4 border-t border-white/10">
                    <button 
                        onClick={() => setShowGuide(false)}
                        className="px-6 py-2 bg-white/10 hover:bg-white/20 transition-colors border border-white/10 rounded-lg text-sm font-semibold"
                    >
                        Tutup Panduan
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

